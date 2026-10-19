#pragma once
// Hardware map for the classroom demo (ESP32 DevKit V1, classic ESP32).
// Change pins HERE only; the dashboard never sees GPIO numbers.

// ---- Inputs (ADC1: safe to use while Wi-Fi is on) ----
#define PIN_SLIDER        32   // 10k slide potentiometer wiper (ends on 3V3 and GND)
#define PIN_FSR           33   // FSR + 10k divider: FSR to 3V3, 10k to GND, junction on this pin

// ---- Outputs ----
#define PIN_LED_R         18   // common-cathode RGB LED, each leg through 330 ohm
#define PIN_LED_G         13
#define PIN_LED_B         14
#define PIN_BUZZER        25   // 3.3V active buzzer module signal

// ---- Wiring options ----
#define SLIDER_INVERT     false  // true if sliding "up" should read lower
#define FSR_INVERT        false  // true if FSR is wired between the pin and GND instead
#define BUZZER_ACTIVE_LOW false  // true for "low level trigger" buzzer modules

// ---- ADC calibration (classic ESP32 ADC is non-linear near the ends) ----
#define SLIDER_MIN_RAW    60
#define SLIDER_MAX_RAW    4030
#define FSR_MIN_RAW       100    // readings below this count as zero pressure
#define FSR_MAX_RAW       3800   // reading treated as 100% pressure

// ---- Behaviour ----
#define DEFAULT_THRESHOLD 40     // % pressure that triggers the buzzer
#define THRESHOLD_HYSTERESIS 3   // % below threshold before "released"
#define TELEMETRY_INTERVAL_MS 125 // 8 updates per second
#define BUZZER_TEST_MS    400

// ---- Network ----
#define DEVICE_ID         "adaptivedesk-main"
#define DEVICE_HOSTNAME   "adaptivedesk"   // reachable as adaptivedesk.local on most networks
#define WS_PORT           81               // dashboard default; path is not checked
#define FIRMWARE_VERSION  "0.1.0-demo"
