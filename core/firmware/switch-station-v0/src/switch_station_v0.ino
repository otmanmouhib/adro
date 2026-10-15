
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <time.h>
#include <EEPROM.h>
#include <mbedtls/sha256.h>
#include <Adafruit_NeoPixel.h>
#include <ESPmDNS.h>

// ======================================================
//             SWITCH STATION V0 CONFIG
// ======================================================

// ==== Firmware / OTA ====
const char* currentFirmwareVersion = "1.0.0";
const char* otaManifestURL = "http://adro.local:8000/switchstation01/manifest.json";

// Broker hostname — resolved via mDNS. No hardcoded IP fallback.
const char* mqtt_host = "adro.local";
const int   mqtt_port = 1883;

IPAddress   mqtt_broker_ip;   // resolved at boot and on reconnect

unsigned long lastOtaCheck = 0;
const unsigned long otaInterval = 60000;

// ==== NTP ====
const long gmtOffset_sec = 3600;
const int daylightOffset_sec = 0;
bool ntpSynced = false;

// ==== Channels ====
const int NUM_CHANNELS = 4;
const int CHANNEL_PINS[NUM_CHANNELS] = {4, 5, 6, 7};
const bool CHANNEL_ACTIVE_HIGH = true;

inline void setChannel(int idx, bool on) {
  if (idx < 0 || idx >= NUM_CHANNELS) return;
  if (CHANNEL_ACTIVE_HIGH) {
    digitalWrite(CHANNEL_PINS[idx], on ? HIGH : LOW);
  } else {
    digitalWrite(CHANNEL_PINS[idx], on ? LOW : HIGH);
  }
}

// ==== Per-channel state and timers ====
bool          channelState[NUM_CHANNELS]   = {false, false, false, false};
unsigned long channelOnMs[NUM_CHANNELS]    = {1000, 1000, 1000, 1000};
unsigned long channelOffMs[NUM_CHANNELS]   = {1000, 1000, 1000, 1000};
unsigned long channelTimer[NUM_CHANNELS]   = {0, 0, 0, 0};
unsigned long channelAutoOff[NUM_CHANNELS] = {0, 0, 0, 0};  // 0 = no timed auto-off

// ==== Automation ====
bool automationEnabled = false;

// ==== WiFi ====
const char* ssid     = "Tenda_2AAA80";
const char* password = "";

// ==== Identity ====
const char* device_id   = "switchstation01";
const char* site_id     = "main";
const char* bridge_id   = "hub";

WiFiClient espClient;
PubSubClient client(espClient);

// ==== MQTT topics ====
String topic_telemetry;
String topic_status;
String topic_command;
String topic_config;

// ==== Timing ====
unsigned long lastTelemetry = 0;
const long telemetryInterval = 15000;

unsigned long startupTime = 0;
const unsigned long rebootInterval = 6UL * 60UL * 60UL * 1000UL;

// ==== Sequence counter ====
uint32_t seqCounter = 0;

// ==== EEPROM ====
#define EEPROM_SIZE       64
#define EEPROM_MAGIC      0xAD
#define ADDR_MAGIC        0
#define ADDR_AUTOMATION   1
#define ADDR_CHANNEL_BASE 2
// Per channel (i = 0..3): 12 bytes at ADDR_CHANNEL_BASE + i*12
//   [0..3]  channelOnMs  (unsigned long)
//   [4..7]  channelOffMs (unsigned long)
//   [8]     channelState (byte)

// ======================================================
//                     RGB LED
// ======================================================

#define RGB_LED_PIN    48
#define RGB_LED_COUNT  1
#define RGB_LED_BRIGHT 40

Adafruit_NeoPixel rgbLed(RGB_LED_COUNT, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);

#define C_OFF        0x000000
#define C_RED        0xFF0000
#define C_GREEN      0x00FF00
#define C_BLUE       0x0000FF
#define C_CYAN       0x00FFFF
#define C_MAGENTA    0xFF00FF
#define C_YELLOW     0xFFFF00
#define C_ORANGE     0xFF8000
#define C_WHITE      0xFFFFFF
#define C_DIM_BLUE   0x000030
#define C_DIM_GREEN  0x003000
#define C_DIM_ORANGE 0x402000
#define C_DIM_RED    0x400000
#define C_DIM_CYAN   0x004040

uint32_t ledBaseColor = C_OFF;
uint32_t ledBaseShown = 0xFFFFFFFF;

bool     ledBlinkActive = false;
uint32_t ledBlinkColor = 0;
uint8_t  ledBlinkRemaining = 0;
bool     ledBlinkOn = false;
unsigned long ledBlinkLast = 0;
const unsigned long LED_BLINK_INTERVAL = 90;

void ledBegin() {
  rgbLed.begin();
  rgbLed.setBrightness(RGB_LED_BRIGHT);
  rgbLed.setPixelColor(0, C_WHITE);
  rgbLed.show();
  delay(150);
  rgbLed.setPixelColor(0, C_OFF);
  rgbLed.show();
  ledBaseShown = C_OFF;
}

void ledSetBase(uint32_t color) {
  ledBaseColor = color;
  if (!ledBlinkActive && ledBaseShown != color) {
    rgbLed.setPixelColor(0, color);
    rgbLed.show();
    ledBaseShown = color;
  }
}

void ledBlink(uint32_t color, uint8_t times) {
  if (times == 0) return;
  ledBlinkActive = true;
  ledBlinkColor = color;
  ledBlinkRemaining = times * 2;
  ledBlinkOn = true;
  ledBlinkLast = millis();
  rgbLed.setPixelColor(0, color);
  rgbLed.show();
  ledBaseShown = color;
}

void ledLoop() {
  if (!ledBlinkActive) return;
  unsigned long now = millis();
  if (now - ledBlinkLast < LED_BLINK_INTERVAL) return;
  ledBlinkLast = now;
  ledBlinkOn = !ledBlinkOn;
  ledBlinkRemaining--;
  if (ledBlinkRemaining == 0) {
    ledBlinkActive = false;
    rgbLed.setPixelColor(0, ledBaseColor);
    rgbLed.show();
    ledBaseShown = ledBaseColor;
  } else {
    uint32_t c = ledBlinkOn ? ledBlinkColor : C_OFF;
    rgbLed.setPixelColor(0, c);
    rgbLed.show();
    ledBaseShown = c;
  }
}

bool anyChannelOn() {
  for (int i = 0; i < NUM_CHANNELS; i++) if (channelState[i]) return true;
  return false;
}

void ledUpdateStatus() {
  uint32_t c;
  if (WiFi.status() != WL_CONNECTED) {
    c = C_BLUE;
  } else if (!ntpSynced) {
    c = C_YELLOW;
  } else if (!client.connected()) {
    c = C_MAGENTA;
  } else if (anyChannelOn()) {
    c = C_GREEN;
  } else if (automationEnabled) {
    c = C_ORANGE;
  } else {
    c = C_DIM_BLUE;
  }
  ledSetBase(c);
}

// ======================================================
//                     NTP  (IP-based, no DNS)
// ======================================================

time_t getUnixTimestamp() {
  if (!ntpSynced) return 0;
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return 0;
  return mktime(&timeinfo);
}

void syncNTP() {
  Serial.println("[NTP] Requesting time (IP-based, no DNS)...");
  ledSetBase(C_YELLOW);

  configTime(gmtOffset_sec, daylightOffset_sec,
             "216.239.35.0",       // time.google.com
             "162.159.200.1",      // time.cloudflare.com
             "129.6.15.28");       // nist.time.gov

  struct tm timeinfo;
  for (int attempt = 1; attempt <= 3; attempt++) {
    if (getLocalTime(&timeinfo, 5000)) {
      ntpSynced = true;
      Serial.printf("[NTP] Sync OK -> %04d-%02d-%02d %02d:%02d:%02d\n",
                    timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
      ledBlink(C_GREEN, 2);
      return;
    }
    Serial.printf("[NTP] Attempt %d failed, retrying...\n", attempt);
    delay(1000);
  }
  Serial.println("[NTP] FAIL — will retry on next reconnect");
  ledBlink(C_RED, 2);
  ntpSynced = false;
}

// ======================================================
//                     EEPROM
// ======================================================

void saveSettings() {
  EEPROM.write(ADDR_MAGIC, EEPROM_MAGIC);
  EEPROM.write(ADDR_AUTOMATION, automationEnabled ? 1 : 0);
  for (int i = 0; i < NUM_CHANNELS; i++) {
    int base = ADDR_CHANNEL_BASE + i * 12;
    EEPROM.put(base + 0, channelOnMs[i]);
    EEPROM.put(base + 4, channelOffMs[i]);
    EEPROM.write(base + 8, channelState[i] ? 1 : 0);
  }
  EEPROM.commit();
  Serial.println("[EEPROM] Settings saved");
}

void loadSettings() {
  if (EEPROM.read(ADDR_MAGIC) == EEPROM_MAGIC) {
    automationEnabled = EEPROM.read(ADDR_AUTOMATION) == 1;
    for (int i = 0; i < NUM_CHANNELS; i++) {
      int base = ADDR_CHANNEL_BASE + i * 12;
      EEPROM.get(base + 0, channelOnMs[i]);
      EEPROM.get(base + 4, channelOffMs[i]);
      channelState[i] = EEPROM.read(base + 8) == 1;
    }
    Serial.println("[EEPROM] Settings loaded");
    Serial.printf("  Automation: %s\n", automationEnabled ? "ON" : "OFF");
    for (int i = 0; i < NUM_CHANNELS; i++) {
      Serial.printf("  CH%d state=%d on=%lu off=%lu\n",
                    i + 1, channelState[i] ? 1 : 0,
                    channelOnMs[i], channelOffMs[i]);
    }
  } else {
    Serial.println("[EEPROM] No saved settings, using defaults");
    saveSettings();
  }
}

// ======================================================
//                Broker resolution (pure mDNS)
// ======================================================

bool resolveBroker(int attempts = 5, int delayMs = 2000) {
  for (int i = 1; i <= attempts; i++) {
    IPAddress ip;
    if (WiFi.hostByName(mqtt_host, ip)) {
      mqtt_broker_ip = ip;
      Serial.printf("[NET] %s -> %s (mDNS OK, attempt %d)\n",
                    mqtt_host, ip.toString().c_str(), i);
      return true;
    }
    Serial.printf("[NET] mDNS resolve %s failed (attempt %d/%d)\n",
                  mqtt_host, i, attempts);
    delay(delayMs);
  }
  Serial.println("[NET] mDNS FAILED after all attempts — rebooting in 10s");
  delay(10000);
  ESP.restart();
  return false;
}

// ======================================================
//                     WiFi
// ======================================================

void setup_wifi() {
  ledSetBase(C_BLUE);
  Serial.printf("[WiFi] Connecting to SSID=\"%s\"\n", ssid);

  WiFi.mode(WIFI_STA);
  if (strlen(password) == 0) {
    WiFi.begin(ssid);
  } else {
    WiFi.begin(ssid, password);
  }

  unsigned long startAttempt = millis();
  unsigned long lastPulse = millis();
  bool pulseOn = true;

  while (WiFi.status() != WL_CONNECTED) {
    delay(150);
    if (millis() - lastPulse >= 250) {
      lastPulse = millis();
      pulseOn = !pulseOn;
      rgbLed.setPixelColor(0, pulseOn ? C_BLUE : C_OFF);
      rgbLed.show();
      ledBaseShown = pulseOn ? C_BLUE : C_OFF;
    }
    if (millis() - startAttempt > 30000) {
      Serial.println("[WiFi] TIMEOUT after 30s — restarting");
      delay(500);
      ESP.restart();
    }
  }

  Serial.printf("[WiFi] Connected! IP=%s RSSI=%d channel=%d MAC=%s\n",
                WiFi.localIP().toString().c_str(),
                WiFi.RSSI(), WiFi.channel(),
                WiFi.macAddress().c_str());
  Serial.printf("[NET] Gateway=%s  DNS=%s\n",
                WiFi.gatewayIP().toString().c_str(),
                WiFi.dnsIP().toString().c_str());

  if (!MDNS.begin(device_id)) {
    Serial.println("[mDNS] init FAILED — adro.local won't resolve");
  } else {
    Serial.println("[mDNS] ready (this device = " + String(device_id) + ".local)");
  }

  resolveBroker();

  Serial.printf("[NET] Probing %s:%d ...\n",
                mqtt_broker_ip.toString().c_str(), mqtt_port);
  WiFiClient probe;
  unsigned long t0 = millis();
  if (probe.connect(mqtt_broker_ip, mqtt_port, 3000)) {
    Serial.printf("[NET] %s:%d REACHABLE (%lu ms)\n",
                  mqtt_broker_ip.toString().c_str(), mqtt_port, millis() - t0);
    probe.stop();
    ledBlink(C_GREEN, 2);
  } else {
    Serial.printf("[NET] %s:%d UNREACHABLE after %lu ms\n",
                  mqtt_broker_ip.toString().c_str(), mqtt_port, millis() - t0);
    ledBlink(C_RED, 2);
  }
}

// ======================================================
//                Envelope / status payloads
// ======================================================

String buildEnvelope(JsonDocument& data, bool /*unused*/) {
  DynamicJsonDocument env(512);
  env["ts"]  = (uint32_t)getUnixTimestamp();
  env["seq"] = seqCounter++;
  env["v"]   = currentFirmwareVersion;
  env["dev"] = device_id;
  env["data"] = data;
  String out;
  serializeJson(env, out);
  return out;
}

String buildStatusPayload(const char* state) {
  DynamicJsonDocument env(256);
  env["ts"]  = (uint32_t)getUnixTimestamp();
  env["seq"] = seqCounter++;
  env["v"]   = currentFirmwareVersion;
  env["dev"] = device_id;
  JsonObject data = env.createNestedObject("data");
  data["state"] = state;
  String out;
  serializeJson(env, out);
  return out;
}

// ======================================================
//                     MQTT
// ======================================================

void handleSetChannel(JsonObject d) {
  if (!d.containsKey("channel")) {
    Serial.println("[CMD] set_channel missing channel");
    return;
  }
  int ch = d["channel"].as<int>() - 1;   // wire is 1-based, internal is 0-based
  if (ch < 0 || ch >= NUM_CHANNELS) {
    Serial.printf("[CMD] invalid channel %d\n", ch + 1);
    return;
  }
  bool on = true;
  if (d.containsKey("state")) {
    String s = d["state"].as<String>();
    on = (s == "on" || s == "true" || s == "1");
  }
  channelState[ch] = on;
  setChannel(ch, on);
  channelTimer[ch] = millis();
  channelAutoOff[ch] = 0;
  if (on && d.containsKey("duration_s")) {
    unsigned long dur = d["duration_s"].as<unsigned long>();
    if (dur > 0) channelAutoOff[ch] = dur * 1000UL;
  }
  Serial.printf("[CMD] CH%d -> %s%s\n", ch + 1, on ? "ON" : "OFF",
                channelAutoOff[ch] ? " (timed)" : "");
  saveSettings();
  ledUpdateStatus();
}

void handleSetAll(JsonObject d) {
  bool on = true;
  if (d.containsKey("state")) {
    String s = d["state"].as<String>();
    on = (s == "on" || s == "true" || s == "1");
  }
  for (int i = 0; i < NUM_CHANNELS; i++) {
    channelState[i] = on;
    setChannel(i, on);
    channelTimer[i] = millis();
    channelAutoOff[i] = 0;
  }
  Serial.printf("[CMD] ALL -> %s\n", on ? "ON" : "OFF");
  saveSettings();
  ledUpdateStatus();
}

void handleAutomation(JsonObject d) {
  if (!d.containsKey("enabled")) return;
  automationEnabled = d["enabled"].as<bool>();
  Serial.printf("[CMD] Automation: %s\n", automationEnabled ? "ON" : "OFF");
  if (automationEnabled) {
    for (int i = 0; i < NUM_CHANNELS; i++) channelTimer[i] = millis();
  }
  saveSettings();
  ledUpdateStatus();
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  ledBlink(C_WHITE, 1);

  DynamicJsonDocument env(768);
  DeserializationError error = deserializeJson(env, payload, length);
  if (error) {
    Serial.println("[MQTT] JSON parse error");
    ledBlink(C_RED, 2);
    return;
  }

  // Envelope: {ts, seq, v, dev, data:{...}}
  if (!env.containsKey("data")) {
    Serial.println("[MQTT] envelope missing data");
    return;
  }
  JsonObject d = env["data"].as<JsonObject>();

  String topicStr = String(topic);

  if (topicStr == topic_command) {
    const char* action = d["action"] | "";
    if (strcmp(action, "set_channel") == 0) handleSetChannel(d);
    else if (strcmp(action, "set_all") == 0) handleSetAll(d);
    else if (strcmp(action, "automation") == 0) handleAutomation(d);
    else if (strcmp(action, "reboot") == 0) {
      Serial.println("[CMD] Reboot");
      ledSetBase(C_WHITE);
      delay(500);
      ESP.restart();
    } else {
      Serial.printf("[CMD] unknown action '%s'\n", action);
    }
  }

  if (topicStr == topic_config) {
    bool changed = false;
    if (d.containsKey("channel_on_s")) {
      JsonArray a = d["channel_on_s"].as<JsonArray>();
      for (int i = 0; i < NUM_CHANNELS && i < (int)a.size(); i++) {
        channelOnMs[i] = (unsigned long)a[i].as<float>() * 1000UL;
      }
      changed = true;
    }
    if (d.containsKey("channel_off_s")) {
      JsonArray a = d["channel_off_s"].as<JsonArray>();
      for (int i = 0; i < NUM_CHANNELS && i < (int)a.size(); i++) {
        channelOffMs[i] = (unsigned long)a[i].as<float>() * 1000UL;
      }
      changed = true;
    }
    if (changed) {
      saveSettings();
      ledBlink(C_CYAN, 1);
      Serial.println("[CONFIG] updated");
    }
  }
}

void reconnect() {
  int attempt = 0;
  unsigned long lastLog = 0;

  while (!client.connected()) {
    if (attempt > 0 && (attempt % 5 == 0)) {
      Serial.println("[MQTT] re-resolving adro.local...");
      resolveBroker(3, 1000);
      client.setServer(mqtt_broker_ip, mqtt_port);
    }

    if (millis() - lastLog > 2000) {
      lastLog = millis();
      Serial.printf("[MQTT] connecting to %s:%d as %s (attempt %d, heap=%u)\n",
                    mqtt_broker_ip.toString().c_str(), mqtt_port, device_id,
                    attempt + 1, ESP.getFreeHeap());
    }

    ledSetBase(C_MAGENTA);

    // LWT: retain "offline" on status topic
    String offlinePayload = buildStatusPayload("offline");

    if (client.connect(device_id,
                       nullptr, nullptr,
                       topic_status.c_str(),
                       1,       // QoS 1
                       true,    // retain
                       offlinePayload.c_str())) {
      Serial.println("[MQTT] Connected");

      // Publish retained "online" status
      String onlinePayload = buildStatusPayload("online");
      client.publish(topic_status.c_str(), onlinePayload.c_str(), true);

      client.subscribe(topic_command.c_str(), 1);
      client.subscribe(topic_config.c_str(),  1);
      Serial.println("[MQTT] Subscribed command + config");
      ledBlink(C_CYAN, 2);
      attempt = 0;
    } else {
      int rc = client.state();
      Serial.printf("[MQTT] Failed rc=%d\n", rc);
      long delayMs = min(1000L * (attempt + 1), 30000L);
      Serial.printf("[MQTT] Reconnect delay %ld ms\n", delayMs);
      ledBlink(C_RED, 1);
      delay(delayMs);
      attempt++;
    }
  }
}

// ======================================================
//                     OTA
// ======================================================

void publishOtaEvent(const char* stage, const char* message = nullptr) {
  if (!client.connected()) return;
  DynamicJsonDocument data(256);
  data["type"]    = "ota";
  data["stage"]   = stage;
  if (message) data["message"] = message;
  String payload = buildEnvelope(data, false);
  client.publish(topic_telemetry.c_str(), payload.c_str(), false);
}

void performOTA(const char* binURL, const char* expectedHash = nullptr) {
  Serial.printf("[OTA] Starting download: %s\n", binURL);
  ledSetBase(C_CYAN);

  WiFiClient otaClient;
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(otaClient, binURL)) {
    publishOtaEvent("http_start_failed", binURL);
    ledBlink(C_RED, 5);
    return;
  }

  publishOtaEvent("download_started", binURL);
  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    publishOtaEvent("http_error", String(httpCode).c_str());
    http.end();
    ledBlink(C_RED, 5);
    return;
  }

  int contentLength = http.getSize();
  size_t freeSpace = ESP.getFreeSketchSpace() - 0x1000;
  if (contentLength <= 0 || contentLength > (int)freeSpace) {
    publishOtaEvent("invalid_size", String(contentLength).c_str());
    http.end();
    ledBlink(C_RED, 5);
    return;
  }

  if (!Update.begin(contentLength)) {
    publishOtaEvent("update_begin_failed", nullptr);
    http.end();
    ledBlink(C_RED, 5);
    return;
  }

  WiFiClient* stream = http.getStreamPtr();
  size_t written = 0;
  const size_t bufferSize = 1024;
  uint8_t buffer[bufferSize];
  unsigned char hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);

  while (http.connected() && written < (size_t)contentLength) {
    size_t available = stream->available();
    if (available) {
      size_t toRead = min(available, bufferSize);
      size_t readBytes = stream->readBytes((char*)buffer, toRead);
      if (readBytes == 0) break;
      mbedtls_sha256_update(&ctx, buffer, readBytes);
      size_t writtenNow = Update.write(buffer, readBytes);
      if (writtenNow != readBytes) {
        publishOtaEvent("write_error", nullptr);
        Update.abort();
        mbedtls_sha256_free(&ctx);
        http.end();
        ledBlink(C_RED, 5);
        return;
      }
      written += writtenNow;
    }
    delay(1);
  }

  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  http.end();

  if (written != (size_t)contentLength) {
    publishOtaEvent("size_mismatch", nullptr);
    Update.abort();
    ledBlink(C_RED, 5);
    return;
  }

  if (expectedHash != nullptr && expectedHash[0] != '\0') {
    char hashStr[65] = {0};
    for (int i = 0; i < 32; i++) sprintf(hashStr + i * 2, "%02x", hash[i]);
    char expectedLower[65] = {0};
    for (int i = 0; expectedHash[i] != '\0' && i < 64; i++)
      expectedLower[i] = tolower((unsigned char)expectedHash[i]);
    if (strcasecmp(hashStr, expectedLower) != 0) {
      publishOtaEvent("hash_mismatch", nullptr);
      Update.abort();
      ledBlink(C_RED, 5);
      return;
    }
  }

  if (Update.end(true)) {
    publishOtaEvent("success", nullptr);
    ledSetBase(C_GREEN);
    delay(500);
    ledBlink(C_GREEN, 3);
    delay(800);
    ESP.restart();
  } else {
    publishOtaEvent("update_end_failed", nullptr);
    ledBlink(C_RED, 5);
  }
}

void checkForUpdates() {
  HTTPClient http;
  http.setTimeout(10000);
  http.begin(otaManifestURL);
  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) { http.end(); return; }
  String payload = http.getString();
  http.end();

  DynamicJsonDocument doc(384);
  if (deserializeJson(doc, payload)) return;

  const char* newVersion = doc["version"];
  const char* binURL     = doc["firmware_url"];
  const char* sha256     = doc["sha256"];

  if (newVersion == nullptr || binURL == nullptr) return;

  if (strcmp(newVersion, currentFirmwareVersion) != 0) {
    Serial.printf("[OTA] New version %s (current %s)\n",
                  newVersion, currentFirmwareVersion);
    delay(300);
    performOTA(binURL, sha256);
  }
}

// ======================================================
//                     TELEMETRY
// ======================================================

void publishTelemetry() {
  DynamicJsonDocument data(512);
  data["wifi"]       = (WiFi.status() == WL_CONNECTED);
  data["mqtt"]       = client.connected();
  data["rssi"]       = WiFi.RSSI();
  data["uptime"]     = (millis() - startupTime) / 1000;
  data["heap"]       = ESP.getFreeHeap();
  data["broker_ip"]  = mqtt_broker_ip.toString();
  data["ntp_synced"] = ntpSynced;
  data["automation"] = automationEnabled;

  JsonArray ch = data.createNestedArray("channels");
  for (int i = 0; i < NUM_CHANNELS; i++) {
    JsonObject o = ch.createNestedObject();
    o["id"]     = i + 1;
    o["state"]  = channelState[i];
    o["on_s"]   = channelOnMs[i] / 1000.0;
    o["off_s"]  = channelOffMs[i] / 1000.0;
  }

  String payload = buildEnvelope(data, false);
  client.publish(topic_telemetry.c_str(), payload.c_str(), false);
  ledBlink(C_GREEN, 1);
}

// ======================================================
//                  AUTOMATION LOGIC
// ======================================================

void updateChannels() {
  unsigned long now = millis();

  for (int i = 0; i < NUM_CHANNELS; i++) {
    // Timed auto-off (one-shot)
    if (channelState[i] && channelAutoOff[i] > 0) {
      if (now - channelTimer[i] >= channelAutoOff[i]) {
        channelState[i] = false;
        setChannel(i, false);
        channelAutoOff[i] = 0;
        channelTimer[i] = now;
        Serial.printf("[AUTO] CH%d timed OFF\n", i + 1);
        saveSettings();
      }
      continue;
    }

    // Continuous automation
    if (automationEnabled) {
      unsigned long period = channelState[i] ? channelOnMs[i] : channelOffMs[i];
      if (now - channelTimer[i] >= period) {
        channelState[i] = !channelState[i];
        setChannel(i, channelState[i]);
        channelTimer[i] = now;
        Serial.printf("[AUTO] CH%d -> %s\n", i + 1, channelState[i] ? "ON" : "OFF");
      }
    }
  }
}

// ======================================================
//                     REBOOT
// ======================================================

void checkAndReboot() {
  if ((millis() - startupTime) >= rebootInterval) {
    Serial.println("[SYS] Scheduled reboot");
    ledSetBase(C_WHITE);
    delay(500);
    ESP.restart();
  }
}

// ======================================================
//                     SETUP
// ======================================================

void setup() {
  Serial.begin(115200);
  delay(200);

  ledBegin();
  ledSetBase(C_WHITE);
  ledBlink(C_WHITE, 2);

  Serial.printf("[INFO] Firmware version: %s\n", currentFirmwareVersion);
  Serial.printf("[INFO] OTA manifest URL: %s\n", otaManifestURL);
  Serial.printf("[INFO] MQTT host: %s:%d\n", mqtt_host, mqtt_port);

  EEPROM.begin(EEPROM_SIZE);
  loadSettings();

  for (int i = 0; i < NUM_CHANNELS; i++) {
    pinMode(CHANNEL_PINS[i], OUTPUT);
    setChannel(i, channelState[i]);
    channelTimer[i] = millis();
  }

  setup_wifi();
  syncNTP();

  topic_telemetry = "adro/" + String(site_id) + "/switch/" + String(device_id) + "/telemetry";
  topic_status    = "adro/" + String(site_id) + "/switch/" + String(device_id) + "/status";
  topic_command   = "adro/" + String(site_id) + "/switch/" + String(device_id) + "/command";
  topic_config    = "adro/" + String(site_id) + "/switch/" + String(device_id) + "/config";

  Serial.printf("[BOOT] broker=%s:%d\n",
                mqtt_broker_ip.toString().c_str(), mqtt_port);
  client.setServer(mqtt_broker_ip, mqtt_port);
  client.setCallback(mqttCallback);
  client.setKeepAlive(60);

  reconnect();
  publishTelemetry();

  startupTime = millis();
  for (int i = 0; i < NUM_CHANNELS; i++) channelTimer[i] = millis();
  ledUpdateStatus();
}

// ======================================================
//                     LOOP
// ======================================================

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  updateChannels();

  if (millis() - lastTelemetry >= telemetryInterval) {
    lastTelemetry = millis();
    if (!client.connected()) reconnect();
    publishTelemetry();
  }

  if (millis() - lastOtaCheck >= otaInterval) {
    lastOtaCheck = millis();
    checkForUpdates();
  }

  checkAndReboot();
  ledUpdateStatus();
  ledLoop();
}
