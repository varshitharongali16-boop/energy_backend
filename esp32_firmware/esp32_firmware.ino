#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <TFT_eSPI.h>
#include <PZEM004Tv30.h>
#include <Preferences.h>
#include <time.h>

// ============================================================
// TFT & HARDWARE CONFIG
// ============================================================
TFT_eSPI tft = TFT_eSPI();
#define SCREEN_W 320
#define SCREEN_H 240

// ============================================================
// CLOUD BACKEND (RENDER) CONFIGURATION
// ============================================================
// Replace with your deployed Render URL: e.g. "https://your-service.onrender.com/api/device/telemetry"
const char* CLOUD_API_URL = "https://energy-backend-gwex.onrender.com/api/device/telemetry";
const char* DEVICE_ID     = "ESP32_METER_01";
const char* DEVICE_API_KEY = "meter_secret_key_123";

const unsigned long CLOUD_SYNC_INTERVAL = 5000UL; // Send to cloud every 5 seconds
unsigned long lastCloudSync = 0;

// ============================================================
// WIFI CONFIGURATION
// ============================================================
const char* WIFI_SSID = "Nothing Phone (3a)_2505";
const char* WIFI_PASS = "praveen DSP";

WebServer server(80);

const unsigned long WIFI_RETRY_INTERVAL = 600000UL; // 10 minutes
const unsigned long WIFI_TIMEOUT = 15000UL;
unsigned long lastWiFiAttempt = 0;

// ============================================================
// PZEM-004T v3.0 PINS (Serial2)
// ============================================================
#define PZEM_RX 34
#define PZEM_TX 21
PZEM004Tv30 pzem(Serial2, PZEM_RX, PZEM_TX);

// ============================================================
// PERSISTENT STORAGE
// ============================================================
Preferences prefs;

// ============================================================
// ENERGY VARIABLES & BILLING
// ============================================================
float unitPrice = 8.50;
float allowedUnits = 100.0;
float initialEnergy = 0.0;

float energy = 0.0;
float usedEnergy = 0.0;
float totalCost = 0.0;
float totalAllowedAmount = 0.0;
float amountRemaining = 0.0;

// PZEM Live Telemetry
float voltage = 0.0;
float current = 0.0;
float power = 0.0;
float powerFactor = 0.0;

// ============================================================
// LOAD SENSING & TIMESTAMPS
// ============================================================
#define LOAD_ON_THRESHOLD  5.0
#define LOAD_OFF_THRESHOLD 3.0

bool loadON = false;
bool previousLoadON = false;
String loadStartTime = "--:--:--";
String loadStopTime  = "--:--:--";
unsigned long loadStartMillis = 0;

// ============================================================
// TFT SCREEN ROTATION & TIMERS
// ============================================================
#define TFT_SCREEN_TIME 5000UL
int currentScreen = 0;
unsigned long lastScreenChange = 0;

unsigned long lastPzemUpdate = 0;
unsigned long lastTFTUpdate = 0;
unsigned long lastSettingsSave = 0;

const unsigned long PZEM_INTERVAL = 1000;
const unsigned long TFT_UPDATE_INTERVAL = 1000;
const unsigned long SETTINGS_SAVE_INTERVAL = 30000;

// TFT Color Palette
#define BLACK       0x0000
#define WHITE       0xFFFF
#define RED         0xF800
#define GREEN       0x07E0
#define BLUE        0x001F
#define CYAN        0x07FF
#define YELLOW      0xFFE0
#define ORANGE      0xFD20
#define GRAY        0x8410
#define LIGHTGRAY   0xBDF7
#define DARKGRAY    0x4208
#define NAVY        0x000F
#define DARKGREEN   0x0320
#define PURPLE      0x780F

// ============================================================
// TIME FUNCTIONS
// ============================================================
String getCurrentTime() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 100)) {
    char buffer[20];
    strftime(buffer, sizeof(buffer), "%H:%M:%S", &timeinfo);
    return String(buffer);
  }
  unsigned long seconds = millis() / 1000;
  int h = (seconds / 3600) % 24;
  int m = (seconds / 60) % 60;
  int s = seconds % 60;
  char buffer[20];
  sprintf(buffer, "%02d:%02d:%02d", h, m, s);
  return String(buffer);
}

String getRunningTime() {
  if (!loadON) return "00:00:00";
  unsigned long seconds = (millis() - loadStartMillis) / 1000;
  unsigned long h = seconds / 3600;
  unsigned long m = (seconds % 3600) / 60;
  unsigned long s = seconds % 60;
  char buffer[20];
  sprintf(buffer, "%02lu:%02lu:%02lu", h, m, s);
  return String(buffer);
}

// ============================================================
// ENERGY MATH
// ============================================================
void calculateValues() {
  usedEnergy = energy - initialEnergy;
  if (usedEnergy < 0) usedEnergy = 0;

  totalCost = usedEnergy * unitPrice;
  totalAllowedAmount = allowedUnits * unitPrice;
  amountRemaining = totalAllowedAmount - totalCost;
  if (amountRemaining < 0) amountRemaining = 0;
}

// ============================================================
// PZEM SENSOR READING
// ============================================================
void readPZEM() {
  float newVoltage = pzem.voltage();
  float newCurrent = pzem.current();
  float newPower   = pzem.power();
  float newEnergy  = pzem.energy();
  float newPF      = pzem.pf();

  if (!isnan(newVoltage)) voltage = newVoltage;
  if (!isnan(newCurrent)) current = newCurrent;
  if (!isnan(newPower))   power = newPower;
  if (!isnan(newEnergy))  energy = newEnergy;
  if (!isnan(newPF))      powerFactor = newPF;

  calculateValues();

  previousLoadON = loadON;
  if (loadON) {
    if (power <= LOAD_OFF_THRESHOLD) loadON = false;
  } else {
    if (power >= LOAD_ON_THRESHOLD) loadON = true;
  }

  if (loadON && !previousLoadON) {
    loadStartMillis = millis();
    loadStartTime = getCurrentTime();
  }

  if (!loadON && previousLoadON) {
    loadStopTime = getCurrentTime();
  }
}

// ============================================================
// CLOUD INGESTION: SEND TELEMETRY TO RENDER & SYNC SETTINGS
// ============================================================
void sendTelemetryToCloud() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastCloudSync < CLOUD_SYNC_INTERVAL) return;
  lastCloudSync = millis();

  WiFiClientSecure client;
  client.setInsecure(); // Skip certificate validation for simplified IoT connection

  HTTPClient http;
  if (http.begin(client, CLOUD_API_URL)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", DEVICE_API_KEY);

    // Build JSON payload
    String payload = "{";
    payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
    payload += "\"apiKey\":\"" + String(DEVICE_API_KEY) + "\",";
    payload += "\"voltage\":" + String(voltage, 2) + ",";
    payload += "\"current\":" + String(current, 3) + ",";
    payload += "\"power\":" + String(power, 2) + ",";
    payload += "\"pf\":" + String(powerFactor, 2) + ",";
    payload += "\"energy\":" + String(usedEnergy, 4) + ",";
    payload += "\"cost\":" + String(totalCost, 2) + ",";
    payload += "\"isLoadOn\":" + String(loadON ? "true" : "false");
    payload += "}";

    int httpCode = http.POST(payload);
    if (httpCode == HTTP_CODE_OK) {
      String response = http.getString();
      // Optional check: sync unitPrice & allowedUnits if provided by cloud
      int priceIdx = response.indexOf("\"unitPrice\":");
      if (priceIdx != -1) {
        float cloudPrice = response.substring(priceIdx + 12).toFloat();
        if (cloudPrice > 0 && cloudPrice != unitPrice) {
          unitPrice = cloudPrice;
          prefs.putFloat("price", unitPrice);
          calculateValues();
        }
      }

      int unitsIdx = response.indexOf("\"allowedUnits\":");
      if (unitsIdx != -1) {
        float cloudUnits = response.substring(unitsIdx + 15).toFloat();
        if (cloudUnits > 0 && cloudUnits != allowedUnits) {
          allowedUnits = cloudUnits;
          prefs.putFloat("allowed", allowedUnits);
          calculateValues();
        }
      }
    } else {
      Serial.printf("[Cloud] POST failed, HTTP Code: %d\n", httpCode);
    }
    http.end();
  }
}

// ============================================================
// TFT HARDWARE DRAW ROUTINES
// ============================================================
void drawHeader(const char* title, uint16_t color) {
  tft.fillRect(0, 0, SCREEN_W, 38, NAVY);
  tft.setTextColor(color, NAVY);
  tft.setTextSize(2);
  tft.setCursor(12, 10);
  tft.print(title);

  tft.setTextColor(LIGHTGRAY, NAVY);
  tft.setTextSize(1);
  tft.setCursor(285, 14);
  tft.printf("%d/5", currentScreen + 1);
}

void drawCard(int x, int y, int w, int h, const char* title, String value, String unit, uint16_t bg, uint16_t valueColor) {
  tft.fillRoundRect(x, y, w, h, 8, bg);
  tft.drawRoundRect(x, y, w, h, 8, DARKGRAY);

  tft.setTextColor(LIGHTGRAY, bg);
  tft.setTextSize(1);
  tft.setCursor(x + 10, y + 8);
  tft.print(title);

  tft.setTextColor(valueColor, bg);
  tft.setTextSize(2);
  tft.setCursor(x + 10, y + 25);
  tft.print(value);

  if (unit.length() > 0) {
    tft.setTextSize(1);
    tft.print(" ");
    tft.print(unit);
  }
}

void drawScreenLive() {
  tft.fillScreen(BLACK);
  drawHeader("LIVE LOAD", CYAN);

  tft.fillRoundRect(10, 47, 300, 30, 8, loadON ? DARKGREEN : DARKGRAY);
  tft.setTextSize(2);
  tft.setTextColor(loadON ? GREEN : LIGHTGRAY, loadON ? DARKGREEN : DARKGRAY);
  tft.setCursor(22, 54);
  tft.print(loadON ? "●  LOAD ON" : "●  LOAD OFF");

  drawCard(10, 87, 145, 58, "VOLTAGE", loadON ? String(voltage, 1) : "0.0", "V", NAVY, YELLOW);
  drawCard(165, 87, 145, 58, "CURRENT", loadON ? String(current, 2) : "0.00", "A", NAVY, CYAN);

  tft.fillRoundRect(10, 155, 300, 70, 10, DARKGRAY);
  tft.setTextColor(LIGHTGRAY, DARKGRAY);
  tft.setTextSize(1);
  tft.setCursor(22, 164);
  tft.print("POWER CONSUMPTION");

  tft.setTextColor(loadON ? ORANGE : GRAY, DARKGRAY);
  tft.setTextSize(4);
  tft.setCursor(22, 182);
  if (loadON) tft.print(power, 1);
  else tft.print("0.0");
  tft.setTextSize(2);
  tft.print(" W");
}

void drawScreenEnergy() {
  tft.fillScreen(BLACK);
  drawHeader("ENERGY STATUS", GREEN);

  drawCard(10, 48, 145, 60, "ENERGY USED", String(usedEnergy, 3), "kWh", NAVY, CYAN);
  drawCard(165, 48, 145, 60, "UNITS USED", String(usedEnergy, 3), "units", NAVY, YELLOW);

  float unitsLeft = allowedUnits - usedEnergy;
  if (unitsLeft < 0) unitsLeft = 0;

  drawCard(10, 120, 145, 60, "UNITS LEFT", String(unitsLeft, 3), "units", DARKGREEN, GREEN);
  drawCard(165, 120, 145, 60, "UNIT PRICE", "Rs " + String(unitPrice, 2), "", DARKGRAY, ORANGE);

  tft.setTextColor(LIGHTGRAY, BLACK);
  tft.setTextSize(1);
  tft.setCursor(10, 192);
  tft.print("ENERGY LIMIT");

  float percentage = (allowedUnits > 0) ? (usedEnergy / allowedUnits) * 100.0 : 0;
  if (percentage > 100) percentage = 100;

  tft.fillRoundRect(10, 208, 300, 15, 5, DARKGRAY);
  int barWidth = (int)(300.0 * percentage / 100.0);
  if (barWidth > 0) tft.fillRoundRect(10, 208, barWidth, 15, 5, GREEN);
}

void drawScreenMoney() {
  tft.fillScreen(BLACK);
  drawHeader("MONEY STATUS", ORANGE);

  tft.fillRoundRect(10, 48, 300, 62, 10, NAVY);
  tft.setTextColor(LIGHTGRAY, NAVY);
  tft.setTextSize(1);
  tft.setCursor(20, 57);
  tft.print("TOTAL AMOUNT USED");

  tft.setTextColor(ORANGE, NAVY);
  tft.setTextSize(3);
  tft.setCursor(20, 76);
  tft.print("Rs ");
  tft.print(totalCost, 2);

  drawCard(10, 120, 145, 52, "ALLOWED", "Rs " + String(totalAllowedAmount, 2), "", DARKGRAY, WHITE);
  drawCard(165, 120, 145, 52, "BALANCE", "Rs " + String(amountRemaining, 2), "", DARKGREEN, GREEN);

  tft.setTextColor(LIGHTGRAY, BLACK);
  tft.setTextSize(1);
  tft.setCursor(10, 190);
  tft.print("PRICE / UNIT");

  tft.setTextColor(YELLOW, BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 207);
  tft.print("Rs ");
  tft.print(unitPrice, 2);

  float balancePercent = (totalAllowedAmount > 0) ? (amountRemaining / totalAllowedAmount) * 100.0 : 0;
  tft.setTextColor(balancePercent < 20 ? RED : GREEN, BLACK);
  tft.setTextSize(2);
  tft.setCursor(190, 207);
  tft.print(balancePercent, 0);
  tft.print("% LEFT");
}

void drawScreenTime() {
  tft.fillScreen(BLACK);
  drawHeader("LOAD TIME", CYAN);

  drawCard(10, 48, 145, 55, "START TIME", loadStartTime, "", NAVY, GREEN);
  drawCard(165, 48, 145, 55, "CURRENT TIME", getCurrentTime(), "", NAVY, CYAN);
  drawCard(10, 118, 145, 55, "RUNNING TIME", getRunningTime(), "", DARKGREEN, YELLOW);
  drawCard(165, 118, 145, 55, "LAST STOP", loadStopTime, "", DARKGRAY, LIGHTGRAY);

  tft.setTextColor(loadON ? GREEN : GRAY, BLACK);
  tft.setTextSize(2);
  tft.setCursor(35, 200);
  tft.print(loadON ? "LOAD IS RUNNING" : "LOAD IS STOPPED");
}

void drawScreenSummary() {
  tft.fillScreen(BLACK);
  drawHeader("ACCOUNT SUMMARY", PURPLE);

  drawCard(10, 48, 145, 52, "ALLOWED UNITS", String(allowedUnits, 2), "kWh", NAVY, WHITE);
  drawCard(165, 48, 145, 52, "USED UNITS", String(usedEnergy, 2), "kWh", NAVY, YELLOW);

  float unitsLeft = allowedUnits - usedEnergy;
  if (unitsLeft < 0) unitsLeft = 0;

  drawCard(10, 112, 145, 52, "REMAINING", String(unitsLeft, 2), "kWh", DARKGREEN, GREEN);
  drawCard(165, 112, 145, 52, "TOTAL COST", "Rs " + String(totalCost, 2), "", NAVY, ORANGE);

  tft.fillRoundRect(10, 178, 300, 45, 8, amountRemaining > 0 ? DARKGREEN : RED);
  tft.setTextColor(WHITE, amountRemaining > 0 ? DARKGREEN : RED);
  tft.setTextSize(1);
  tft.setCursor(20, 185);
  tft.print("AMOUNT BALANCE");

  tft.setTextSize(2);
  tft.setCursor(20, 199);
  tft.print("Rs ");
  tft.print(amountRemaining, 2);

  tft.setCursor(210, 199);
  tft.print(amountRemaining > 0 ? "AVAILABLE" : "DUE");
}

void drawCurrentScreen() {
  switch (currentScreen) {
    case 0: drawScreenLive(); break;
    case 1: drawScreenEnergy(); break;
    case 2: drawScreenMoney(); break;
    case 3: drawScreenTime(); break;
    case 4: drawScreenSummary(); break;
  }
}

void updateTFTScreen() {
  if (millis() - lastTFTUpdate < TFT_UPDATE_INTERVAL) return;
  lastTFTUpdate = millis();

  if (millis() - lastScreenChange >= TFT_SCREEN_TIME) {
    lastScreenChange = millis();
    currentScreen = (currentScreen + 1) % 5;
  }
  drawCurrentScreen();
}

// ============================================================
// WIFI SETUP & CONNECT ROUTINES
// ============================================================
bool connectWiFi() {
  Serial.println("\nConnecting WiFi...");
  tft.fillScreen(BLACK);
  tft.setTextColor(YELLOW, BLACK);
  tft.setTextSize(2);
  tft.setCursor(20, 30);
  tft.println("WIFI CONNECTING");

  tft.setTextColor(WHITE, BLACK);
  tft.setTextSize(1);
  tft.setCursor(20, 75);
  tft.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT) {
    delay(300);
    tft.fillRect(20, 110, 280, 30, BLACK);
    tft.setTextColor(CYAN, BLACK);
    tft.setTextSize(2);
    tft.setCursor(20, 115);
    tft.printf("WAIT %lu sec", (millis() - start) / 1000);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected. IP: " + WiFi.localIP().toString());
    return true;
  }

  Serial.println("WiFi connection failed");
  WiFi.disconnect(true);
  return false;
}

void showIPScreen() {
  tft.fillScreen(BLACK);
  tft.setTextColor(GREEN, BLACK);
  tft.setTextSize(2);
  tft.setCursor(65, 25);
  tft.println("WIFI CONNECTED");

  String ip = WiFi.localIP().toString();
  tft.setTextColor(CYAN, BLACK);
  tft.setTextSize(3);
  int width = ip.length() * 18;
  tft.setCursor(max(0, (320 - width) / 2), 75);
  tft.println(ip);

  tft.setTextColor(WHITE, BLACK);
  tft.setTextSize(2);
  tft.setCursor(55, 125);
  tft.println("LOCAL & CLOUD ON");

  tft.setTextColor(YELLOW, BLACK);
  tft.setCursor(75, 170);
  tft.println("SYNCING TO RENDER");
}

void showOfflineScreen() {
  tft.fillScreen(BLACK);
  tft.setTextColor(ORANGE, BLACK);
  tft.setTextSize(2);
  tft.setCursor(55, 30);
  tft.println("WIFI OFFLINE");

  tft.setTextColor(GREEN, BLACK);
  tft.setTextSize(3);
  tft.setCursor(75, 75);
  tft.println("LOCAL");

  tft.setTextColor(WHITE, BLACK);
  tft.setTextSize(2);
  tft.setCursor(40, 125);
  tft.println("METER STILL WORKS");

  tft.setTextColor(CYAN, BLACK);
  tft.setCursor(45, 175);
  tft.println("WIFI RETRY: 10 MIN");
}

void checkWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWiFiAttempt < WIFI_RETRY_INTERVAL) return;

  lastWiFiAttempt = millis();
  bool connected = connectWiFi();

  if (connected) {
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
    showIPScreen();
    delay(4000);
    currentScreen = 0;
    drawCurrentScreen();
  } else {
    showOfflineScreen();
    delay(2000);
    drawCurrentScreen();
  }
}

// ============================================================
// LOCAL BACKUP WEB SERVER ENDPOINTS (FOR OFFLINE / LOCAL VIEW)
// ============================================================
void handleAPI() {
  float unitsLeft = allowedUnits - usedEnergy;
  if (unitsLeft < 0) unitsLeft = 0;

  String json = "{";
  json += "\"voltage\":" + String(loadON ? voltage : 0, 2);
  json += ",\"current\":" + String(loadON ? current : 0, 3);
  json += ",\"power\":" + String(loadON ? power : 0, 2);
  json += ",\"pf\":" + String(loadON ? powerFactor : 0, 2);
  json += ",\"energy\":" + String(usedEnergy, 3);
  json += ",\"unitsLeft\":" + String(unitsLeft, 3);
  json += ",\"cost\":" + String(totalCost, 2);
  json += ",\"price\":" + String(unitPrice, 2);
  json += ",\"allowedUnits\":" + String(allowedUnits, 3);
  json += ",\"allowedAmount\":" + String(totalAllowedAmount, 2);
  json += ",\"amountRemaining\":" + String(amountRemaining, 2);
  json += ",\"load\":" + String(loadON ? "true" : "false");
  json += ",\"wifi\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false");
  json += ",\"startTime\":\"" + loadStartTime + "\"";
  json += ",\"stopTime\":\"" + loadStopTime + "\"";
  json += ",\"currentTime\":\"" + getCurrentTime() + "\"";
  json += ",\"runningTime\":\"" + getRunningTime() + "\"";
  json += "}";

  server.send(200, "application/json", json);
}

void handleHome() {
  server.send(200, "text/plain", "ESP32 PZEM Energy Meter is Online and reporting to Render Cloud.");
}

void startWebServer() {
  server.on("/", HTTP_GET, handleHome);
  server.on("/api", HTTP_GET, handleAPI);
  server.begin();
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize TFT Display
  tft.init();
  tft.setRotation(1);
  tft.fillScreen(BLACK);

  tft.setTextColor(CYAN, BLACK);
  tft.setTextSize(3);
  tft.setCursor(35, 35);
  tft.println("POWER");
  tft.setCursor(35, 75);
  tft.println("METER");

  tft.setTextColor(WHITE, BLACK);
  tft.setTextSize(2);
  tft.setCursor(35, 125);
  tft.println("ESP32 + CLOUD");
  tft.setCursor(35, 160);
  tft.println("STARTING...");

  delay(1200);

  // PZEM Hardware Serial (Serial2)
  Serial2.begin(9600, SERIAL_8N1, PZEM_RX, PZEM_TX);

  // Load Saved Preferences
  prefs.begin("powermeter", false);
  unitPrice = prefs.getFloat("price", 8.50);
  allowedUnits = prefs.getFloat("allowed", 100.0);
  initialEnergy = prefs.getFloat("initial", 0.0);

  // Connect to WiFi
  bool connected = connectWiFi();
  if (connected) {
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
    showIPScreen();
    delay(4000);
  } else {
    showOfflineScreen();
    delay(2000);
  }

  // Launch Local Server
  startWebServer();

  // Initial PZEM read & first display render
  readPZEM();
  currentScreen = 0;
  drawCurrentScreen();

  lastScreenChange = millis();
  lastWiFiAttempt = millis();
}

// ============================================================
// MAIN LOOP
// ============================================================
void loop() {
  server.handleClient();
  checkWiFi();

  // Periodic PZEM Sensor Read (Every 1s)
  if (millis() - lastPzemUpdate >= PZEM_INTERVAL) {
    lastPzemUpdate = millis();
    readPZEM();
  }

  // Periodic Cloud Telemetry Sync to Render (Every 5s)
  sendTelemetryToCloud();

  // Periodic TFT Screen Updates & Transitions
  updateTFTScreen();

  // Periodically Persist Settings (Every 30s)
  if (millis() - lastSettingsSave >= SETTINGS_SAVE_INTERVAL) {
    lastSettingsSave = millis();
    prefs.putFloat("price", unitPrice);
    prefs.putFloat("allowed", allowedUnits);
  }

  delay(5);
}
