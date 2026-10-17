#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <time.h>
#include <EEPROM.h>
#include <mbedtls/sha256.h>
#include <ESPmDNS.h>

const char* currentFirmwareVersion = "1.0.13";
const char* otaManifestBase = "http://adro.local:8000";
const char* mqttHost = "adro.local";
const int mqttPort = 1883;
const char* ssid = "Tenda_2AAA80";
const char* wifiPassword = "";

const int NUM_PUMPS = 2;
const int PUMP_IN1[NUM_PUMPS] = {26, 14};
const int PUMP_IN2[NUM_PUMPS] = {27, 12};
const uint32_t MIN_DOSE_MS = 100;
const uint32_t MAX_DOSE_MS = 600000;
const float MIN_DOSE_ML = 5.0f;
const float MAX_DOSE_ML = 50.0f;
const float MIN_FLOW_ML_PER_SEC = 1.0f;
const float MAX_FLOW_ML_PER_SEC = 10.0f;

const unsigned long TELEMETRY_INTERVAL_MS = 15000;
const unsigned long HELLO_INTERVAL_MS = 30000;
const unsigned long OTA_INTERVAL_MS = 60000;
const unsigned long REBOOT_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL;
const unsigned long NTP_RETRY_INTERVAL_MS = 5UL * 60UL * 1000UL;
const long GMT_OFFSET_SEC = 3600;
const int DAYLIGHT_OFFSET_SEC = 0;

#define EEPROM_SIZE 128
#define EEPROM_MAGIC 0xAE
#define EEPROM_SCHEMA 0xD4
#define ADDR_MAGIC 0
#define ADDR_SCHEMA 1
#define ADDR_CLAIMED 2
#define ADDR_PUMP_BASE 8
#define PUMP_EEPROM_STRIDE 16

#define LEGACY_DOSE_A_TIME 4
#define LEGACY_DOSE_A_INTERVAL 8
#define LEGACY_DOSE_B_TIME 12
#define LEGACY_DOSE_B_INTERVAL 16
#define LEGACY_LAST_DOSE_A 20
#define LEGACY_LAST_DOSE_B 24

float pumpDoseMl[NUM_PUMPS] = {5.0f, 5.0f};
float pumpFlowMlPerSecond[NUM_PUMPS] = {0.0f, 0.0f};
bool pumpRunning[NUM_PUMPS] = {false, false};
uint32_t pumpLastDose[NUM_PUMPS] = {0, 0};
uint32_t activeDoseMs[NUM_PUMPS] = {0, 0};
unsigned long pumpStartedAt[NUM_PUMPS] = {0, 0};

String deviceMac;
const char* deviceType = "doser";
bool claimed = false;
String topicHello;
String topicBye;
String topicClaimed;
String topicUnclaimed;
String topicClaimAck;
String topicStatus;
String topicTelemetry;
String topicCommand;
String topicConfig;
String topicOtaStatus;

WiFiClient networkClient;
PubSubClient client(networkClient);
IPAddress brokerIp;
bool ntpSynced = false;
unsigned long startupTime = 0;
unsigned long lastTelemetry = 0;
unsigned long lastHello = 0;
unsigned long lastOtaCheck = 0;
unsigned long lastNtpRetry = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long lastVitals = 0;
unsigned long reconnectBackoff = 3000;
const unsigned long MIN_RECONNECT_MS = 3000;
const unsigned long MAX_RECONNECT_MS = 60000;
uint32_t sequenceNumber = 0;

void readMac() {
  uint8_t base[6];
  esp_efuse_mac_get_default(base);
  char buffer[13];
  snprintf(buffer, sizeof(buffer), "%02x%02x%02x%02x%02x%02x",
           base[0], base[1], base[2], base[3], base[4], base[5]);
  deviceMac = String(buffer);
  Serial.printf("[ID] MAC=%s type=%s\n", deviceMac.c_str(), deviceType);
}

bool resolveBroker(int attempts = 5, int delayMs = 2000) {
  for (int attempt = 1; attempt <= attempts; attempt++) {
    IPAddress resolved;
    if (WiFi.hostByName(mqttHost, resolved)) {
      brokerIp = resolved;
      Serial.printf("[NET] %s -> %s\n", mqttHost, brokerIp.toString().c_str());
      return true;
    }
    Serial.printf("[NET] resolve failed (%d/%d)\n", attempt, attempts);
    delay(delayMs);
  }
  return false;
}

void setup_wifi() {
  WiFi.mode(WIFI_STA);
  if (strlen(wifiPassword) == 0) WiFi.begin(ssid);
  else WiFi.begin(ssid, wifiPassword);
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(150);
    if (millis() - startedAt > 30000) {
      Serial.println("[WiFi] timeout, restarting");
      ESP.restart();
    }
  }
  Serial.printf("[WiFi] connected IP=%s RSSI=%d\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
  if (MDNS.begin(deviceMac.c_str())) {
    Serial.printf("[mDNS] device=%s.local\n", deviceMac.c_str());
  }
  resolveBroker();
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.disconnect();
  delay(100);
  WiFi.begin(ssid, wifiPassword);
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 20000) {
    delay(200);
  }
  if (WiFi.status() == WL_CONNECTED && resolveBroker(3, 1000)) {
    client.setServer(brokerIp, mqttPort);
  }
}

void syncNTP() {
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC,
             "216.239.35.0", "162.159.200.1", "129.6.15.28");
  struct tm timeInfo;
  ntpSynced = getLocalTime(&timeInfo, 5000);
  Serial.println(ntpSynced ? "[NTP] synchronized" : "[NTP] not synchronized");
}

time_t getUnixTimestamp() {
  if (!ntpSynced) return 0;
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 100)) return 0;
  return mktime(&timeInfo);
}

uint32_t nowSeconds() {
  time_t timestamp = getUnixTimestamp();
  return timestamp ? (uint32_t)timestamp : millis() / 1000UL;
}

bool anyPumpRunning() {
  for (int pump = 0; pump < NUM_PUMPS; pump++) {
    if (pumpRunning[pump]) return true;
  }
  return false;
}

bool saveSettings() {
  EEPROM.write(ADDR_MAGIC, EEPROM_MAGIC);
  EEPROM.write(ADDR_SCHEMA, EEPROM_SCHEMA);
  EEPROM.write(ADDR_CLAIMED, claimed ? 1 : 0);
  for (int pump = 0; pump < NUM_PUMPS; pump++) {
    int base = ADDR_PUMP_BASE + pump * PUMP_EEPROM_STRIDE;
    EEPROM.put(base, pumpDoseMl[pump]);
    EEPROM.put(base + 4, pumpFlowMlPerSecond[pump]);
    EEPROM.put(base + 8, pumpLastDose[pump]);
  }
  bool saved = EEPROM.commit();
  Serial.println(saved ? "[EEPROM] settings saved" : "[EEPROM] commit failed");
  return saved;
}

void loadSettings() {
  if (EEPROM.read(ADDR_MAGIC) != EEPROM_MAGIC) {
    claimed = false;
    saveSettings();
    return;
  }

  uint8_t schema = EEPROM.read(ADDR_SCHEMA);
  if (schema == EEPROM_SCHEMA) {
    claimed = EEPROM.read(ADDR_CLAIMED) == 1;
    for (int pump = 0; pump < NUM_PUMPS; pump++) {
      int base = ADDR_PUMP_BASE + pump * PUMP_EEPROM_STRIDE;
      EEPROM.get(base, pumpDoseMl[pump]);
      EEPROM.get(base + 4, pumpFlowMlPerSecond[pump]);
      EEPROM.get(base + 8, pumpLastDose[pump]);
    }
  } else if (schema == 0xD3) {
    claimed = EEPROM.read(ADDR_CLAIMED) == 1;
    for (int pump = 0; pump < NUM_PUMPS; pump++) {
      int base = ADDR_PUMP_BASE + pump * 20;
      EEPROM.get(base, pumpDoseMl[pump]);
      EEPROM.get(base + 4, pumpFlowMlPerSecond[pump]);
      EEPROM.get(base + 16, pumpLastDose[pump]);
    }
  } else if (schema == 0xD2) {
    claimed = EEPROM.read(ADDR_CLAIMED) == 1;
    for (int pump = 0; pump < NUM_PUMPS; pump++) {
      int base = ADDR_PUMP_BASE + pump * PUMP_EEPROM_STRIDE;
      uint32_t oldDoseMs = 5000;
      EEPROM.get(base, oldDoseMs);
      pumpDoseMl[pump] = constrain(oldDoseMs / 1000.0f, MIN_DOSE_ML, MAX_DOSE_ML);
      pumpFlowMlPerSecond[pump] = 0.0f;
      EEPROM.get(base + 12, pumpLastDose[pump]);
    }
  } else {
    uint32_t legacyDoseMs[NUM_PUMPS] = {5000, 5000};
    EEPROM.get(LEGACY_DOSE_A_TIME, legacyDoseMs[0]);
    EEPROM.get(LEGACY_DOSE_B_TIME, legacyDoseMs[1]);
    EEPROM.get(LEGACY_LAST_DOSE_A, pumpLastDose[0]);
    EEPROM.get(LEGACY_LAST_DOSE_B, pumpLastDose[1]);
    claimed = false;
    for (int pump = 0; pump < NUM_PUMPS; pump++) {
      pumpDoseMl[pump] = constrain(legacyDoseMs[pump] / 1000.0f,
                                   MIN_DOSE_ML, MAX_DOSE_ML);
      pumpFlowMlPerSecond[pump] = 0.0f;
    }
    Serial.println("[EEPROM] migrated legacy A/B dose values; flow requires configuration");
  }

  for (int pump = 0; pump < NUM_PUMPS; pump++) {
    if (!isfinite(pumpDoseMl[pump]) || pumpDoseMl[pump] < MIN_DOSE_ML ||
        pumpDoseMl[pump] > MAX_DOSE_ML) pumpDoseMl[pump] = 5.0f;
    if (!isfinite(pumpFlowMlPerSecond[pump]) ||
        pumpFlowMlPerSecond[pump] < 0.0f ||
        pumpFlowMlPerSecond[pump] > MAX_FLOW_ML_PER_SEC) {
      pumpFlowMlPerSecond[pump] = 0.0f;
    }
    pumpRunning[pump] = false;
    activeDoseMs[pump] = 0;
    pumpStartedAt[pump] = 0;
  }
  saveSettings();
}

void setPumpOutput(int pump, bool enabled) {
  digitalWrite(PUMP_IN1[pump], enabled ? HIGH : LOW);
  digitalWrite(PUMP_IN2[pump], LOW);
  pumpRunning[pump] = enabled;
}

bool startDose(int pump, uint32_t durationMs) {
  if (pump < 0 || pump >= NUM_PUMPS || anyPumpRunning()) return false;
  durationMs = constrain(durationMs, MIN_DOSE_MS, MAX_DOSE_MS);
  activeDoseMs[pump] = durationMs;
  pumpStartedAt[pump] = millis();
  setPumpOutput(pump, true);
  Serial.printf("[DOSE] pump %d ON for %lu ms\n", pump + 1,
                (unsigned long)durationMs);
  return true;
}

uint32_t calculateDoseDurationMs(int pump) {
  if (pump < 0 || pump >= NUM_PUMPS ||
      !isfinite(pumpDoseMl[pump]) ||
      !isfinite(pumpFlowMlPerSecond[pump]) ||
      pumpDoseMl[pump] < MIN_DOSE_ML || pumpDoseMl[pump] > MAX_DOSE_ML ||
      pumpFlowMlPerSecond[pump] < MIN_FLOW_ML_PER_SEC ||
      pumpFlowMlPerSecond[pump] > MAX_FLOW_ML_PER_SEC) return 0;
  float durationMs = (pumpDoseMl[pump] / pumpFlowMlPerSecond[pump]) * 1000.0f;
  if (!isfinite(durationMs) || durationMs < MIN_DOSE_MS ||
      durationMs > MAX_DOSE_MS) return 0;
  return (uint32_t)(durationMs + 0.5f);
}

void stopPump(int pump, bool completed) {
  if (pump < 0 || pump >= NUM_PUMPS) return;
  bool wasRunning = pumpRunning[pump];
  setPumpOutput(pump, false);
  activeDoseMs[pump] = 0;
  if (wasRunning && completed) {
    pumpLastDose[pump] = nowSeconds();
    saveSettings();
  }
}

void stopAllPumps() {
  for (int pump = 0; pump < NUM_PUMPS; pump++) stopPump(pump, false);
}

void computeTopics() {
  String base = "adro/devices/" + String(deviceType) + "/" + deviceMac;
  topicHello = "adro/unclaimed/" + deviceMac + "/hello";
  topicBye = "adro/unclaimed/" + deviceMac + "/bye";
  topicClaimed = base + "/claimed";
  topicUnclaimed = base + "/unclaimed";
  topicClaimAck = base + "/claim-ack";
  topicStatus = base + "/status";
  topicTelemetry = base + "/telemetry";
  topicCommand = base + "/command";
  topicConfig = base + "/config";
  topicOtaStatus = base + "/ota-status";
}

String buildEnvelope(JsonDocument& data) {
  DynamicJsonDocument envelope(1536);
  envelope["ts"] = nowSeconds();
  envelope["seq"] = sequenceNumber++;
  envelope["v"] = currentFirmwareVersion;
  envelope["mac"] = deviceMac;
  envelope["type"] = deviceType;
  envelope["data"] = data;
  String payload;
  serializeJson(envelope, payload);
  return payload;
}

String buildStatusPayload(const char* state) {
  StaticJsonDocument<256> envelope;
  envelope["ts"] = nowSeconds();
  envelope["seq"] = sequenceNumber++;
  envelope["v"] = currentFirmwareVersion;
  envelope["mac"] = deviceMac;
  envelope["type"] = deviceType;
  envelope["data"]["state"] = state;
  String payload;
  serializeJson(envelope, payload);
  return payload;
}

void flushOutbound(unsigned long durationMs = 1200) {
  unsigned long startedAt = millis();
  while (millis() - startedAt < durationMs) {
    client.loop();
    delay(25);
  }
}

void publishClaimAck(const char* requestId, bool ok, bool isClaimed) {
  StaticJsonDocument<192> document;
  document["mac"] = deviceMac;
  document["type"] = deviceType;
  document["requestId"] = requestId;
  document["ok"] = ok;
  document["claimed"] = isClaimed;
  String payload;
  serializeJson(document, payload);
  client.publish(topicClaimAck.c_str(), payload.c_str(), false);
}

void publishHello() {
  StaticJsonDocument<256> document;
  document["mac"] = deviceMac;
  document["type"] = deviceType;
  document["fw"] = currentFirmwareVersion;
  document["ip"] = WiFi.localIP().toString();
  document["model"] = "doser-v0";
  document["capabilities"] = "2-dose-pumps";
  String payload;
  serializeJson(document, payload);
  client.publish(topicHello.c_str(), payload.c_str(), true);
  lastHello = millis();
}

String extractMac(JsonObject document) {
  String mac = document["mac"] | "";
  if (mac.length() == 0) mac = document["device_id"] | "";
  if (mac.length() == 0) mac = document["id"] | "";
  mac.toLowerCase();
  return mac;
}

void clearRetainedClaimCommands() {
  client.publish(topicClaimed.c_str(), "", true);
  client.publish(topicUnclaimed.c_str(), "", true);
}

void handleClaim(JsonObject document) {
  const char* requestId = document["requestId"] | "";
  if (extractMac(document) != deviceMac) return;
  const char* requestedType = document["type"] | "";
  if (requestedType[0] && strcmp(requestedType, deviceType) != 0) return;
  if (!claimed) {
    claimed = true;
    if (!saveSettings()) {
      claimed = false;
      publishClaimAck(requestId, false, false);
      flushOutbound();
      return;
    }
    computeTopics();
    clearRetainedClaimCommands();
    client.publish(topicHello.c_str(), "", true);
    publishClaimAck(requestId, true, true);
    flushOutbound();
    ESP.restart();
  }
  clearRetainedClaimCommands();
  flushOutbound(300);
  publishClaimAck(requestId, true, true);
}

void handleUnclaim(JsonObject document) {
  const char* requestId = document["requestId"] | "";
  if (extractMac(document) != deviceMac) return;
  if (!claimed) {
    publishClaimAck(requestId, true, false);
    return;
  }
  stopAllPumps();
  claimed = false;
  if (!saveSettings()) {
    claimed = true;
    publishClaimAck(requestId, false, true);
    flushOutbound();
    return;
  }
  computeTopics();
  clearRetainedClaimCommands();
  client.publish(topicStatus.c_str(), "", true);
  client.publish(topicHello.c_str(), "", true);
  client.publish(topicBye.c_str(), "{}", false);
  publishClaimAck(requestId, true, false);
  flushOutbound();
  ESP.restart();
}

void publishTelemetry() {
  if (!claimed || !client.connected()) return;
  DynamicJsonDocument data(768);
  data["wifi"] = WiFi.status() == WL_CONNECTED;
  data["mqtt"] = client.connected();
  data["rssi"] = WiFi.RSSI();
  data["uptime"] = (millis() - startupTime) / 1000;
  data["ntp_synced"] = ntpSynced;
  data["heap"] = ESP.getFreeHeap();
  JsonArray channels = data.createNestedArray("channels");
  for (int pump = 0; pump < NUM_PUMPS; pump++) {
    JsonObject channel = channels.createNestedObject();
    channel["id"] = pump + 1;
    channel["state"] = pumpRunning[pump];
    channel["dose_ml"] = pumpDoseMl[pump];
    channel["flow_ml_s"] = pumpFlowMlPerSecond[pump];
    channel["estimated_duration_ms"] = calculateDoseDurationMs(pump);
    channel["last_dose"] = pumpLastDose[pump];
    unsigned long elapsed = millis() - pumpStartedAt[pump];
    channel["remaining_ms"] = pumpRunning[pump] && activeDoseMs[pump] > elapsed
      ? activeDoseMs[pump] - elapsed
      : 0;
  }
  String payload = buildEnvelope(data);
  if (client.publish(topicTelemetry.c_str(), payload.c_str(), false)) {
    lastTelemetry = millis();
  } else {
    Serial.printf("[TELEMETRY] publish failed (%u bytes)\n", payload.length());
  }
}

void publishOtaStatus(const char* stage, const char* message = nullptr) {
  if (!client.connected()) return;
  StaticJsonDocument<256> status;
  status["device_id"] = deviceMac;
  status["stage"] = stage;
  status["timestamp"] = nowSeconds();
  if (message) status["message"] = message;
  String payload;
  serializeJson(status, payload);
  client.publish(topicOtaStatus.c_str(), payload.c_str(), false);
}

void performOTA(const char* firmwareUrl, const char* expectedHash = nullptr) {
  WiFiClient otaClient;
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(otaClient, firmwareUrl)) return;
  publishOtaStatus("download_started", firmwareUrl);
  if (http.GET() != HTTP_CODE_OK) {
    http.end();
    publishOtaStatus("http_error");
    return;
  }
  int contentLength = http.getSize();
  if (contentLength <= 0 || contentLength > (int)(ESP.getFreeSketchSpace() - 0x1000) ||
      !Update.begin(contentLength)) {
    http.end();
    publishOtaStatus("invalid_size");
    return;
  }

  WiFiClient* stream = http.getStreamPtr();
  size_t written = 0;
  uint8_t buffer[1024];
  unsigned char hash[32];
  mbedtls_sha256_context context;
  mbedtls_sha256_init(&context);
  mbedtls_sha256_starts(&context, 0);
  while (http.connected() && written < (size_t)contentLength) {
    size_t available = stream->available();
    if (!available) { delay(1); continue; }
    size_t count = stream->readBytes((char*)buffer, min(available, sizeof(buffer)));
    if (!count || Update.write(buffer, count) != count) {
      Update.abort();
      mbedtls_sha256_free(&context);
      http.end();
      return;
    }
    mbedtls_sha256_update(&context, buffer, count);
    written += count;
  }
  mbedtls_sha256_finish(&context, hash);
  mbedtls_sha256_free(&context);
  http.end();
  if (written != (size_t)contentLength) {
    Update.abort();
    publishOtaStatus("size_mismatch");
    return;
  }
  if (expectedHash && expectedHash[0]) {
    char hashString[65] = {0};
    for (int i = 0; i < 32; i++) sprintf(hashString + i * 2, "%02x", hash[i]);
    if (strcasecmp(hashString, expectedHash) != 0) {
      Update.abort();
      publishOtaStatus("hash_mismatch");
      return;
    }
  }
  if (Update.end(true)) {
    publishOtaStatus("success");
    delay(500);
    ESP.restart();
  }
}

void publishTelemetry();

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  DynamicJsonDocument envelope(768);
  if (deserializeJson(envelope, payload, length)) {
    Serial.println("[MQTT] invalid JSON command");
    return;
  }
  String topicName(topic);
  if (topicName == topicClaimed) {
    handleClaim(envelope.as<JsonObject>());
    return;
  }
  if (topicName == topicUnclaimed) {
    handleUnclaim(envelope.as<JsonObject>());
    return;
  }
  if (!envelope.containsKey("data")) return;
  JsonObject data = envelope["data"].as<JsonObject>();

  if (topicName == topicCommand) {
    const char* action = data["action"] | "";
    if (strcmp(action, "get_state") == 0) {
      publishTelemetry();
    } else if (strcmp(action, "dose_now") == 0) {
      int pump = data["channel"].as<int>() - 1;
      if (pump >= 0 && pump < NUM_PUMPS) {
        uint32_t duration = calculateDoseDurationMs(pump);
        if (duration == 0) {
          Serial.printf("[DOSE] rejected pump %d: volume/flow configuration invalid\n", pump + 1);
        } else if (!startDose(pump, duration)) {
          Serial.printf("[DOSE] rejected pump %d; another pump is active\n", pump + 1);
        }
      }
      publishTelemetry();
    } else if (strcmp(action, "stop_pump") == 0) {
      int pump = data["channel"].as<int>() - 1;
      if (pump >= 0 && pump < NUM_PUMPS) stopPump(pump, false);
      publishTelemetry();
    } else if (strcmp(action, "stop_all") == 0) {
      stopAllPumps();
      publishTelemetry();
    } else if (strcmp(action, "reboot") == 0) {
      stopAllPumps();
      delay(300);
      ESP.restart();
    }
    return;
  }

  if (topicName == topicConfig) {
    int pump = data["channel"].as<int>() - 1;
    if (pump < 0 || pump >= NUM_PUMPS) return;
    float doseMl = data["dose_ml"] | pumpDoseMl[pump];
    float flowMlPerSecond = data["flow_ml_s"] | pumpFlowMlPerSecond[pump];
    if (!isfinite(doseMl) || doseMl < MIN_DOSE_ML || doseMl > MAX_DOSE_ML ||
        !isfinite(flowMlPerSecond) || flowMlPerSecond < 0.0f ||
        flowMlPerSecond > MAX_FLOW_ML_PER_SEC) {
      publishTelemetry();
      return;
    }
    float oldDoseMl = pumpDoseMl[pump];
    float oldFlowMlPerSecond = pumpFlowMlPerSecond[pump];
    pumpDoseMl[pump] = doseMl;
    pumpFlowMlPerSecond[pump] = flowMlPerSecond;
    if (!saveSettings()) {
      pumpDoseMl[pump] = oldDoseMl;
      pumpFlowMlPerSecond[pump] = oldFlowMlPerSecond;
    }
    publishTelemetry();
  }
}

void reconnect() {
  if (client.connected()) return;
  String clientId = deviceMac;
  bool connected;
  if (claimed) {
    String offline = buildStatusPayload("offline");
    connected = client.connect(clientId.c_str(), nullptr, nullptr,
                               topicStatus.c_str(), 1, true,
                               offline.c_str());
  } else {
    connected = client.connect(clientId.c_str());
  }
  if (!connected) {
    Serial.printf("[MQTT] connect failed rc=%d\n", client.state());
    return;
  }
  Serial.println("[MQTT] connected");
  if (claimed) {
    String online = buildStatusPayload("online");
    client.publish(topicStatus.c_str(), online.c_str(), true);
    client.subscribe(topicCommand.c_str(), 1);
    client.subscribe(topicConfig.c_str(), 1);
    client.subscribe(topicUnclaimed.c_str(), 1);
    publishTelemetry();
  } else {
    client.subscribe(topicClaimed.c_str(), 1);
    publishHello();
  }
}

void updateDosing() {
  bool stoppedAny = false;
  for (int pump = 0; pump < NUM_PUMPS; pump++) {
    if (pumpRunning[pump] &&
        millis() - pumpStartedAt[pump] >= activeDoseMs[pump]) {
      stopPump(pump, true);
      stoppedAny = true;
    }
  }
  if (stoppedAny) publishTelemetry();
}

void checkForUpdates() {
  if (!claimed) return;
  HTTPClient http;
  http.setTimeout(10000);
  String manifestUrl = String(otaManifestBase) + "/" +
                       String(deviceType) + "/manifest.json";
  http.begin(manifestUrl);
  if (http.GET() != HTTP_CODE_OK) { http.end(); return; }
  String payload = http.getString();
  http.end();
  StaticJsonDocument<384> manifest;
  if (deserializeJson(manifest, payload)) return;
  const char* version = manifest["version"];
  const char* firmwareUrl = manifest["firmware_url"];
  const char* hash = manifest["sha256"];
  if (version && firmwareUrl && strcmp(version, currentFirmwareVersion) != 0) {
    publishOtaStatus("update_available", version);
    performOTA(firmwareUrl, hash);
  }
}

void printVitals() {
  Serial.printf("[VITALS] up=%lu mqtt=%d claimed=%d ntp=%d heap=%u",
                (millis() - startupTime) / 1000, client.connected(), claimed,
                ntpSynced, ESP.getFreeHeap());
  for (int pump = 0; pump < NUM_PUMPS; pump++) {
    Serial.printf(" pump%d=%d dose=%.1fml flow=%.2fml/s",
            pump + 1, pumpRunning[pump],
            pumpDoseMl[pump], pumpFlowMlPerSecond[pump]);
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(300);
  readMac();
  for (int pump = 0; pump < NUM_PUMPS; pump++) {
    pinMode(PUMP_IN1[pump], OUTPUT);
    pinMode(PUMP_IN2[pump], OUTPUT);
    digitalWrite(PUMP_IN1[pump], LOW);
    digitalWrite(PUMP_IN2[pump], LOW);
  }
  EEPROM.begin(EEPROM_SIZE);
  loadSettings();
  setup_wifi();
  syncNTP();
  computeTopics();
  client.setServer(brokerIp, mqttPort);
  client.setCallback(mqttCallback);
  client.setKeepAlive(60);
  client.setSocketTimeout(30);
  if (!client.setBufferSize(1024)) {
    Serial.println("[MQTT] failed to allocate 1024-byte packet buffer");
  }
  reconnect();
  startupTime = millis();
  lastTelemetry = millis();
  lastOtaCheck = millis();
  lastNtpRetry = millis();
}

void loop() {
  ensureWifi();
  reconnect();
  if (client.connected()) client.loop();

  updateDosing();
  unsigned long now = millis();
  if (claimed && now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    publishTelemetry();
    lastTelemetry = now;
  }
  if (claimed && now - lastOtaCheck >= OTA_INTERVAL_MS) {
    lastOtaCheck = now;
    checkForUpdates();
  }
  if (!ntpSynced && !anyPumpRunning() && now - lastNtpRetry >= NTP_RETRY_INTERVAL_MS) {
    lastNtpRetry = now;
    syncNTP();
  }
  if (claimed && now - startupTime >= REBOOT_INTERVAL_MS) {
    stopAllPumps();
    publishTelemetry();
    delay(300);
    ESP.restart();
  }
  if (now - lastVitals >= 30000) {
    lastVitals = now;
    printVitals();
  }
  if (!claimed && client.connected() && now - lastHello >= HELLO_INTERVAL_MS) {
    publishHello();
  }
}