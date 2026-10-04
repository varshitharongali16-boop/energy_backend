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
// WIFI CONFIGURATION
// ============================================================
const char* WIFI_SSID = "Nothing Phone (3a)_2505";
const char* WIFI_PASS = "praveen DSP";

WebServer server(80);

const unsigned long WIFI_RETRY_INTERVAL = 600000UL; // 10 minutes
const unsigned long WIFI_TIMEOUT        = 15000UL;  // 15 seconds
unsigned long lastWiFiAttempt = 0;

// ============================================================
// CLOUD BACKEND (RENDER) CONFIGURATION
// ============================================================
// Telemetry is synchronized to your Render cloud service.
// Tariff unit price, recharges, and reset commands are managed centrally by the Admin on the website.
const char* CLOUD_API_URL  = "https://energy-backend-gwex.onrender.com/api/device/telemetry";
const char* DEVICE_ID      = "ESP32_METER_01";
const char* DEVICE_API_KEY = "meter_secret_key_123";

// CORRECTION NUMBER (Calibration Multiplier for PZEM-004T / CT sensor)
float CORRECTION_NUM = 1.000;

// Hourly Cloud Sync Mode (Sends 1 request every hour = 3600000ms)
#define HOURLY_SYNC_MODE true
const unsigned long CLOUD_SYNC_INTERVAL = HOURLY_SYNC_MODE ? 3600000UL : 15000UL;
unsigned long lastCloudSync = 0;

// ============================================================
// PZEM-004T v3.0 HARDWARE SERIAL (Serial2)
// ============================================================
#define PZEM_RX 34
#define PZEM_TX 21
PZEM004Tv30 pzem(Serial2, PZEM_RX, PZEM_TX);

// ============================================================
// PERSISTENT STORAGE (NVS Preferences)
// ============================================================
Preferences prefs;

// ============================================================
// PREPAID RECHARGE & ENERGY TARIFF
// Controlled centrally by Cloud Admin
// ============================================================
float unitPrice      = 8.50;    // In ₹ / kWh
float rechargeAmount = 1000.0;  // Prepaid funds credited (₹)
float initialEnergy  = 0.0;

float energy         = 0.0;
float usedEnergy     = 0.0;
float totalCost      = 0.0;     // Total billed (₹)
float accountBalance = 1000.0;  // Available balance (₹)
float overdueAmount  = 0.0;     // Overdue debt if balance < 0 (₹)
float unitsAvailable = 0.0;     // kWh units purchasable from balance
float lockedBilledCost   = 0.0; // Billed usage locked at previous tariff (₹)
float lockedBilledEnergy = 0.0; // Energy reading when tariff was locked (kWh)

// Live Readings from PZEM
float voltage     = 0.0;
float current     = 0.0;
float power       = 0.0;
float powerFactor = 0.0;

// ============================================================
// LOAD SENSING & SESSIONS BREAKDOWN
// ============================================================
#define LOAD_ON_THRESHOLD  5.0
#define LOAD_OFF_THRESHOLD 3.0

bool loadON = false;
bool previousLoadON = false;
String loadStartTime = "--:--:--";
String loadStopTime  = "--:--:--";
unsigned long loadStartMillis = 0;

// Circular buffer for load sessions
struct LoadSession {
  String startTime;
  String stopTime;
  unsigned long durationSec;
  float peakPower;
  float energyKWh;
  float sessionCost;
};
#define MAX_SESSIONS 8
LoadSession sessionHistory[MAX_SESSIONS];
int sessionCount = 0;
float sessionStartEnergy = 0.0;
float sessionPeakPower = 0.0;

// ============================================================
// TFT SCREEN ROTATION & TIMERS
// ============================================================
#define TFT_SCREEN_TIME 5000UL
int currentScreen = 0;
unsigned long lastScreenChange = 0;

unsigned long lastPzemUpdate = 0;
unsigned long lastTFTUpdate  = 0;
unsigned long lastSettingsSave = 0;

const unsigned long PZEM_INTERVAL       = 1000;  // Read PZEM every 1s
const unsigned long TFT_UPDATE_INTERVAL = 1000;  // Update TFT every 1s
const unsigned long SETTINGS_SAVE_INTERVAL = 30000; // Auto-save every 30s

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
// TIME HELPERS
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
// VALUE CALCULATIONS
// ============================================================
void calculateValues() {
  usedEnergy = energy - initialEnergy;
  if (usedEnergy < 0) usedEnergy = 0;

  // Tariff rule: locked cost for past units, new tariff for remaining/future units
  float incrementalEnergy = usedEnergy - lockedBilledEnergy;
  if (incrementalEnergy < 0) incrementalEnergy = 0;
  totalCost = lockedBilledCost + (incrementalEnergy * unitPrice);

  float rawBalance = rechargeAmount - totalCost;
  if (rawBalance >= 0) {
    accountBalance = rawBalance;
    overdueAmount = 0.0;
  } else {
    accountBalance = 0.0;
    overdueAmount = fabs(rawBalance);
  }

  unitsAvailable = unitPrice > 0 ? (accountBalance / unitPrice) : 0;
}

// ============================================================
// PZEM READING & LOAD SENSING
// ============================================================
void readPZEM() {
  float newVoltage = pzem.voltage();
  float newCurrent = pzem.current();
  float newPower   = pzem.power();
  float newEnergy  = pzem.energy();
  float newPF      = pzem.pf();

  // Apply calibration correction factor if valid
  if (!isnan(newVoltage)) voltage = newVoltage * CORRECTION_NUM;
  if (!isnan(newCurrent)) current = newCurrent * CORRECTION_NUM;
  if (!isnan(newPower))   power   = newPower   * CORRECTION_NUM;
  if (!isnan(newEnergy))  energy  = newEnergy;
  if (!isnan(newPF))      powerFactor = newPF;

  calculateValues();

  previousLoadON = loadON;
  if (loadON) {
    if (power <= LOAD_OFF_THRESHOLD) loadON = false;
    if (power > sessionPeakPower) sessionPeakPower = power;
  } else {
    if (power >= LOAD_ON_THRESHOLD) loadON = true;
  }

  // Load Session Started
  if (loadON && !previousLoadON) {
    loadStartMillis = millis();
    loadStartTime = getCurrentTime();
    sessionStartEnergy = energy;
    sessionPeakPower = power;
    Serial.println("[PZEM] Load Session Started at: " + loadStartTime);
  }

  // Load Session Stopped
  if (!loadON && previousLoadON) {
    loadStopTime = getCurrentTime();
    unsigned long durSec = (millis() - loadStartMillis) / 1000;
    float sessEnergy = energy - sessionStartEnergy;
    if (sessEnergy < 0) sessEnergy = 0;
    float sessCost = sessEnergy * unitPrice;

    // Push into circular buffer
    for (int i = MAX_SESSIONS - 1; i > 0; i--) {
      sessionHistory[i] = sessionHistory[i - 1];
    }
    sessionHistory[0].startTime = loadStartTime;
    sessionHistory[0].stopTime = loadStopTime;
    sessionHistory[0].durationSec = durSec;
    sessionHistory[0].peakPower = sessionPeakPower;
    sessionHistory[0].energyKWh = sessEnergy;
    sessionHistory[0].sessionCost = sessCost;
    if (sessionCount < MAX_SESSIONS) sessionCount++;

    Serial.printf("[PZEM] Load Stopped. Duration: %lus, Energy: %.3fkWh, Cost: Rs %.2f\n", durSec, sessEnergy, sessCost);
  }
}

// ============================================================
// CLOUD TELEMETRY INGESTION (SEND TO RENDER & SYNC TARIFF)
// ============================================================
void sendTelemetryToCloud() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastCloudSync < CLOUD_SYNC_INTERVAL) return;
  lastCloudSync = millis();

  WiFiClientSecure client;
  client.setInsecure(); // Skip SSL cert validation for embedded ESP32

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
    payload += "\"isLoadOn\":" + String(loadON ? "true" : "false") + ",";
    payload += "\"correctionNum\":" + String(CORRECTION_NUM, 4);

    // If a session just ended, attach it
    if (sessionCount > 0 && !loadON) {
      payload += ",\"session\":{";
      payload += "\"startTime\":\"" + sessionHistory[0].startTime + "\",";
      payload += "\"stopTime\":\"" + sessionHistory[0].stopTime + "\",";
      payload += "\"durationSeconds\":" + String(sessionHistory[0].durationSec) + ",";
      payload += "\"peakPower\":" + String(sessionHistory[0].peakPower, 1) + ",";
      payload += "\"energy\":" + String(sessionHistory[0].energyKWh, 4);
      payload += "}";
    }

    payload += "}";

    int httpCode = http.POST(payload);
    if (httpCode == HTTP_CODE_OK) {
      String response = http.getString();
      Serial.println("[Cloud] Synchronized successfully with Render backend.");

      // Check if admin triggered a complete data wipe / reset
      if (response.indexOf("\"resetCommand\":true") != -1) {
        Serial.println("[Cloud] Admin WIPE command received! Resetting local meter data...");
        initialEnergy = energy;
        usedEnergy = 0;
        totalCost = 0;
        lockedBilledCost = 0;
        lockedBilledEnergy = 0;
        sessionCount = 0;
        prefs.putFloat("initial", initialEnergy);
        prefs.putFloat("used", 0);
        prefs.putFloat("cost", 0);
        prefs.putFloat("lockCost", 0);
        prefs.putFloat("lockEnergy", 0);
        calculateValues();
      }

      // Sync recharge amount set by Admin on website
      int rechargeIdx = response.indexOf("\"rechargeAmount\":");
      if (rechargeIdx != -1) {
        float cloudRecharge = response.substring(rechargeIdx + 17).toFloat();
        if (cloudRecharge >= 0 && cloudRecharge != rechargeAmount) {
          rechargeAmount = cloudRecharge;
          prefs.putFloat("recharge", rechargeAmount);
          calculateValues();
          Serial.printf("[Cloud] Admin credited Recharge Balance: Rs %.2f\n", rechargeAmount);
        }
      }

      // Sync official tariff price set by Admin on website
      int priceIdx = response.indexOf("\"unitPrice\":");
      if (priceIdx != -1) {
        float cloudPrice = response.substring(priceIdx + 12).toFloat();
        if (cloudPrice > 0 && cloudPrice != unitPrice) {
          unitPrice = cloudPrice;
          prefs.putFloat("price", unitPrice);
          calculateValues();
          Serial.printf("[Cloud] Admin updated Tariff Unit Price: Rs %.2f/kWh\n", unitPrice);
        }
      }

      // Sync totalBilled (locked billed usage) from Cloud
      int billedIdx = response.indexOf("\"totalBilled\":");
      if (billedIdx != -1) {
        float cloudBilled = response.substring(billedIdx + 14).toFloat();
        if (cloudBilled >= 0) {
          lockedBilledCost = cloudBilled;
          lockedBilledEnergy = usedEnergy;
          prefs.putFloat("lockCost", lockedBilledCost);
          prefs.putFloat("lockEnergy", lockedBilledEnergy);
          calculateValues();
        }
      }

      // Sync account balance from Cloud
      int balIdx = response.indexOf("\"accountBalance\":");
      if (balIdx != -1) {
        float cloudBal = response.substring(balIdx + 17).toFloat();
        if (cloudBal >= 0) {
          accountBalance = cloudBal;
        }
      }

      // Sync overdue amount from Cloud
      int dueIdx = response.indexOf("\"overdueAmount\":");
      if (dueIdx != -1) {
        float cloudDue = response.substring(dueIdx + 16).toFloat();
        if (cloudDue >= 0) {
          overdueAmount = cloudDue;
        }
      }
    } else {
      Serial.printf("[Cloud] POST failed, HTTP status: %d\n", httpCode);
    }
    http.end();
  }
}

// ============================================================
// TFT DISPLAY DRAW ROUTINES
// ============================================================
void drawHeader(const char* title, uint16_t color) {
  tft.fillRect(0, 0, SCREEN_W, 38, NAVY);
  tft.setTextColor(color, NAVY);
  tft.setTextSize(2);
  tft.setCursor(10, 10);
  tft.print(title);

  // Display Local IP on Header so user can always see it
  if (WiFi.status() == WL_CONNECTED) {
    tft.setTextColor(CYAN, NAVY);
    tft.setTextSize(1);
    tft.setCursor(160, 14);
    tft.print(WiFi.localIP().toString());
  } else {
    tft.setTextColor(ORANGE, NAVY);
    tft.setTextSize(1);
    tft.setCursor(185, 14);
    tft.print("OFFLINE");
  }

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
  tft.print(loadON ? "●  LOAD ON" : "●  STANDBY");

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

  drawCard(10, 120, 145, 60, "AVAILABLE UNITS", String(unitsAvailable, 2), "kWh", DARKGREEN, GREEN);
  drawCard(165, 120, 145, 60, "UNIT PRICE", "Rs " + String(unitPrice, 2), "", DARKGRAY, ORANGE);

  tft.setTextColor(LIGHTGRAY, BLACK);
  tft.setTextSize(1);
  tft.setCursor(10, 192);
  tft.print("RECHARGE BALANCE PROGRESS");

  float percentage = rechargeAmount > 0 ? (accountBalance / rechargeAmount) * 100.0 : 0;
  if (percentage > 100) percentage = 100;
  if (percentage < 0) percentage = 0;

  tft.fillRoundRect(10, 208, 300, 15, 5, DARKGRAY);
  int barWidth = (int)(300.0 * percentage / 100.0);
  if (barWidth > 0) tft.fillRoundRect(10, 208, barWidth, 15, 5, percentage < 20 ? RED : GREEN);
}

void drawScreenMoney() {
  tft.fillScreen(BLACK);
  drawHeader("MONEY STATUS", ORANGE);

  // Available Balance
  tft.fillRoundRect(10, 48, 300, 62, 10, NAVY);
  tft.setTextColor(LIGHTGRAY, NAVY);
  tft.setTextSize(1);
  tft.setCursor(20, 57);
  tft.print("AVAILABLE BALANCE");

  tft.setTextColor(accountBalance > 0 ? GREEN : RED, NAVY);
  tft.setTextSize(3);
  tft.setCursor(20, 76);
  tft.print("Rs ");
  tft.print(accountBalance, 2);

  // Recharge & Billed
  drawCard(10, 120, 145, 52, "RECHARGED", "Rs " + String(rechargeAmount, 2), "", DARKGRAY, WHITE);
  drawCard(165, 120, 145, 52, "TOTAL BILLED", "Rs " + String(totalCost, 2), "", DARKGREEN, ORANGE);

  // Unit price and Overdue
  tft.setTextColor(LIGHTGRAY, BLACK);
  tft.setTextSize(1);
  tft.setCursor(10, 190);
  tft.print("PRICE / UNIT");

  tft.setTextColor(YELLOW, BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 207);
  tft.print("Rs ");
  tft.print(unitPrice, 2);

  if (overdueAmount > 0) {
    tft.setTextColor(RED, BLACK);
    tft.setTextSize(2);
    tft.setCursor(170, 207);
    tft.print("DUE: Rs ");
    tft.print(overdueAmount, 0);
  } else {
    tft.setTextColor(GREEN, BLACK);
    tft.setTextSize(2);
    tft.setCursor(190, 207);
    tft.print("ACTIVE OK");
  }
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
  tft.print(loadON ? "LOAD IS RUNNING" : "LOAD IS STANDBY");
}

void drawScreenSummary() {
  tft.fillScreen(BLACK);
  drawHeader("ACCOUNT SUMMARY", PURPLE);

  drawCard(10, 48, 145, 52, "RECHARGED", "Rs " + String(rechargeAmount, 2), "", NAVY, WHITE);
  drawCard(165, 48, 145, 52, "TOTAL BILLED", "Rs " + String(totalCost, 2), "", NAVY, YELLOW);

  drawCard(10, 112, 145, 52, "UNITS USED", String(usedEnergy, 2) + " kWh", "", DARKGREEN, CYAN);
  drawCard(165, 112, 145, 52, "UNITS LEFT", String(unitsAvailable, 2) + " kWh", "", NAVY, GREEN);

  // Balance
  tft.fillRoundRect(10, 178, 300, 45, 8, overdueAmount > 0 ? RED : DARKGREEN);
  tft.setTextColor(WHITE, overdueAmount > 0 ? RED : DARKGREEN);
  tft.setTextSize(1);
  tft.setCursor(20, 185);
  tft.print(overdueAmount > 0 ? "OUTSTANDING DUE" : "ACCOUNT BALANCE");

  tft.setTextSize(2);
  tft.setCursor(20, 199);
  tft.print("Rs ");
  tft.print(overdueAmount > 0 ? overdueAmount : accountBalance, 2);

  tft.setCursor(210, 199);
  tft.print(overdueAmount > 0 ? "DUE" : "AVAILABLE");
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
// WIFI CONNECT & STATUS SCREENS
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
  tft.setCursor(65, 20);
  tft.println("WIFI CONNECTED");

  String ip = WiFi.localIP().toString();
  tft.setTextColor(CYAN, BLACK);
  tft.setTextSize(3);
  int width = ip.length() * 18;
  tft.setCursor(max(0, (320 - width) / 2), 65);
  tft.println(ip);

  tft.setTextColor(WHITE, BLACK);
  tft.setTextSize(2);
  tft.setCursor(35, 115);
  tft.println("OPEN LOCAL IP IN BROWSER");

  tft.setTextColor(LIGHTGRAY, BLACK);
  tft.setTextSize(1);
  tft.setCursor(38, 155);
  tft.println("LOCAL: READ-ONLY LIVE TELEMETRY");

  tft.setTextColor(YELLOW, BLACK);
  tft.setTextSize(1);
  tft.setCursor(38, 175);
  tft.println("ADMIN: SETTINGS & RESETS ON CLOUD WEB");

  tft.setTextColor(CYAN, BLACK);
  tft.setTextSize(1);
  tft.setCursor(85, 205);
  tft.println("STARTING SCREEN ROTATION (8s)...");
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
    delay(8000);
    currentScreen = 0;
    drawCurrentScreen();
  } else {
    showOfflineScreen();
    delay(2000);
    drawCurrentScreen();
  }
}

// ============================================================
// REST API (FOR LOCAL LIVE READINGS & SESSIONS)
// ============================================================
void handleAPI() {
  String json = "{";
  json += "\"voltage\":" + String(loadON ? voltage : 0, 2);
  json += ",\"current\":" + String(loadON ? current : 0, 3);
  json += ",\"power\":" + String(loadON ? power : 0, 2);
  json += ",\"pf\":" + String(loadON ? powerFactor : 0, 2);
  json += ",\"energy\":" + String(usedEnergy, 3);
  json += ",\"unitPrice\":" + String(unitPrice, 2);
  json += ",\"rechargeAmount\":" + String(rechargeAmount, 2);
  json += ",\"accountBalance\":" + String(accountBalance, 2);
  json += ",\"billedAmount\":" + String(totalCost, 2);
  json += ",\"overdueAmount\":" + String(overdueAmount, 2);
  json += ",\"unitsAvailable\":" + String(unitsAvailable, 3);
  json += ",\"load\":" + String(loadON ? "true" : "false");
  json += ",\"wifi\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false");
  json += ",\"startTime\":\"" + loadStartTime + "\"";
  json += ",\"stopTime\":\"" + loadStopTime + "\"";
  json += ",\"currentTime\":\"" + getCurrentTime() + "\"";
  json += ",\"runningTime\":\"" + getRunningTime() + "\"";
  json += ",\"correctionNum\":" + String(CORRECTION_NUM, 4);

  // Sessions array
  json += ",\"sessions\":[";
  for (int i = 0; i < sessionCount; i++) {
    if (i > 0) json += ",";
    json += "{";
    json += "\"id\":" + String(i + 1) + ",";
    json += "\"startTime\":\"" + sessionHistory[i].startTime + "\",";
    json += "\"stopTime\":\"" + sessionHistory[i].stopTime + "\",";
    json += "\"durationSeconds\":" + String(sessionHistory[i].durationSec) + ",";
    json += "\"peakPower\":" + String(sessionHistory[i].peakPower, 1) + ",";
    json += "\"energy\":" + String(sessionHistory[i].energyKWh, 3) + ",";
    json += "\"cost\":" + String(sessionHistory[i].sessionCost, 2);
    json += "}";
  }
  json += "]";

  json += "}";
  server.send(200, "application/json", json);
}

// ============================================================
// LOCAL WEB PAGE (READ-ONLY CONSUMER LIVE VIEW)
// EXACT SAME MODERN UI & STRUCTURE AS THE USER CLOUD LOGIN PORTAL
// ============================================================
String htmlPage() {
  return R"rawliteral(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>VOLTRONIX CLOUD — Local Power Monitor</title>
<style>
:root {
  --bg-deep: #f8fafc;
  --card-bg: rgba(255, 255, 255, 0.94);
  --border: #e2e8f0;
  --text-main: #0f172a;
  --text-dim: #475569;
  --cyan: #0284c7;
  --blue: #2563eb;
  --emerald: #059669;
  --amber: #d97706;
  --red: #dc2626;
}
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
body {
  background: var(--bg-deep);
  background-image:
    radial-gradient(circle at 10% 15%, rgba(2, 132, 199, 0.08), transparent 45%),
    radial-gradient(circle at 90% 85%, rgba(5, 150, 105, 0.07), transparent 48%);
  background-attachment: fixed;
  color: var(--text-main);
  min-height: 100vh;
  padding: 16px 12px 30px;
}
.container { max-width: 1100px; margin: 0 auto; }
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.06);
  transition: all 0.3s ease;
}
.card:hover { border-color: rgba(2, 132, 199, 0.35); box-shadow: 0 10px 25px -4px rgba(2, 132, 199, 0.12); }

/* Header */
.header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 24px; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;
}
.brand { display: flex; align-items: center; gap: 12px; }
.brand-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, var(--cyan), var(--blue));
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 900; font-size: 22px;
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.3);
}
.brand-title { font-size: 1.25rem; font-weight: 900; color: var(--text-main); }
.brand-sub { font-size: 0.75rem; color: var(--text-dim); }
.status-pill {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 16px; border-radius: 30px; font-size: 0.78rem; font-weight: 800;
  background: #ffffff; border: 1px solid var(--border);
}
.dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--emerald); box-shadow: 0 0 10px var(--emerald);
  animation: pulse 1.8s infinite;
}

/* Security Notice */
.readonly-notice {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px; border-radius: 14px;
  background: #e0f2fe; border: 1px solid #bae6fd;
  color: #0369a1; font-size: 0.82rem; font-weight: 600;
  margin-bottom: 20px;
}

/* Overdue Banner */
#overdueBanner {
  display: none; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-radius: 16px;
  background: #fef2f2; border: 1px solid #fecaca;
  color: #991b1b; margin-bottom: 18px;
}

/* Hero Section */
.hero { display: grid; grid-template-columns: 1.35fr 1fr; gap: 20px; margin-bottom: 20px; }
.power-card { padding: 24px; display: flex; flex-direction: column; justify-content: space-between; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.card-lbl { font-size: 0.78rem; font-weight: 800; letter-spacing: 0.8px; color: var(--text-dim); text-transform: uppercase; }
.load-badge {
  padding: 5px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 800;
  display: flex; align-items: center; gap: 6px;
}
.load-on { background: #ecfdf5; color: var(--emerald); border: 1px solid #a7f3d0; }
.load-off { background: #f1f5f9; color: var(--text-dim); border: 1px solid #e2e8f0; }

.gauge-box { text-align: center; margin: 18px 0 10px; position: relative; }
.gauge-svg { width: 100%; max-width: 260px; height: auto; }
.gauge-track { fill: none; stroke: #e2e8f0; stroke-width: 14; stroke-linecap: round; }
.gauge-bar {
  fill: none; stroke: url(#pGrad); stroke-width: 14; stroke-linecap: round;
  stroke-dasharray: 251.3; stroke-dashoffset: 251.3;
  transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}
.power-center { position: absolute; bottom: 8px; width: 100%; left: 0; text-align: center; }
.power-val {
  font-size: 3.2rem; font-weight: 900; line-height: 1;
  color: var(--text-main); font-variant-numeric: tabular-nums;
}
.power-unit { font-size: 1.15rem; color: var(--cyan); font-weight: 800; margin-left: 4px; }
.card-foot {
  display: flex; justify-content: space-between; padding-top: 14px;
  border-top: 1px solid var(--border); font-size: 0.8rem; color: var(--text-dim);
}

/* Quota / Balance Card */
.budget-card { padding: 24px; display: flex; flex-direction: column; justify-content: space-between; }
.metric-row { margin-bottom: 18px; }
.metric-row:last-child { margin-bottom: 0; }
.row-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.row-val { font-size: 1.6rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.track { height: 12px; background: #e2e8f0; border-radius: 20px; overflow: hidden; position: relative; }
.fill { height: 100%; width: 0%; border-radius: 20px; transition: width 0.8s ease; }
.sub-meta { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--text-dim); margin-top: 6px; font-weight: 600; }

/* Grid Tiles */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-bottom: 20px; }
.tile { padding: 18px 20px; display: flex; align-items: center; gap: 14px; }
.tile-icon {
  width: 44px; height: 44px; border-radius: 12px; background: #f1f5f9;
  display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0;
}
.tile-body { flex-grow: 1; }
.tile-lbl { font-size: 0.72rem; font-weight: 800; color: var(--text-dim); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 3px; }
.tile-val { font-size: 1.35rem; font-weight: 900; color: var(--text-main); font-variant-numeric: tabular-nums; }
.tile-unit { font-size: 0.82rem; font-weight: 600; color: var(--text-dim); margin-left: 2px; }

/* Tables */
.table-card { padding: 22px 24px; margin-bottom: 20px; }
.table-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.table-title { font-size: 1.05rem; font-weight: 800; }
.table-wrapper { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: left; }
th { background: #f8fafc; padding: 10px 12px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; font-size: 0.72rem; }
td { padding: 10px 12px; border-top: 1px solid var(--border); }
tr:hover td { background: #f8fafc; }

@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.9); } }

@media (max-width: 800px) { .hero { grid-template-columns: 1fr; } }
@media (max-width: 520px) {
  .header { flex-direction: column; align-items: flex-start; }
  .grid { grid-template-columns: 1fr 1fr; }
  .power-val { font-size: 2.7rem; }
}
</style>
</head>
<body>

<div class="container">

  <!-- Header -->
  <header class="header card">
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <div>
        <div class="brand-title">VOLTRONIX CLOUD</div>
        <div class="brand-sub">ESP32 Local Consumer Monitor (Read-Only)</div>
      </div>
    </div>
    <div class="status-pill">
      <div class="dot" id="statusDot"></div>
      <span id="statusText">LIVE LOCAL</span>
    </div>
  </header>

  <!-- Read-Only Notice -->
  <div class="readonly-notice">
    <span>🔒</span>
    <span>
      <strong>Read-Only Consumer View:</strong> Live telemetry is streamed directly from the PZEM-004T.
      Tariff updates, recharge crediting, and meter resets are securely administered via the central cloud website.
    </span>
  </div>

  <!-- Overdue Banner (Visible if overdue > 0) -->
  <div id="overdueBanner">
    <div>
      <strong style="font-size:0.95rem;">Outstanding Dues Notice: ₹<span id="overdueAmountBanner">0.00</span></strong>
      <div style="font-size:0.78rem;opacity:0.9;">Recharge balance has been depleted. Please contact administrator to recharge.</div>
    </div>
    <span style="font-size:0.8rem;font-weight:800;background:#fee2e2;color:var(--red);padding:4px 10px;borderRadius:12px;">PAYMENT DUE</span>
  </div>

  <!-- Hero Power & Quota Row -->
  <section class="hero">
    <!-- Active Power Speedometer -->
    <div class="power-card card">
      <div class="card-head">
        <span class="card-lbl">Active Power Load</span>
        <div class="load-badge load-off" id="loadBadge">
          <span>●</span> <span id="loadText">STANDBY</span>
        </div>
      </div>

      <div class="gauge-box">
        <svg class="gauge-svg" viewBox="0 0 200 125">
          <defs>
            <linearGradient id="pGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#0284c7" />
              <stop offset="45%" stop-color="#2563eb" />
              <stop offset="80%" stop-color="#d97706" />
              <stop offset="100%" stop-color="#dc2626" />
            </linearGradient>
          </defs>
          <path class="gauge-track" d="M 25 105 A 75 75 0 0 1 175 105" />
          <path class="gauge-bar" id="gaugePath" d="M 25 105 A 75 75 0 0 1 175 105" />
        </svg>
        <div class="power-center">
          <div class="power-val" id="powerVal">0.0</div>
          <span class="power-unit">W</span>
        </div>
      </div>

      <div class="card-foot">
        <span>Load Start: <strong id="startTime" style="color:var(--text-main)">--:--:--</strong></span>
        <span>Active Runtime: <strong id="runningTime" style="color:var(--cyan)">00:00:00</strong></span>
      </div>
    </div>

    <!-- Prepaid Balance Card -->
    <div class="budget-card card">
      <div class="card-head" style="margin-bottom:14px;">
        <span class="card-lbl">Prepaid Balance & Energy Quota</span>
        <span id="percentLeftBadge" style="font-size:0.8rem;font-weight:800;color:var(--emerald)">100% BALANCE LEFT</span>
      </div>

      <div class="metric-row">
        <div class="row-head">
          <span style="font-size:0.8rem;color:var(--text-dim)">Available Account Balance</span>
          <div class="row-val" style="color:var(--emerald)">
            ₹<span id="accountBalance">0.00</span>
          </div>
        </div>
        <div class="track">
          <div class="fill" id="moneyBar" style="background:linear-gradient(90deg, #10b981, #0284c7)"></div>
        </div>
        <div class="sub-meta">
          <span>Recharged: <strong>₹<span id="rechargeVal">0.00</span></strong></span>
          <span>Consumed: <strong>₹<span id="billedVal">0.00</span></strong></span>
        </div>
      </div>

      <div class="metric-row">
        <div class="row-head">
          <span style="font-size:0.8rem;color:var(--text-dim)">Units Available from Balance</span>
          <div class="row-val" style="color:var(--cyan)">
            <span id="unitsAvailableVal">0.000</span> <span style="font-size:0.9rem;color:var(--text-dim)">kWh</span>
          </div>
        </div>
        <div class="sub-meta">
          <span>Total Consumed: <strong><span id="usedEnergyVal">0.000</span> kWh</strong></span>
          <span id="overdueMeta" style="color:var(--red);display:none;font-weight:800;">Overdue: ₹<span id="overdueVal">0.00</span></span>
        </div>
      </div>
    </div>
  </section>

  <!-- Metric Tiles Grid -->
  <section class="grid">
    <div class="tile card">
      <div class="tile-icon" style="color:#0284c7;">⚡</div>
      <div class="tile-body">
        <div class="tile-lbl">Line Voltage</div>
        <div class="tile-val"><span id="voltageVal">0.0</span><span class="tile-unit">V</span></div>
      </div>
    </div>

    <div class="tile card">
      <div class="tile-icon" style="color:#7c3aed;">〰</div>
      <div class="tile-body">
        <div class="tile-lbl">Current Draw</div>
        <div class="tile-val"><span id="currentVal">0.000</span><span class="tile-unit">A</span></div>
      </div>
    </div>

    <div class="tile card">
      <div class="tile-icon" style="color:#d97706;">📊</div>
      <div class="tile-body">
        <div class="tile-lbl">Power Factor</div>
        <div class="tile-val"><span id="pfVal">0.00</span><span class="tile-unit">PF</span></div>
      </div>
    </div>

    <div class="tile card">
      <div class="tile-icon" style="color:#059669;">₹</div>
      <div class="tile-body">
        <div class="tile-lbl">Tariff Rate</div>
        <div class="tile-val">₹<span id="priceVal">0.00</span><span class="tile-unit">/kWh</span></div>
      </div>
    </div>

    <div class="tile card">
      <div class="tile-icon" style="color:#2563eb;">🕒</div>
      <div class="tile-body">
        <div class="tile-lbl">Clock (NTP Time)</div>
        <div class="tile-val" id="timeVal" style="font-size:1.15rem">--:--:--</div>
      </div>
    </div>

    <div class="tile card">
      <div class="tile-icon" style="color:#dc2626;">⏹</div>
      <div class="tile-body">
        <div class="tile-lbl">Last Stop Time</div>
        <div class="tile-val" id="stopVal" style="font-size:1.15rem">--:--:--</div>
      </div>
    </div>
  </section>

  <!-- Load Sessions Breakdown Table -->
  <section class="table-card card">
    <div class="table-head">
      <div class="table-title">⚡ Load Sessions & Consumption History</div>
      <div style="font-size:0.78rem;color:var(--text-dim);" id="sessionSummaryText">Recent appliance runs</div>
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Session #</th>
            <th>Start Time</th>
            <th>Stop Time</th>
            <th>Duration</th>
            <th>Peak Watts</th>
            <th>Units (kWh)</th>
            <th>Cost (₹)</th>
          </tr>
        </thead>
        <tbody id="sessionsTbody">
          <tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:14px;">No active sessions recorded yet.</td></tr>
        </tbody>
      </table>
    </div>
  </section>

</div>

<script>
let lastMaxPower = 3000.0;

async function update() {
  try {
    const res = await fetch('/api', { cache: 'no-store' });
    const d = await res.json();

    document.getElementById('voltageVal').innerText = d.voltage.toFixed(1);
    document.getElementById('currentVal').innerText = d.current.toFixed(3);
    document.getElementById('powerVal').innerText = d.power.toFixed(1);
    document.getElementById('pfVal').innerText = d.pf.toFixed(2);
    document.getElementById('priceVal').innerText = d.unitPrice.toFixed(2);
    document.getElementById('rechargeVal').innerText = d.rechargeAmount.toFixed(2);
    document.getElementById('billedVal').innerText = d.billedAmount.toFixed(2);
    document.getElementById('accountBalance').innerText = d.accountBalance.toFixed(2);
    document.getElementById('usedEnergyVal').innerText = d.energy.toFixed(3);
    document.getElementById('unitsAvailableVal').innerText = d.unitsAvailable.toFixed(3);
    document.getElementById('timeVal').innerText = d.currentTime;
    document.getElementById('runningTime').innerText = d.runningTime;
    document.getElementById('stopVal').innerText = d.stopTime;
    document.getElementById('startTime').innerText = d.startTime;

    // Overdue alerts
    const overdueBanner = document.getElementById('overdueBanner');
    const overdueMeta = document.getElementById('overdueMeta');
    if (d.overdueAmount > 0) {
      overdueBanner.style.display = 'flex';
      document.getElementById('overdueAmountBanner').innerText = d.overdueAmount.toFixed(2);
      overdueMeta.style.display = 'inline';
      document.getElementById('overdueVal').innerText = d.overdueAmount.toFixed(2);
    } else {
      overdueBanner.style.display = 'none';
      overdueMeta.style.display = 'none';
    }

    // Load status badge
    const loadBadge = document.getElementById('loadBadge');
    const loadText = document.getElementById('loadText');
    if (d.load) {
      loadBadge.className = 'load-badge load-on';
      loadText.innerText = 'LOAD ACTIVE';
    } else {
      loadBadge.className = 'load-badge load-off';
      loadText.innerText = 'STANDBY';
    }

    // Gauge ratio
    if (d.power > lastMaxPower) lastMaxPower = d.power * 1.25;
    let powerRatio = Math.min(Math.max(d.power / lastMaxPower, 0), 1);
    let offset = 251.3 - (powerRatio * 251.3);
    document.getElementById('gaugePath').style.strokeDashoffset = offset;

    // Balance Percentage & Bar
    let balPct = d.rechargeAmount > 0 ? (d.accountBalance / d.rechargeAmount) * 100 : 0;
    balPct = Math.min(Math.max(balPct, 0), 100);
    document.getElementById('moneyBar').style.width = balPct + '%';

    const pBadge = document.getElementById('percentLeftBadge');
    pBadge.innerText = Math.round(balPct) + '% BALANCE LEFT';
    pBadge.style.color = balPct < 20 ? 'var(--red)' : (balPct < 50 ? 'var(--amber)' : 'var(--emerald)');

    // WiFi status badge
    const statusText = document.getElementById('statusText');
    const dot = document.getElementById('statusDot');
    if (d.wifi) {
      statusText.innerText = 'LIVE • CONNECTED';
      dot.style.background = 'var(--emerald)';
    } else {
      statusText.innerText = 'LOCAL OFFLINE';
      dot.style.background = 'var(--amber)';
    }

    // Sessions table
    if (d.sessions && d.sessions.length > 0) {
      let tbodyHtml = '';
      d.sessions.forEach((s) => {
        let dur = Math.floor(s.durationSeconds / 60) + 'm ' + (s.durationSeconds % 60) + 's';
        tbodyHtml += '<tr>';
        tbodyHtml += '<td><strong>#' + s.id + '</strong></td>';
        tbodyHtml += '<td>' + s.startTime + '</td>';
        tbodyHtml += '<td>' + (s.stopTime && s.stopTime !== '--:--:--' ? s.stopTime : 'In Progress') + '</td>';
        tbodyHtml += '<td>' + dur + '</td>';
        tbodyHtml += '<td style="color:var(--cyan);font-weight:700;">' + s.peakPower.toFixed(1) + ' W</td>';
        tbodyHtml += '<td>' + s.energy.toFixed(3) + ' kWh</td>';
        tbodyHtml += '<td style="color:var(--emerald);font-weight:800;">₹' + s.cost.toFixed(2) + '</td>';
        tbodyHtml += '</tr>';
      });
      document.getElementById('sessionsTbody').innerHTML = tbodyHtml;
      document.getElementById('sessionSummaryText').innerText = d.sessions.length + ' sessions logged';
    }
  } catch (err) {
    document.getElementById('statusText').innerText = 'OFFLINE';
    document.getElementById('statusDot').style.background = 'var(--red)';
  }
}

setInterval(update, 1000);
update();
</script>
</body>
</html>)rawliteral";
}

// ============================================================
// WEB SERVER ENDPOINTS
// ============================================================
void handleHome() {
  server.send(200, "text/html", htmlPage());
}

// Local settings update attempt is blocked with 403 Forbidden
void handleSettingsForbidden() {
  server.send(403, "text/plain", "Forbidden: Tariff unit price and quota limits can only be configured by the Administrator on the Cloud Website.");
}

void handleResetForbidden() {
  server.send(403, "text/plain", "Forbidden: Energy and session resets are restricted exclusively to the central Cloud Admin Portal.");
}

void startWebServer() {
  server.on("/", HTTP_GET, handleHome);
  server.on("/api", HTTP_GET, handleAPI);
  server.on("/settings", HTTP_POST, handleSettingsForbidden);
  server.on("/reset", HTTP_POST, handleResetForbidden);
  server.begin();
  Serial.println("[Web] Local Read-Only Web Server started on port 80");
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
  tft.println("ESP32 + PZEM");
  tft.setCursor(35, 160);
  tft.println("STARTING...");

  delay(1200);

  // PZEM Hardware Serial (Serial2)
  Serial2.begin(9600, SERIAL_8N1, PZEM_RX, PZEM_TX);

  // Load Saved Preferences
  prefs.begin("powermeter", false);
  unitPrice          = prefs.getFloat("price", 8.50);
  rechargeAmount     = prefs.getFloat("recharge", 1000.0);
  initialEnergy      = prefs.getFloat("initial", 0.0);
  lockedBilledCost   = prefs.getFloat("lockCost", 0.0);
  lockedBilledEnergy = prefs.getFloat("lockEnergy", 0.0);

  // Connect to WiFi
  bool connected = connectWiFi();
  if (connected) {
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
    showIPScreen();
    delay(8000);
  } else {
    showOfflineScreen();
    delay(2000);
  }

  // Launch Local Read-Only Web Server
  startWebServer();

  // Initial PZEM read & first display render
  readPZEM();
  currentScreen = 0;
  drawCurrentScreen();

  lastScreenChange = millis();
  lastWiFiAttempt  = millis();
}

// ============================================================
// MAIN LOOP
// ============================================================
void loop() {
  // 1. Handle local browser client requests
  server.handleClient();

  // 2. Maintain Wi-Fi connectivity
  checkWiFi();

  // 3. Periodic PZEM Sensor Read (Every 1s)
  if (millis() - lastPzemUpdate >= PZEM_INTERVAL) {
    lastPzemUpdate = millis();
    readPZEM();
  }

  // 4. Periodic Cloud Telemetry Sync to Render (Hourly or Configured Interval)
  sendTelemetryToCloud();

  // 5. Periodic TFT Screen Updates & Transitions
  updateTFTScreen();

  // 6. Periodically Persist Settings (Every 30s)
  if (millis() - lastSettingsSave >= SETTINGS_SAVE_INTERVAL) {
    lastSettingsSave = millis();
    prefs.putFloat("price", unitPrice);
    prefs.putFloat("recharge", rechargeAmount);
  }

  delay(5);
}
