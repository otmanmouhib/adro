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

const char* currentFirmwareVersion = "1.0.46";
const char* otaManifestBase = "http://adro.local:8000";

const char* mqtt_host = "adro.local";
const int   mqtt_port = 1883;

IPAddress   mqtt_broker_ip;

unsigned long lastOtaCheck = 0;
const unsigned long otaInterval = 60000;

const long gmtOffset_sec = 3600;
const int daylightOffset_sec = 0;
bool ntpSynced = false;

// ==== Channels ====
const int NUM_CHANNELS = 4;
const int CHANNEL_PINS[NUM_CHANNELS] = {4, 5, 6, 7};
const bool CHANNEL_ACTIVE_HIGH = true;

inline void setChannel(int idx, bool on) {
  if (idx < 0 || idx >= NUM_CHANNELS) return;
  if (CHANNEL_ACTIVE_HIGH) digitalWrite(CHANNEL_PINS[idx], on ? HIGH : LOW);
  else                     digitalWrite(CHANNEL_PINS[idx], on ? LOW  : HIGH);
}

bool          channelState[NUM_CHANNELS]   = {false, false, false, false};
bool          channelAutomationEnabled[NUM_CHANNELS] = {false, false, false, false};
unsigned long channelOnMs[NUM_CHANNELS]    = {1000, 1000, 1000, 1000};
unsigned long channelOffMs[NUM_CHANNELS]   = {1000, 1000, 1000, 1000};
unsigned long channelTimer[NUM_CHANNELS]   = {0, 0, 0, 0};
unsigned long channelAutoOff[NUM_CHANNELS] = {0, 0, 0, 0};

bool automationEnabled = false;

// ==== WiFi ====
const char* ssid     = "Tenda_2AAA80";
const char* password = "";

// ==== Identity ====
String deviceMac;
const char* deviceType = "switch";
bool   claimed = false;

// ==== Topics ====
String topic_hello;
String topic_bye;
String topic_claimed;
String topic_unclaimed;
String topic_claim_ack;
String topic_status;
String topic_telemetry;
String topic_command;
String topic_config;

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastTelemetry = 0;
const long telemetryInterval = 15000;
unsigned long lastHello = 0;
const long helloInterval = 30000;

unsigned long startupTime = 0;
const unsigned long rebootInterval = 6UL * 60UL * 60UL * 1000UL;

uint32_t seqCounter = 0;

// ======================================================
//         RECONNECT BACKOFF
// ======================================================
unsigned long lastReconnectAttempt = 0;
unsigned long reconnectBackoff = 3000;
const unsigned long RECONNECT_BACKOFF_MIN = 3000;
const unsigned long RECONNECT_BACKOFF_MAX = 60000;

// ======================================================
//                     EEPROM
// ======================================================
#define EEPROM_SIZE       128
#define EEPROM_MAGIC      0xAD
#define ADDR_MAGIC        0
#define ADDR_AUTOMATION   1
#define ADDR_CLAIMED      2
#define ADDR_SETTINGS_VERSION 3
#define ADDR_CHANNEL_BASE 8
#define SETTINGS_VERSION  1

bool anyChannelAutomationEnabled() {
  for (int i = 0; i < NUM_CHANNELS; i++) {
    if (channelAutomationEnabled[i]) return true;
  }
  return false;
}

bool saveSettings() {
  automationEnabled = anyChannelAutomationEnabled();
  EEPROM.write(ADDR_MAGIC, EEPROM_MAGIC);
  EEPROM.write(ADDR_AUTOMATION, automationEnabled ? 1 : 0);
  EEPROM.write(ADDR_CLAIMED, claimed ? 1 : 0);
  EEPROM.write(ADDR_SETTINGS_VERSION, SETTINGS_VERSION);

  for (int i = 0; i < NUM_CHANNELS; i++) {
    int base = ADDR_CHANNEL_BASE + i * 12;
    EEPROM.put(base + 0, channelOnMs[i]);
    EEPROM.put(base + 4, channelOffMs[i]);
    EEPROM.write(base + 8, channelState[i] ? 1 : 0);
    EEPROM.write(base + 9, channelAutomationEnabled[i] ? 1 : 0);
  }
  bool saved = EEPROM.commit();
  Serial.println(saved ? "[EEPROM] saved" : "[EEPROM] save failed");
  return saved;
}

void loadSettings() {
  if (EEPROM.read(ADDR_MAGIC) == EEPROM_MAGIC) {
    bool hasPerChannelAutomation =
      EEPROM.read(ADDR_SETTINGS_VERSION) == SETTINGS_VERSION;
    automationEnabled = EEPROM.read(ADDR_AUTOMATION) == 1;
    claimed           = EEPROM.read(ADDR_CLAIMED)    == 1;

    for (int i = 0; i < NUM_CHANNELS; i++) {
      int base = ADDR_CHANNEL_BASE + i * 12;
      EEPROM.get(base + 0, channelOnMs[i]);
      EEPROM.get(base + 4, channelOffMs[i]);
      channelState[i] = EEPROM.read(base + 8) == 1;
      channelAutomationEnabled[i] = hasPerChannelAutomation
        ? EEPROM.read(base + 9) == 1
        : automationEnabled;
    }
    if (!hasPerChannelAutomation) saveSettings();
    else automationEnabled = anyChannelAutomationEnabled();
    Serial.printf("[EEPROM] loaded: claimed=%d automation=%d\n",
                  claimed, automationEnabled);
  } else {
    Serial.println("[EEPROM] no valid data, defaults");
    saveSettings();
  }
}

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
  rgbLed.setPixelColor(0, C_WHITE); rgbLed.show(); delay(150);
  rgbLed.setPixelColor(0, C_OFF);   rgbLed.show();
  ledBaseShown = C_OFF;
}
void ledSetBase(uint32_t color) {
  ledBaseColor = color;
  if (!ledBlinkActive && ledBaseShown != color) {
    rgbLed.setPixelColor(0, color); rgbLed.show(); ledBaseShown = color;
  }
}
void ledBlink(uint32_t color, uint8_t times) {
  if (times == 0) return;
  ledBlinkActive = true; ledBlinkColor = color;
  ledBlinkRemaining = times * 2; ledBlinkOn = true;
  ledBlinkLast = millis();
  rgbLed.setPixelColor(0, color); rgbLed.show(); ledBaseShown = color;
}
void ledLoop() {
  if (!ledBlinkActive) return;
  if (millis() - ledBlinkLast < LED_BLINK_INTERVAL) return;
  ledBlinkLast = millis();
  ledBlinkOn = !ledBlinkOn; ledBlinkRemaining--;
  if (ledBlinkRemaining == 0) {
    ledBlinkActive = false;
    rgbLed.setPixelColor(0, ledBaseColor); rgbLed.show(); ledBaseShown = ledBaseColor;
  } else {
    uint32_t c = ledBlinkOn ? ledBlinkColor : C_OFF;
    rgbLed.setPixelColor(0, c); rgbLed.show(); ledBaseShown = c;
  }
}
bool anyChannelOn() {
  for (int i = 0; i < NUM_CHANNELS; i++) if (channelState[i]) return true;
  return false;
}
void ledUpdateStatus() {
  uint32_t c;
  if (!claimed)                                  c = C_YELLOW;
  else if (WiFi.status() != WL_CONNECTED)        c = C_BLUE;
  else if (!ntpSynced)                           c = C_YELLOW;
  else if (!client.connected())                  c = C_MAGENTA;
  else if (anyChannelOn())                       c = C_GREEN;
  else if (automationEnabled)                    c = C_ORANGE;
  else                                           c = C_DIM_BLUE;
  ledSetBase(c);
}

// ======================================================
//                     NTP
// ======================================================
time_t getUnixTimestamp() {
  if (!ntpSynced) return 0;
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return 0;
  return mktime(&timeinfo);
}
void syncNTP() {
  Serial.println("[NTP] sync...");
  configTime(gmtOffset_sec, daylightOffset_sec,
             "216.239.35.0", "162.159.200.1", "129.6.15.28");
  struct tm timeinfo;
  for (int attempt = 1; attempt <= 3; attempt++) {
    if (getLocalTime(&timeinfo, 5000)) {
      ntpSynced = true;
      Serial.printf("[NTP] OK %04d-%02d-%02d %02d:%02d:%02d\n",
                    timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
      ledBlink(C_GREEN, 2);
      return;
    }
    delay(1000);
  }
  Serial.println("[NTP] FAIL, will retry");
  ledBlink(C_RED, 2);
  ntpSynced = false;
}

// ======================================================
//                Identity / topics
// ======================================================
void readMac() {
  uint8_t base[6];
  esp_efuse_mac_get_default(base);
  char buf[13];
  snprintf(buf, sizeof(buf), "%02x%02x%02x%02x%02x%02x",
           base[0], base[1], base[2], base[3], base[4], base[5]);
  deviceMac = String(buf);
  Serial.printf("[ID] MAC=%s type=%s\n", deviceMac.c_str(), deviceType);
}

void computeTopics() {
  String base = "adro/devices/" + String(deviceType) + "/" + deviceMac;

  topic_hello     = "adro/unclaimed/" + deviceMac + "/hello";
  topic_bye       = "adro/unclaimed/" + deviceMac + "/bye";
  topic_claimed   = base + "/claimed";
  topic_unclaimed = base + "/unclaimed";
  topic_claim_ack = base + "/claim-ack";
  topic_status    = base + "/status";
  topic_telemetry = base + "/telemetry";
  topic_command   = base + "/command";
  topic_config    = base + "/config";
}

// ======================================================
//                Broker resolution (mDNS)
// ======================================================
bool resolveBroker(int attempts = 5, int delayMs = 2000) {
  for (int i = 1; i <= attempts; i++) {
    IPAddress ip;
    if (WiFi.hostByName(mqtt_host, ip)) {
      mqtt_broker_ip = ip;
      Serial.printf("[NET] %s -> %s (attempt %d)\n",
                    mqtt_host, ip.toString().c_str(), i);
      return true;
    }
    Serial.printf("[NET] resolve %s failed (%d/%d)\n", mqtt_host, i, attempts);
    delay(delayMs);
  }
  Serial.println("[NET] mDNS FAILED");
  return false;
}

// ======================================================
//                     WiFi
// ======================================================
void setup_wifi() {
  ledSetBase(C_BLUE);
  Serial.printf("[WiFi] connecting to %s\n", ssid);
  WiFi.mode(WIFI_STA);
  if (strlen(password) == 0) WiFi.begin(ssid);
  else                       WiFi.begin(ssid, password);

  unsigned long startAttempt = millis();
  unsigned long lastPulse = millis();
  bool pulseOn = true;

  while (WiFi.status() != WL_CONNECTED) {
    delay(150);
    if (millis() - lastPulse >= 250) {
      lastPulse = millis(); pulseOn = !pulseOn;
      rgbLed.setPixelColor(0, pulseOn ? C_BLUE : C_OFF); rgbLed.show();
      ledBaseShown = pulseOn ? C_BLUE : C_OFF;
    }
    if (millis() - startAttempt > 30000) {
      Serial.println("[WiFi] TIMEOUT, restarting");
      delay(500);
      ESP.restart();
    }
  }
  Serial.printf("[WiFi] connected IP=%s RSSI=%d MAC=%s\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                WiFi.macAddress().c_str());

  if (!MDNS.begin(deviceMac.c_str())) {
    Serial.println("[mDNS] init FAILED");
  } else {
    Serial.printf("[mDNS] this device = %s.local\n", deviceMac.c_str());
  }

  resolveBroker();
}

// ==== runtime WiFi check ====
void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("[WiFi] lost, reconnecting");
  ledSetBase(C_BLUE);
  WiFi.disconnect();
  delay(100);
  WiFi.begin(ssid, password);

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(200);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] reconnected IP=%s\n",
                  WiFi.localIP().toString().c_str());
    if (resolveBroker(3, 1000)) {
      client.setServer(mqtt_broker_ip, mqtt_port);
    }
  } else {
    Serial.println("[WiFi] reconnect failed, will retry");
  }
}

// ======================================================
//                Envelopes
// ======================================================
String buildEnvelope(JsonDocument& data) {
  DynamicJsonDocument env(1536);
  env["ts"]   = (uint32_t)getUnixTimestamp();
  env["seq"]  = seqCounter++;
  env["v"]    = currentFirmwareVersion;
  env["mac"]  = deviceMac;
  env["type"] = deviceType;
  env["data"] = data;
  String out;
  serializeJson(env, out);
  return out;
}
String buildStatusPayload(const char* state) {
  DynamicJsonDocument env(256);
  env["ts"]   = (uint32_t)getUnixTimestamp();
  env["seq"]  = seqCounter++;
  env["v"]    = currentFirmwareVersion;
  env["mac"]  = deviceMac;
  env["type"] = deviceType;
  JsonObject data = env.createNestedObject("data");
  data["state"] = state;
  String out;
  serializeJson(env, out);
  return out;
}

// ======================================================
//                Flush helper (before restart)
// ======================================================
void flushOutbound(unsigned long windowMs = 1500) {
  unsigned long t0 = millis();
  while (millis() - t0 < windowMs) {
    client.loop();
    delay(50);
  }
}

// ======================================================
//                     Claim handling
// ======================================================
void clearRetainedClaimCommands() {
  client.publish(topic_claimed.c_str(), "", true);
  client.publish(topic_unclaimed.c_str(), "", true);
}

void publishClaimAck(const char* requestId, bool ok, bool isClaimed) {
  StaticJsonDocument<192> doc;
  doc["mac"] = deviceMac;
  doc["type"] = deviceType;
  doc["requestId"] = requestId;
  doc["ok"] = ok;
  doc["claimed"] = isClaimed;
  String out;
  serializeJson(doc, out);
  client.publish(topic_claim_ack.c_str(), out.c_str(), false);
}

void publishHello() {
  DynamicJsonDocument doc(256);
  doc["mac"]   = deviceMac;
  doc["type"]  = deviceType;
  doc["fw"]    = currentFirmwareVersion;
  doc["ip"]    = WiFi.localIP().toString();
  doc["model"] = "switch-v0";
  doc["capabilities"] = "4ch-ssr";
  String out;
  serializeJson(doc, out);
  client.publish(topic_hello.c_str(), out.c_str(), true);
  Serial.printf("[CLAIM] hello published (mac=%s)\n", deviceMac.c_str());
  lastHello = millis();
}

// ==== Extract MAC from payload, accepting either field name ====
static String extractMac(JsonObject d) {
  String mac = d["mac"] | "";
  if (mac.length() == 0) mac = d["device_id"] | "";
  if (mac.length() == 0) mac = d["id"] | "";
  mac.toLowerCase();
  return mac;
}

void handleClaim(JsonObject d) {
  const char* requestId = d["requestId"] | "";
  String mac = extractMac(d);
  if (mac.length() == 0) {
    Serial.println("[CLAIM] missing mac/device_id, ignoring");
    return;
  }
  if (mac != deviceMac) {
    Serial.printf("[CLAIM] mac mismatch: got %s expected %s\n",
                  mac.c_str(), deviceMac.c_str());
    return;
  }

  String remoteType = d["type"] | "";
  if (remoteType.length() > 0 && remoteType != deviceType) {
    Serial.printf("[CLAIM] refusing: type mismatch (remote=%s)\n",
                  remoteType.c_str());
    return;
  }

  if (claimed) {
    clearRetainedClaimCommands();
    flushOutbound();
    publishClaimAck(requestId, true, true);
    return;
  }

  Serial.printf("[CLAIM] ACCEPTED (mac=%s)\n", deviceMac.c_str());

  claimed = true;
  if (!saveSettings()) {
    claimed = false;
    publishClaimAck(requestId, false, false);
    flushOutbound();
    return;
  }
  computeTopics();

  clearRetainedClaimCommands();
  // Clear retained hello so dashboards stop showing this as unclaimed
  client.publish(topic_hello.c_str(), "", true);
  publishClaimAck(requestId, true, true);
  flushOutbound(1500);

  ledBlink(C_GREEN, 3);
  delay(500);
  ESP.restart();
}

void handleUnclaim(JsonObject d) {
  const char* requestId = d["requestId"] | "";
  String mac = extractMac(d);
  if (mac.length() == 0) {
    Serial.println("[CLAIM] unclaim: missing mac/device_id, ignoring");
    return;
  }
  if (mac != deviceMac) return;

  if (!claimed) {
    publishClaimAck(requestId, true, false);
    return;
  }

  Serial.println("[CLAIM] unclaimed, back to discovery");
  claimed = false;
  if (!saveSettings()) {
    claimed = true;
    publishClaimAck(requestId, false, true);
    flushOutbound();
    return;
  }
  computeTopics();

  clearRetainedClaimCommands();
  client.publish(topic_status.c_str(), "", true);
  client.publish(topic_hello.c_str(), "", true);
  client.publish(topic_bye.c_str(), "{}", false);
  publishClaimAck(requestId, true, false);
  flushOutbound(1200);

  ledBlink(C_RED, 3);
  delay(500);
  ESP.restart();
}

// ======================================================
//                Command handling
// ======================================================
void publishTelemetry();

void handleSetChannel(JsonObject d) {
  if (!d.containsKey("channel")) return;
  int ch = d["channel"].as<int>() - 1;
  if (ch < 0 || ch >= NUM_CHANNELS) return;
  bool on = true;
  if (d.containsKey("state")) {
    String s = d["state"].as<String>();
    on = (s == "on" || s == "true" || s == "1");
  }
  bool previousState = channelState[ch];
  unsigned long previousTimer = channelTimer[ch];
  unsigned long previousAutoOff = channelAutoOff[ch];
  channelState[ch] = on;
  setChannel(ch, on);
  channelTimer[ch] = millis();
  channelAutoOff[ch] = 0;

  if (on && d.containsKey("duration_s")) {
    unsigned long dur = d["duration_s"].as<unsigned long>();
    if (dur > 0) {
      unsigned long ms = dur * 1000UL;
      if (ms / 1000UL != dur) ms = 3600000UL;
      channelAutoOff[ch] = ms;
    }
  }
  if (!saveSettings()) {
    channelState[ch] = previousState;
    setChannel(ch, previousState);
    channelTimer[ch] = previousTimer;
    channelAutoOff[ch] = previousAutoOff;
  }
  ledUpdateStatus();
  publishTelemetry();
  Serial.printf("[CMD] CH%d -> %s\n", ch + 1, on ? "ON" : "OFF");
}

void handleSetAll(JsonObject d) {
  bool on = true;
  if (d.containsKey("state")) {
    String s = d["state"].as<String>();
    on = (s == "on" || s == "true" || s == "1");
  }
  bool previousStates[NUM_CHANNELS];
  bool previousAutomation[NUM_CHANNELS];
  for (int i = 0; i < NUM_CHANNELS; i++) {
    previousStates[i] = channelState[i];
    previousAutomation[i] = channelAutomationEnabled[i];
    channelState[i] = on; setChannel(i, on);
    channelTimer[i] = millis(); channelAutoOff[i] = 0;
    if (!on) channelAutomationEnabled[i] = false;
  }
  if (!saveSettings()) {
    for (int i = 0; i < NUM_CHANNELS; i++) {
      channelState[i] = previousStates[i];
      channelAutomationEnabled[i] = previousAutomation[i];
      setChannel(i, previousStates[i]);
    }
    automationEnabled = anyChannelAutomationEnabled();
  }
  ledUpdateStatus();
  publishTelemetry();
}

void handleAutomation(JsonObject d) {
  if (!d.containsKey("enabled")) return;
  bool enabled = d["enabled"].as<bool>();
  bool previousAutomation[NUM_CHANNELS];
  for (int i = 0; i < NUM_CHANNELS; i++) {
    previousAutomation[i] = channelAutomationEnabled[i];
  }

  if (d.containsKey("channel")) {
    int channel = d["channel"].as<int>() - 1;
    if (channel < 0 || channel >= NUM_CHANNELS) return;
    channelAutomationEnabled[channel] = enabled;
    if (enabled) channelTimer[channel] = millis();
  } else {
    for (int i = 0; i < NUM_CHANNELS; i++) {
      channelAutomationEnabled[i] = enabled;
      if (enabled) channelTimer[i] = millis();
    }
  }

  if (!saveSettings()) {
    for (int i = 0; i < NUM_CHANNELS; i++) {
      channelAutomationEnabled[i] = previousAutomation[i];
    }
    automationEnabled = anyChannelAutomationEnabled();
  }
  ledUpdateStatus();
  publishTelemetry();
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  ledBlink(C_WHITE, 1);
  String topicStr = String(topic);

  DynamicJsonDocument env(768);
  if (deserializeJson(env, payload, length)) {
    Serial.println("[MQTT] JSON parse error");
    ledBlink(C_RED, 2);
    return;
  }

  // Debug: log every incoming message
  Serial.printf("[MQTT] recv %s (%u bytes)\n", topicStr.c_str(), length);

  if (topicStr == topic_claimed) {
    handleClaim(env.as<JsonObject>());
    return;
  }
  if (topicStr == topic_unclaimed) {
    handleUnclaim(env.as<JsonObject>());
    return;
  }

  if (!env.containsKey("data")) return;
  JsonObject d = env["data"].as<JsonObject>();

  if (topicStr == topic_command) {
    const char* action = d["action"] | "";
    if      (strcmp(action, "set_channel") == 0) handleSetChannel(d);
    else if (strcmp(action, "set_all")     == 0) handleSetAll(d);
    else if (strcmp(action, "automation")  == 0) handleAutomation(d);
    else if (strcmp(action, "get_state")   == 0) publishTelemetry();
    else if (strcmp(action, "reboot")      == 0) { delay(500); ESP.restart(); }
    else Serial.printf("[CMD] unknown '%s'\n", action);
  } else if (topicStr == topic_config) {
    bool changed = false;
    unsigned long previousOnMs[NUM_CHANNELS];
    unsigned long previousOffMs[NUM_CHANNELS];
    unsigned long previousTimers[NUM_CHANNELS];
    for (int i = 0; i < NUM_CHANNELS; i++) {
      previousOnMs[i] = channelOnMs[i];
      previousOffMs[i] = channelOffMs[i];
      previousTimers[i] = channelTimer[i];
    }

    if (d.containsKey("channel")) {
      int channel = d["channel"].as<int>() - 1;
      if (channel < 0 || channel >= NUM_CHANNELS ||
          !d.containsKey("on_s") || !d.containsKey("off_s")) {
        publishTelemetry();
        return;
      }
      float onSeconds = d["on_s"].as<float>();
      float offSeconds = d["off_s"].as<float>();
      if (onSeconds < 1.0f || onSeconds > 86400.0f ||
          offSeconds < 1.0f || offSeconds > 86400.0f) {
        publishTelemetry();
        return;
      }
      channelOnMs[channel] = (unsigned long)(onSeconds * 1000.0f);
      channelOffMs[channel] = (unsigned long)(offSeconds * 1000.0f);
      channelTimer[channel] = millis();
      changed = true;
    } else {
      if (d.containsKey("channel_on_s")) {
        JsonArray a = d["channel_on_s"].as<JsonArray>();
        for (int i = 0; i < NUM_CHANNELS && i < (int)a.size(); i++) {
          float seconds = a[i].as<float>();
          if (seconds >= 1.0f && seconds <= 86400.0f) {
            channelOnMs[i] = (unsigned long)(seconds * 1000.0f);
            changed = true;
          }
        }
      }
      if (d.containsKey("channel_off_s")) {
        JsonArray a = d["channel_off_s"].as<JsonArray>();
        for (int i = 0; i < NUM_CHANNELS && i < (int)a.size(); i++) {
          float seconds = a[i].as<float>();
          if (seconds >= 1.0f && seconds <= 86400.0f) {
            channelOffMs[i] = (unsigned long)(seconds * 1000.0f);
            changed = true;
          }
        }
      }
    }
    if (changed && !saveSettings()) {
      for (int i = 0; i < NUM_CHANNELS; i++) {
        channelOnMs[i] = previousOnMs[i];
        channelOffMs[i] = previousOffMs[i];
        channelTimer[i] = previousTimers[i];
      }
    }
    publishTelemetry();
  }
}

// ======================================================
//        MQTT reconnect — with backoff
// ======================================================
void reconnect() {
  unsigned long now = millis();
  if (now - lastReconnectAttempt < reconnectBackoff) return;
  lastReconnectAttempt = now;

  Serial.printf("[MQTT] connecting as %s (backoff=%lus)\n",
                deviceMac.c_str(), reconnectBackoff / 1000);

  bool ok;
  if (claimed) {
    String offline = buildStatusPayload("offline");
    ok = client.connect(deviceMac.c_str(), nullptr, nullptr,
                        topic_status.c_str(), 1, true,
                        offline.c_str());
  } else {
    ok = client.connect(deviceMac.c_str(), nullptr, nullptr,
                        nullptr, 0, false, nullptr);
  }

  if (ok) {
    Serial.println("[MQTT] connected");
    reconnectBackoff = RECONNECT_BACKOFF_MIN;

    if (claimed) {
      String online = buildStatusPayload("online");
      client.publish(topic_status.c_str(), online.c_str(), true);
      client.subscribe(topic_command.c_str(), 1);
      client.subscribe(topic_config.c_str(),  1);
      client.subscribe(topic_unclaimed.c_str(), 1);
      Serial.println("[MQTT] subscribed (claimed)");
    } else {
      client.subscribe(topic_claimed.c_str(), 1);
      publishHello();
      Serial.println("[MQTT] subscribed (unclaimed)");
    }
    ledBlink(C_CYAN, 2);
  } else {
    Serial.printf("[MQTT] failed rc=%d\n", client.state());
    ledBlink(C_RED, 1);
    reconnectBackoff = min(reconnectBackoff * 2, RECONNECT_BACKOFF_MAX);
  }
}

// ======================================================
//                Telemetry
// ======================================================
void publishTelemetry() {
  if (!claimed) return;

  DynamicJsonDocument data(768);
  data["wifi"]       = (WiFi.status() == WL_CONNECTED);
  data["mqtt"]       = client.connected();
  data["rssi"]       = WiFi.RSSI();
  data["uptime"]     = (millis() - startupTime) / 1000;
  data["heap"]       = ESP.getFreeHeap();
  data["broker_ip"]  = mqtt_broker_ip.toString();
  data["ntp_synced"] = ntpSynced;
  data["automation"] = anyChannelAutomationEnabled();
  JsonArray ch = data.createNestedArray("channels");
  for (int i = 0; i < NUM_CHANNELS; i++) {
    JsonObject o = ch.createNestedObject();
    o["id"]    = i + 1;
    o["state"] = channelState[i];
    o["automation"] = channelAutomationEnabled[i];
    o["on_s"]  = channelOnMs[i] / 1000.0;
    o["off_s"] = channelOffMs[i] / 1000.0;
    unsigned long elapsed = millis() - channelTimer[i];
    o["auto_off_remaining_s"] = channelAutoOff[i] > elapsed
      ? (channelAutoOff[i] - elapsed) / 1000.0
      : 0;
  }
  String payload = buildEnvelope(data);
  if (client.publish(topic_telemetry.c_str(), payload.c_str(), false)) {
    lastTelemetry = millis();
    ledBlink(C_GREEN, 1);
  } else {
    Serial.printf("[TELEMETRY] publish failed (%u-byte payload)\n",
                  payload.length());
  }
}

// ======================================================
//                Automation logic
// ======================================================
void updateChannels() {
  unsigned long now = millis();
  for (int i = 0; i < NUM_CHANNELS; i++) {
    if (channelState[i] && channelAutoOff[i] > 0) {
      if (now - channelTimer[i] >= channelAutoOff[i]) {
        channelState[i] = false; setChannel(i, false);
        channelAutoOff[i] = 0; channelTimer[i] = now;
        saveSettings();
      }
      continue;
    }
    if (channelAutomationEnabled[i]) {
      unsigned long period = channelState[i] ? channelOnMs[i] : channelOffMs[i];
      if (now - channelTimer[i] >= period) {
        channelState[i] = !channelState[i];
        setChannel(i, channelState[i]);
        channelTimer[i] = now;
      }
    }
  }
}

void checkAndReboot() {
  if (!claimed) return;
  if ((millis() - startupTime) >= rebootInterval) {
    Serial.println("[BOOT] scheduled 6h reboot");
    delay(500);
    ESP.restart();
  }
}

// ======================================================
//                OTA
// ======================================================
void performOTA(const char* binURL) {
  Serial.printf("[OTA] %s\n", binURL);
  WiFiClient otaClient;
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(otaClient, binURL)) return;
  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) { http.end(); return; }
  int contentLength = http.getSize();
  if (contentLength <= 0 || !Update.begin(contentLength)) { http.end(); return; }
  WiFiClient* stream = http.getStreamPtr();
  size_t written = 0;
  uint8_t buffer[1024];
  while (http.connected() && written < (size_t)contentLength) {
    size_t avail = stream->available();
    if (avail) {
      size_t r = stream->readBytes((char*)buffer, min(avail, sizeof(buffer)));
      if (!r) break;
      if (Update.write(buffer, r) != r) { Update.abort(); http.end(); return; }
      written += r;
    }
    delay(1);
  }
  http.end();
  if (written == (size_t)contentLength && Update.end(true)) {
    delay(500); ESP.restart();
  }
}

void checkForUpdates() {
  if (!claimed) return;

  String url = String(otaManifestBase) + "/" + String(deviceType) + "/manifest.json";

  HTTPClient http;
  http.setTimeout(10000);
  http.begin(url);
  if (http.GET() != HTTP_CODE_OK) { http.end(); return; }
  String payload = http.getString();
  http.end();

  DynamicJsonDocument doc(384);
  if (deserializeJson(doc, payload)) return;

  const char* newVersion = doc["version"];
  const char* binURL     = doc["firmware_url"];

  if (newVersion && binURL && strcmp(newVersion, currentFirmwareVersion) != 0) {
    Serial.printf("[OTA] fleet update %s -> %s\n", currentFirmwareVersion, newVersion);
    performOTA(binURL);
  }
}

// ======================================================
//                setup / loop
// ======================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  ledBegin();
  ledSetBase(C_WHITE);
  ledBlink(C_WHITE, 2);

  readMac();

  EEPROM.begin(EEPROM_SIZE);
  loadSettings();

  computeTopics();

  Serial.printf("[BOOT] fw=%s claimed=%d mac=%s\n",
                currentFirmwareVersion, claimed, deviceMac.c_str());

  for (int i = 0; i < NUM_CHANNELS; i++) {
    pinMode(CHANNEL_PINS[i], OUTPUT);
    setChannel(i, channelState[i]);
    channelTimer[i] = millis();
  }

  setup_wifi();
  syncNTP();

  client.setServer(mqtt_broker_ip, mqtt_port);
  client.setCallback(mqttCallback);
  client.setKeepAlive(60);
  client.setSocketTimeout(30);
  if (!client.setBufferSize(1024)) {
    Serial.println("[MQTT] failed to allocate 1024-byte packet buffer");
  }

  reconnect();

  if (claimed) publishTelemetry();

  startupTime = millis();
  for (int i = 0; i < NUM_CHANNELS; i++) channelTimer[i] = millis();
  ledUpdateStatus();
}

void loop() {
  // 10s heartbeat log
  static unsigned long lastLog = 0;
  if (millis() - lastLog > 10000) {
    lastLog = millis();
    Serial.printf("[LOOP] up=%lus heap=%u rssi=%d wifi=%d mqtt=%d claimed=%d seq=%u\n",
                  millis() / 1000, ESP.getFreeHeap(), WiFi.RSSI(),
                  WiFi.status() == WL_CONNECTED,
                  client.connected(), claimed, seqCounter);
  }

  ensureWifi();

  if (!client.connected()) {
    reconnect();
  } else {
    client.loop();
  }

  if (!claimed) {
    if (millis() - lastHello >= helloInterval) publishHello();
  } else {
    updateChannels();
    if (millis() - lastTelemetry >= telemetryInterval) {
      lastTelemetry = millis();
      publishTelemetry();
    }
    if (millis() - lastOtaCheck >= otaInterval) {
      lastOtaCheck = millis();
      checkForUpdates();
    }
  }

  checkAndReboot();
  ledUpdateStatus();
  ledLoop();
}