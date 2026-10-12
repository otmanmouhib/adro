// Adro onesense-v0 — firmware stub
// See docs/CHANGELOG.md and docs/MEMORY.md.

const char* currentFirmwareVersion = "1.0.0";
const char* deviceId = "onesense-v0";

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("[%s] boot, firmware v%s\n", deviceId, currentFirmwareVersion);
}

void loop() {
  // TODO
  delay(1000);
}
