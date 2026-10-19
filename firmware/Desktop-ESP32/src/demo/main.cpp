// AdaptiveDesk classroom hardware demo (classic ESP32 DevKit V1)
//
//   Inputs : slide potentiometer (GPIO32), FSR pressure sensor (GPIO33)
//   Outputs: common-cathode RGB LED (GPIO18/13/14), active buzzer (GPIO25)
//
//   - Slide pot sets the RGB LED brightness (locally, no host needed).
//   - FSR pressure above a threshold sounds the buzzer (locally, no host needed).
//   - Two interchangeable transports carry the SAME JSON protocol to the dashboard, ~8 updates/second:
//       * USB serial: newline-delimited JSON, 115200 baud, via the Node bridge in tools/serial-bridge
//       * Wi-Fi WebSocket server (port 81), only if Wi-Fi credentials are configured
//     Wi-Fi is optional: with no credentials the board runs fine over USB alone.
//   - Serial lines starting with '{' are protocol; anything else (starting with '[') is human-readable debug.
//
// Wire protocol: see Dashboard/README.md ("Wire protocol v1").
// Everything the dashboard shows is read from the variables below. Commands only change them
// after validation, and the dashboard is told the real resulting state.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

#include "hardware_config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#endif

// Wi-Fi is optional. An empty SSID or the untouched template value means "USB only".
static bool wifiConfigured() {
  return strlen(WIFI_SSID) > 0 && strcmp(WIFI_SSID, "YOUR_WIFI_NAME") != 0;
}
static bool wifiUp() { return wifiConfigured() && WiFi.status() == WL_CONNECTED; }

// ---------------------------------------------------------------- state

struct Settings {
  uint8_t r = 0, g = 160, b = 255;  // default: cool blue
  bool ledOn = true;
  bool muted = false;
  uint8_t threshold = DEFAULT_THRESHOLD;
} cfg;

static float sliderPct = 0, fsrPct = 0;
static int sliderRaw = 0, fsrRaw = 0;
static bool pressed = false;
static bool buzzerActive = false;
static uint32_t buzzerTestUntil = 0;
static uint8_t brightnessPct = 0;

static Preferences prefs;
static bool prefsDirty = false;
static uint32_t prefsDirtyAt = 0;

static WebSocketsServer ws(WS_PORT);
static bool mdnsStarted = false;
static uint32_t lastTelemetry = 0, lastSample = 0, lastWifiTry = 0, lastStatus = 0;

// USB serial transport: "active" while the host bridge keeps talking to us (it sends a keep-alive every second).
static const uint32_t SERIAL_ACTIVE_TIMEOUT_MS = 4000;
static uint32_t lastSerialRx = 0;
static bool serialWasActive = false;
static char serialLine[512];
static size_t serialLen = 0;
static bool serialOverflow = false;
static uint32_t serialDropped = 0;
static inline bool serialActive() { return lastSerialRx != 0 && millis() - lastSerialRx < SERIAL_ACTIVE_TIMEOUT_MS; }

// Where a reply goes.
struct Target {
  enum Kind { ALL, WS, SERIAL_PORT } kind;
  uint8_t ws;
};
static const Target TO_ALL = {Target::ALL, 0};
static const Target TO_SERIAL = {Target::SERIAL_PORT, 0};

// ---------------------------------------------------------------- outputs

static void pwmSetup() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_LED_R, 5000, 8);
  ledcAttach(PIN_LED_G, 5000, 8);
  ledcAttach(PIN_LED_B, 5000, 8);
#else
  ledcSetup(0, 5000, 8); ledcAttachPin(PIN_LED_R, 0);
  ledcSetup(1, 5000, 8); ledcAttachPin(PIN_LED_G, 1);
  ledcSetup(2, 5000, 8); ledcAttachPin(PIN_LED_B, 2);
#endif
}

static void pwmWrite(int channel, int pin, uint8_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)channel;
  ledcWrite(pin, duty);
#else
  (void)pin;
  ledcWrite(channel, duty);
#endif
}

static void applyLed() {
  // Gamma-corrected brightness so the slider feels even to the eye. Common cathode: higher duty = brighter.
  float level = cfg.ledOn ? (brightnessPct / 100.0f) : 0.0f;
  level *= level;
  pwmWrite(0, PIN_LED_R, (uint8_t)(cfg.r * level + 0.5f));
  pwmWrite(1, PIN_LED_G, (uint8_t)(cfg.g * level + 0.5f));
  pwmWrite(2, PIN_LED_B, (uint8_t)(cfg.b * level + 0.5f));
}

static void applyBuzzer() {
  bool want = (pressed && !cfg.muted) || (millis() < buzzerTestUntil);
  buzzerActive = want;
  digitalWrite(PIN_BUZZER, (want != (bool)BUZZER_ACTIVE_LOW) ? HIGH : LOW);
}

// ---------------------------------------------------------------- inputs

static int readAveraged(int pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(pin);
  return sum / 8;
}

static float mapPct(int raw, int lo, int hi) {
  float p = (float)(raw - lo) * 100.0f / (float)(hi - lo);
  return constrain(p, 0.0f, 100.0f);
}

static void sampleInputs() {
  sliderRaw = readAveraged(PIN_SLIDER);
  fsrRaw = readAveraged(PIN_FSR);

  float s = mapPct(sliderRaw, SLIDER_MIN_RAW, SLIDER_MAX_RAW);
  float f = mapPct(fsrRaw, FSR_MIN_RAW, FSR_MAX_RAW);
  if (SLIDER_INVERT) s = 100.0f - s;
  if (FSR_INVERT) f = 100.0f - f;

  sliderPct += (s - sliderPct) * 0.25f;  // light smoothing removes ADC jitter
  fsrPct += (f - fsrPct) * 0.4f;

  uint8_t newBrightness = (uint8_t)(sliderPct + 0.5f);
  bool newPressed = pressed ? (fsrPct >= (float)cfg.threshold - THRESHOLD_HYSTERESIS) : (fsrPct >= cfg.threshold);

  bool changed = newBrightness != brightnessPct || newPressed != pressed;
  brightnessPct = newBrightness;
  pressed = newPressed;
  if (changed) { applyLed(); applyBuzzer(); }
}

// ---------------------------------------------------------------- persistence

static void loadSettings() {
  prefs.begin("adesk", true);
  cfg.r = prefs.getUChar("r", cfg.r);
  cfg.g = prefs.getUChar("g", cfg.g);
  cfg.b = prefs.getUChar("b", cfg.b);
  cfg.ledOn = prefs.getBool("on", cfg.ledOn);
  cfg.muted = prefs.getBool("mute", cfg.muted);
  cfg.threshold = prefs.getUChar("thr", cfg.threshold);
  prefs.end();
}

static void markDirty() { prefsDirty = true; prefsDirtyAt = millis(); }

static void flushSettings() {
  // Debounced: a colour-picker drag must not wear out flash.
  if (!prefsDirty || millis() - prefsDirtyAt < 2000) return;
  prefs.begin("adesk", false);
  prefs.putUChar("r", cfg.r); prefs.putUChar("g", cfg.g); prefs.putUChar("b", cfg.b);
  prefs.putBool("on", cfg.ledOn); prefs.putBool("mute", cfg.muted); prefs.putUChar("thr", cfg.threshold);
  prefs.end();
  prefsDirty = false;
}

// ---------------------------------------------------------------- protocol

static void fillFeatures(JsonObject f) {
  char color[8];
  snprintf(color, sizeof(color), "#%02x%02x%02x", cfg.r, cfg.g, cfg.b);

  JsonObject light = f["ambientLighting"].to<JsonObject>();
  light["available"] = true;
  light["enabled"] = cfg.ledOn;
  light["color"] = color;
  light["brightness"] = brightnessPct;
  light["brightnessSource"] = "physical";  // the slide control owns brightness

  JsonObject slide = f["slideControl"].to<JsonObject>();
  slide["available"] = true;
  slide["position"] = (int)(sliderPct + 0.5f);
  slide["raw"] = sliderRaw;

  JsonObject pressure = f["pressureSensing"].to<JsonObject>();
  pressure["available"] = true;
  pressure["value"] = (int)(fsrPct + 0.5f);
  pressure["raw"] = fsrRaw;
  pressure["pressed"] = pressed;
  pressure["threshold"] = cfg.threshold;

  JsonObject buzzer = f["audioAlert"].to<JsonObject>();
  buzzer["available"] = true;
  buzzer["active"] = buzzerActive;
  buzzer["muted"] = cfg.muted;
}

static void fillSystem(JsonObject s) {
  if (wifiUp()) {  // omitted over USB-only so the dashboard never shows a made-up signal
    s["ssid"] = WiFi.SSID();
    s["rssi"] = WiFi.RSSI();
  }
  s["uptimeMs"] = millis();
  s["freeHeap"] = ESP.getFreeHeap();
}

static String buildState(const char* type) {
  JsonDocument doc;
  doc["protocolVersion"] = 1;
  doc["type"] = type;
  doc["deviceId"] = DEVICE_ID;
  if (strcmp(type, "hello") == 0) {
    doc["name"] = "AdaptiveDesk Console";
    doc["firmware"] = FIRMWARE_VERSION;
    doc["board"] = "ESP32 DevKit V1";
  } else {
    doc["timestamp"] = millis();  // uptime in ms; the device has no wall clock
  }
  fillFeatures(doc["features"].to<JsonObject>());
  fillSystem(doc["system"].to<JsonObject>());
  String out;
  serializeJson(doc, out);
  return out;
}

// Never block the control loop on a slow serial link: if the TX buffer can't take the whole line, drop it.
static void serialSend(const String& line) {
  if (Serial.availableForWrite() < (int)line.length() + 1) { serialDropped++; return; }
  Serial.print(line);
  Serial.print('\n');
}

static void sendTo(const Target& t, const String& line) {
  switch (t.kind) {
    case Target::ALL:
      if (ws.connectedClients() > 0) ws.broadcastTXT(line.c_str(), line.length());
      if (serialActive()) serialSend(line);
      break;
    case Target::WS:
      ws.sendTXT(t.ws, line.c_str(), line.length());
      break;
    case Target::SERIAL_PORT:
      serialSend(line);
      break;
  }
}

static void sendState(const char* type, const Target& t) { sendTo(t, buildState(type)); }

static void sendAck(const Target& t, const char* requestId, bool ok, const char* error = nullptr) {
  JsonDocument doc;
  doc["protocolVersion"] = 1;
  doc["type"] = "ack";
  doc["requestId"] = requestId;
  doc["ok"] = ok;
  if (error) doc["error"] = error;
  String out;
  serializeJson(doc, out);
  sendTo(t, out);
}

static bool parseHexColor(const char* s, uint8_t& r, uint8_t& g, uint8_t& b) {
  if (!s || s[0] != '#' || strlen(s) != 7) return false;
  for (int i = 1; i < 7; i++) if (!isxdigit((unsigned char)s[i])) return false;
  long v = strtol(s + 1, nullptr, 16);
  r = (v >> 16) & 0xFF; g = (v >> 8) & 0xFF; b = v & 0xFF;
  return true;
}

static void handleCommand(const Target& from, JsonDocument& doc) {
  const char* requestId = doc["requestId"] | "";
  const char* feature = doc["feature"] | "";
  const char* action = doc["action"] | "";
  if (!*requestId || strlen(requestId) > 64) return;  // can't acknowledge without an id
  JsonVariant value = doc["value"];

  bool ok = true;
  const char* err = nullptr;

  if (!strcmp(feature, "ambientLighting") && !strcmp(action, "setEnabled")) {
    if (!value.is<bool>()) { ok = false; err = "Expected true or false"; }
    else { cfg.ledOn = value.as<bool>(); markDirty(); }
  } else if (!strcmp(feature, "ambientLighting") && !strcmp(action, "setColor")) {
    uint8_t r, g, b;
    if (!value.is<const char*>() || !parseHexColor(value.as<const char*>(), r, g, b)) { ok = false; err = "Expected a colour like #00a0ff"; }
    else { cfg.r = r; cfg.g = g; cfg.b = b; markDirty(); }
  } else if (!strcmp(feature, "ambientLighting") && !strcmp(action, "setBrightness")) {
    ok = false; err = "Brightness is set by the slide control on the console";
  } else if (!strcmp(feature, "pressureSensing") && !strcmp(action, "setThreshold")) {
    if (!value.is<int>() || value.as<int>() < 5 || value.as<int>() > 95) { ok = false; err = "Threshold must be 5-95"; }
    else { cfg.threshold = (uint8_t)value.as<int>(); markDirty(); }
  } else if (!strcmp(feature, "audioAlert") && !strcmp(action, "setMuted")) {
    if (!value.is<bool>()) { ok = false; err = "Expected true or false"; }
    else { cfg.muted = value.as<bool>(); markDirty(); }
  } else if (!strcmp(feature, "audioAlert") && !strcmp(action, "test")) {
    if (cfg.muted) { ok = false; err = "Buzzer is muted"; }
    else buzzerTestUntil = millis() + BUZZER_TEST_MS;
  } else {
    ok = false; err = "Unsupported command";
  }

  sendAck(from, requestId, ok, err);
  if (ok) { applyLed(); applyBuzzer(); sendState("telemetry", TO_ALL); }  // report the real resulting state
}

// One entry point for both transports. Malformed or unsupported input is ignored, never trusted.
static void handleMessage(const Target& from, const uint8_t* payload, size_t length) {
  if (length == 0 || length > 512) return;
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  if ((doc["protocolVersion"] | 0) != 1) return;
  const char* t = doc["type"] | "";
  if (!strcmp(t, "ping")) {
    JsonDocument pong;
    pong["protocolVersion"] = 1;
    pong["type"] = "pong";
    pong["timestamp"] = doc["timestamp"];
    String out;
    serializeJson(pong, out);
    sendTo(from, out);
  } else if (!strcmp(t, "requestState")) {
    sendState("telemetry", from);
  } else if (!strcmp(t, "command")) {
    handleCommand(from, doc);
  }
}

// ---------------------------------------------------------------- wifi websocket transport

static void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  Target from = {Target::WS, num};
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("[ws] client %u connected from %s\n", num, ws.remoteIP(num).toString().c_str());
      sendState("hello", from);
      break;
    case WStype_DISCONNECTED:
      Serial.printf("[ws] client %u disconnected\n", num);
      break;
    case WStype_TEXT:
      handleMessage(from, payload, length);
      break;
    default:
      break;
  }
}

static void wifiService() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!mdnsStarted && MDNS.begin(DEVICE_HOSTNAME)) {
      MDNS.addService("ws", "tcp", WS_PORT);
      mdnsStarted = true;
      Serial.printf("[wifi] connected. Dashboard address: %s  (or %s.local)  port %d\n",
                    WiFi.localIP().toString().c_str(), DEVICE_HOSTNAME, WS_PORT);
    }
    return;
  }
  mdnsStarted = false;
  if (millis() - lastWifiTry > 10000 || lastWifiTry == 0) {
    lastWifiTry = millis();
    Serial.printf("[wifi] connecting to \"%s\"...\n", WIFI_SSID);
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

// ---------------------------------------------------------------- usb serial transport (newline-delimited JSON)

static void serialService() {
  while (Serial.available() > 0) {
    int c = Serial.read();
    if (c < 0) break;
    if (c == '\n' || c == '\r') {
      if (serialLen > 0 && !serialOverflow && serialLine[0] == '{') {
        serialLine[serialLen] = 0;
        lastSerialRx = millis();
        if (!serialWasActive) {
          serialWasActive = true;
          sendState("hello", TO_SERIAL);
        }
        handleMessage(TO_SERIAL, (const uint8_t*)serialLine, serialLen);
      }
      serialLen = 0;
      serialOverflow = false;
    } else if (serialLen < sizeof(serialLine) - 1) {
      serialLine[serialLen++] = (char)c;
    } else {
      serialOverflow = true;  // oversized line: discard until the next newline
    }
  }
  if (serialWasActive && !serialActive()) {
    serialWasActive = false;
    Serial.println("[usb] host bridge went quiet; telemetry paused");
  }
}

// ---------------------------------------------------------------- arduino

void setup() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  Serial.setTxBufferSize(2048);  // room for several telemetry lines so USB writes never stall the control loop
  Serial.setRxBufferSize(1024);
#endif
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[boot] AdaptiveDesk demo firmware " FIRMWARE_VERSION);

  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, BUZZER_ACTIVE_LOW ? HIGH : LOW);
  pwmSetup();
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SLIDER, ADC_11db);
  analogSetPinAttenuation(PIN_FSR, ADC_11db);

  loadSettings();
  sampleInputs();
  sliderPct = mapPct(sliderRaw, SLIDER_MIN_RAW, SLIDER_MAX_RAW);
  if (SLIDER_INVERT) sliderPct = 100.0f - sliderPct;
  brightnessPct = (uint8_t)(sliderPct + 0.5f);
  applyLed();
  applyBuzzer();

  Serial.println("[usb] USB serial protocol ready (115200 baud, newline-delimited JSON). Use tools/serial-bridge.");
  if (wifiConfigured()) {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(DEVICE_HOSTNAME);
    WiFi.setSleep(false);  // lower latency
    ws.begin();
    ws.onEvent(onWsEvent);
  } else {
    Serial.println("[wifi] Not configured: running USB-only. (Optional: copy include/secrets.example.h to include/secrets.h.)");
  }
}

void loop() {
  uint32_t now = millis();
  serialService();
  if (wifiConfigured()) {
    wifiService();
    ws.loop();
  }

  if (now - lastSample >= 10) {  // 100 Hz input sampling
    lastSample = now;
    sampleInputs();
  }
  applyBuzzer();  // also ends the timed test beep
  flushSettings();

  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    lastTelemetry = now;
    if (ws.connectedClients() > 0 || serialActive()) sendState("telemetry", TO_ALL);
  }

  if (now - lastStatus >= 5000) {
    lastStatus = now;
    Serial.printf("[status] usb=%s wifi=%s ip=%s clients=%u slider=%d%% (raw %d) fsr=%d%% (raw %d) pressed=%d buzzer=%d muted=%d thr=%u dropped=%u\n",
                  serialActive() ? "bridge-active" : "idle",
                  !wifiConfigured() ? "off" : (wifiUp() ? "up" : "DOWN"),
                  wifiUp() ? WiFi.localIP().toString().c_str() : "-", ws.connectedClients(),
                  brightnessPct, sliderRaw, (int)(fsrPct + 0.5f), fsrRaw, pressed, buzzerActive, cfg.muted, cfg.threshold,
                  (unsigned)serialDropped);
  }
}
