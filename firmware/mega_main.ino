#include <Arduino.h>

// Pin Definitions
const int SOIL_MOISTURE_PIN = A0;
const int SOLENOID_1_PIN = 2; // 5V Solenoid via TIP120
const int SOLENOID_2_PIN = 3; // 15V Solenoid via TIP120

// State & Telemetry Variables
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 3600000UL;

void setup() {
  // Serial0 for Debug Console (USB)
  Serial.begin(115200);
  
  // Serial1 (Pins 18 TX1 / 19 RX1) for ESP32 Bridge at 9600 Baud
  Serial1.begin(9600);

  pinMode(SOLENOID_1_PIN, OUTPUT);
  pinMode(SOLENOID_2_PIN, OUTPUT);
  digitalWrite(SOLENOID_1_PIN, LOW);
  digitalWrite(SOLENOID_2_PIN, LOW);

  Serial.println("[Mega] Initialization Complete. Waiting for commands...");
}

void processIncomingCommand(String cmd) {
  cmd.trim();
  Serial.print("[Mega] Received from ESP32: ");
  Serial.println(cmd);

  // Command Format: "SOL1:1", "SOL1:0", "SOL2:1", "SOL2:0"
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
  }
}

void loop() {
  // 1. Process Commands from ESP32 over UART
  if (Serial1.available() > 0) {
    String incoming = Serial1.readStringUntil('\n');
    processIncomingCommand(incoming);
  }

  // 2. Periodically Read Telemetry & Stream to ESP32
  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = millis();
    
    int rawMoisture = analogRead(SOIL_MOISTURE_PIN);
    
    // Telemetry packet format: "TELEMETRY:RAW_ADC"
    String telemetryPacket = "TELEMETRY:" + String(rawMoisture);
    Serial1.println(telemetryPacket);
    
    Serial.print("[Mega] Sent: ");
    Serial.println(telemetryPacket);
  }
}
