# ESP32 Smart Energy Meter — Flashing, Wi-Fi & Calibration Guide

This guide explains how to configure, calibrate, and upload the Arduino firmware (`esp32_firmware/esp32_firmware.ino`) to your ESP32 microcontroller so it connects to your local Wi-Fi, reads from the PZEM-004T power transducer, applies your calibration factor (**Correction Num**), and synchronizes hourly with the Render Cloud backend.

---

## 1. Hardware Pin Connections

Connect the **ESP32-WROOM-32** to the **PZEM-004T v3.0** and **ST7789 TFT Display (320x240)** as follows:

### PZEM-004T v3.0 Connections (Hardware Serial2)
| PZEM-004T Pin | ESP32 Pin | Notes |
| :--- | :--- | :--- |
| **5V / VCC** | **VIN (5V)** | Powers the optical isolation circuitry |
| **GND** | **GND** | Ground reference |
| **RX** | **GPIO 21 (PZEM_TX)** | Transmit data from ESP32 to PZEM |
| **TX** | **GPIO 34 (PZEM_RX)** | Receive telemetry data from PZEM |

> [!IMPORTANT]
> The PZEM-004T high-voltage side connects to AC Mains (80–260V) through the **Current Transformer (CT)**. Ensure the line wire passes through the center hole of the CT coil.

---

## 2. Setting Up Local Wi-Fi Credentials

Open [`esp32_firmware/esp32_firmware.ino`](file:///c:/Users/SAI%20PRAVEEN/Downloads/fi/esp32_firmware/esp32_firmware.ino) in the **Arduino IDE**.

Locate lines 30–35 and enter your local Wi-Fi network name and password:

```cpp
// ============================================================
// WIFI CONFIGURATION
// ============================================================
const char* WIFI_SSID = "Your_WiFi_Name";        // Replace with your local Wi-Fi SSID
const char* WIFI_PASS = "Your_WiFi_Password";    // Replace with your local Wi-Fi password
```

### How the ESP32 Gets Its Local IP Address
1. When powered on, the ESP32 connects to your local Wi-Fi in Station Mode (`WIFI_STA`).
2. The router assigns a local IP address (e.g., `192.168.1.45`).
3. The IP address is immediately printed to:
   - The **TFT Display** during boot on the "WIFI CONNECTED" screen.
   - The **Arduino Serial Monitor** (`115200 baud`):
     ```text
     WiFi connected. IP: 192.168.1.45
     ```
4. You can also open `http://<ESP32_IP>/api` on any phone or laptop connected to the same Wi-Fi to view raw local telemetry without internet.

---

## 3. How to Calculate and Set the "Correction Num"

The **Correction Number** (`CORRECTION_NUM`) is a software calibration factor that compensates for manufacturing variations in the Current Transformer (CT coil) or resistor tolerances.

### Calibration Formula
$$\text{CORRECTION\_NUM} = \frac{\text{Actual Multimeter Reading}}{\text{PZEM Raw Reading}}$$

### Example:
1. Connect a digital multimeter across your AC line. It measures **230.0 V**.
2. Look at the ESP32 TFT screen or Serial Monitor. The raw PZEM reading shows **225.0 V**.
3. Calculate the correction factor:
   $$\text{CORRECTION\_NUM} = \frac{230.0}{225.0} = 1.0222$$

In [`esp32_firmware.ino`](file:///c:/Users/SAI%20PRAVEEN/Downloads/fi/esp32_firmware/esp32_firmware.ino), update line 26:
```cpp
// CORRECTION NUMBER (Calibration Multiplier for PZEM-004T / CT sensor)
float CORRECTION_NUM = 1.0222; // Enter your calculated correction factor here
```

> [!TIP]
> The ESP32 sends this `correctionNum` in its JSON payload so the Render cloud backend also stores and synchronizes the calibrated measurements.

---

## 4. Hourly Transmission Cycle vs. Fast Debug Sync

To minimize network data usage and reduce database load, the firmware defaults to **Hourly Upload Mode** (`1 hour = 3600000 ms`):

```cpp
// Hourly Sync: sends 1 consolidated report every 60 minutes
#define HOURLY_SYNC_MODE true
const unsigned long CLOUD_SYNC_INTERVAL = HOURLY_SYNC_MODE ? 3600000UL : 15000UL;
```

* **When `HOURLY_SYNC_MODE` is `true`:** The ESP32 continuously updates local LCD readings every second, but only makes **1 HTTP request per hour** to the cloud backend.
* **When `HOURLY_SYNC_MODE` is `false`:** The ESP32 sends telemetry every **15 seconds** (ideal for testing and initial demonstration).

---

## 5. Arduino IDE Setup & Required Libraries

### 1. Board Installation
1. Go to **File $\rightarrow$ Preferences**.
2. Add the ESP32 Board URL into "Additional Board Manager URLs":
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Go to **Tools $\rightarrow$ Board $\rightarrow$ Boards Manager**, search for **ESP32** by Espressif, and click **Install**.
4. Under **Tools $\rightarrow$ Board**, select **ESP32 Dev Module** (or **NodeMCU-32S**).

### 2. Libraries to Install (via Tools $\rightarrow$ Manage Libraries):
* **PZEM004Tv30** by *Jakub Mandula*
* **TFT_eSPI** by *Bodmer*

### 3. Upload Settings
* **Port:** Select your ESP32 COM port (e.g. `COM3` / `COM4`).
* **Upload Speed:** `921600` (or `115200` if upload fails).
* **Flash Frequency:** `80MHz`.
* **Upload:** Click the **Upload ($\rightarrow$)** button in Arduino IDE. Press and hold the **BOOT** button on the ESP32 if the terminal displays `Connecting......`.

---

## 6. Serial Monitor Verification

Open **Tools $\rightarrow$ Serial Monitor** and set the baud rate to **115200**. You should see:

```text
Connecting WiFi: Your_WiFi_Name
WiFi connected. IP: 192.168.1.45
[PZEM] Voltage: 230.1 V | Current: 1.25 A | Power: 287.6 W | Energy: 0.045 kWh
[Cloud] Telemetry synchronized with Render: https://energy-backend-gwex.onrender.com/api/device/telemetry
[Cloud] Response: {"success":true,"deviceId":"ESP32_METER_01","unitPrice":8.5,"allowedUnits":100}
```
