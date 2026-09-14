#include <WiFi.h>
#include <WebSocketsClient.h>

// Wi-Fi & Server Configurations
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* WS_SERVER_HOST = "192.168.1.100"; // Express/Socket.io Host IP
const int WS_SERVER_PORT = 8080;

// Dual Serial Port Configuration (UART2 on ESP32)
#define RX2_PIN 16
#define TX2_PIN 17

WebSocketsClient webSocket;

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[ESP32] WebSocket Disconnected");
      break;
    case WStype_CONNECTED:
      Serial.println("[ESP32] WebSocket Connected to Server");
      webSocket.sendTXT("{\"type\":\"IDENTIFY\",\"device\":\"ESP32_GATEWAY\"}");
      break;
    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.print("[ESP32] WS Received: ");
      Serial.println(msg);

      // Forward Solenoid Control Command to Mega over UART2 (9600 Baud)
      if (msg.indexOf("SOL1:1") >= 0) Serial2.println("SOL1:1");
      else if (msg.indexOf("SOL1:0") >= 0) Serial2.println("SOL1:0");
      else if (msg.indexOf("SOL2:1") >= 0) Serial2.println("SOL2:1");
      else if (msg.indexOf("SOL2:0") >= 0) Serial2.println("SOL2:0");
      break;
    }
  }
}

void setup() {
  // High-Speed Debugging Serial (USB)
  Serial.begin(115200);

  // Hardware Serial 2 for Arduino Mega UART Connection (9600 Baud)
  Serial2.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);

  // Connect Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[ESP32] Wi-Fi Connected!");

  // Initialize WebSockets Client connection to server.js
  webSocket.begin(WS_SERVER_HOST, WS_SERVER_PORT, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();

  // Read Telemetry from Mega across UART2 and forward to server via WebSockets
  if (Serial2.available() > 0) {
    String telemetryFromMega = Serial2.readStringUntil('\n');
    telemetryFromMega.trim();
    
    if (telemetryFromMega.length() > 0) {
      Serial.print("[ESP32] Relaying to Backend: ");
      Serial.println(telemetryFromMega);

      // Send telemetry packet over WebSockets to Express Server
      String wsPayload = "{\"type\":\"TELEMETRY_DATA\",\"payload\":\"" + telemetryFromMega + "\"}";
      webSocket.sendTXT(wsPayload);
    }
  }
}
