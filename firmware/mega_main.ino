#include <Arduino.h>

// --- Pin Definitions ---
const int SOIL_MOISTURE_PIN = A0;
const int SENSOR_POWER_PIN = 8;  // Digital pin powering soil moisture probe
const int SOLENOID_1_PIN = 2;    // 5V Solenoid via TIP120
const int SOLENOID_2_PIN = 3;    // 15V Solenoid via TIP120

// --- State & Telemetry Variables ---
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 3600000UL; // 1 hour in milliseconds

void processIncomingCommand(String cmd) {
  cmd.trim();
  Serial.print("[Mega] Received from ESP32: ");
  Serial.println(cmd);

  // Solenoid Control Commands
  if (cmd == "SOL1:1") {
    digitalWrite(SOLENOID_1_PIN, HIGH);
    Serial1.println("ACK:SOL1:ON");
  } else if (cmd == "SOL1:0") {
    digitalWrite(SOLENOID_1_PIN, LOW);
    Serial1.println("ACK:SOL1:OFF");
  } else if (cmd == "SOL2:1") {
    digitalWrite(SOLENOID_2_PIN, HIGH);
    Serial1.println("ACK:SOL2:ON");
  } else if (cmd == "SOL2:0") {
    digitalWrite(SOLENOID_2_PIN, LOW);
    Serial1.println("ACK:SOL2:OFF");
  } else if (cmd == "READ_MOISTURE") {
    // Allows web app to request an on-demand moisture read
    readAndSendTelemetry();
  }
}

void readAndSendTelemetry() {
  // Power on probe for 100ms to eliminate galvanic corrosion
  digitalWrite(SENSOR_POWER_PIN, HIGH);
  delay(100);
  int rawMoisture = analogRead(SOIL_MOISTURE_PIN);
  digitalWrite(SENSOR_POWER_PIN, LOW);

  // Send packet across UART to ESP32: "TELEMETRY:RAW_ADC"
  String telemetryPacket = "TELEMETRY:" + String(rawMoisture);
  Serial1.println(telemetryPacket);

  Serial.print("[Mega] Sent: ");
  Serial.println(telemetryPacket);
}

void setup() {
  // Serial0 for Debug Console (USB)
  Serial.begin(115200);

  // Serial1 (Pins 18 TX1 / 19 RX1) for ESP32 Bridge at 9600 Baud
  Serial1.begin(9600);

  pinMode(SOLENOID_1_PIN, OUTPUT);
  pinMode(SOLENOID_2_PIN, OUTPUT);
  pinMode(SENSOR_POWER_PIN, OUTPUT);

  digitalWrite(SOLENOID_1_PIN, LOW);
  digitalWrite(SOLENOID_2_PIN, LOW);
  digitalWrite(SENSOR_POWER_PIN, LOW);

  Serial.println("[Mega] Initialization Complete. Waiting for commands...");
}

void loop() {
  // 1. Process Commands from ESP32 over UART
  if (Serial1.available() > 0) {
    String incoming = Serial1.readStringUntil('\n');
    processIncomingCommand(incoming);
  }

  // 2. Hourly Automated Telemetry Check
  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = millis();
    readAndSendTelemetry();
  }
}
