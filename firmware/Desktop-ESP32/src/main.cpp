#include <Arduino.h>

#define LED_PIN 4  // GPIO 4 (D4)

void setup() {
  Serial.begin(115200);
  delay(1000);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("LED blinking on GPIO 4");
}

void loop() {
  digitalWrite(LED_PIN, LOW);  // LED on
  delay(500);
  digitalWrite(LED_PIN, LOW);   // LED off
  delay(500);
}