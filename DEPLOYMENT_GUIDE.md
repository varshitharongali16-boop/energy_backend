# 🚀 Cloud Deployment Guide: ESP32 + PostgreSQL + Render + Vercel

This repository contains the complete full-stack architecture to connect your ESP32 PZEM-004T power meter to a **PostgreSQL database**, deploy the backend on **Render**, deploy the frontend on **Vercel**, and connect your **custom domain** with multi-user and administrator authentication.

---

## 📁 Project Structure

```
fi/
├── backend/
│   ├── server.js          # Express REST API (Auth, Device Ingestion, Meter analytics)
│   ├── db.js              # PostgreSQL connection pool & auto table creator
│   ├── schema.sql         # Database schema (users, devices, telemetry)
│   ├── package.json       # Node.js dependencies
│   └── .env.example       # Example environment variables
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Login.jsx          # Login component with credentials & URL switcher
│   │   │   ├── Dashboard.jsx      # Real-time consumer monitor & quota manager
│   │   │   ├── AdminPortal.jsx    # Fleet & user management
│   │   │   ├── Gauge.jsx          # Animated SVG Speedometer arc
│   │   │   └── HistoryChart.jsx   # Interactive Chart.js time-series analytics
│   │   ├── api.js                 # API client with JWT token management
│   │   ├── App.jsx                # Root view router
│   │   └── index.css              # Obsidian glassmorphic design system
│   ├── package.json               # React, Lucide, Chart.js dependencies
│   ├── vite.config.js             # Vite bundler config
│   └── vercel.json                # Vercel deployment configuration
├── esp32_firmware/
│   └── esp32_firmware.ino         # ESP32 Arduino code syncing telemetry to Render
└── DEPLOYMENT_GUIDE.md
```

---

## Step 1: Create PostgreSQL Database on Render

1. Go to [Render Dashboard](https://dashboard.render.com/) and sign in.
2. Click **New +** > **PostgreSQL**.
3. Choose a Name: `energy-db`
4. Leave Region and Database name as default.
5. Select the **Free** instance tier and click **Create Database**.
6. Once provisioned, copy the **Internal Database URL** (or **External Database URL**).
   - Format: `postgres://user:password@dpg-xxxx.render.com/dbname`

---

## Step 2: Deploy Unified Full-Stack Application on Render

Because the React frontend and Node.js backend are unified into a single project, you can deploy everything under **1 single Render Web Service**:

1. Push your entire project folder (`fi/`) to a GitHub repository.
2. In [Render Dashboard](https://dashboard.render.com/), click on your existing Web Service (or create **New +** > **Web Service**).
3. Settings:
   - **Root Directory**: (Leave blank to use root `./`)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment Variables**:
     - `DATABASE_URL`: *(Your PostgreSQL URL)*
     - `JWT_SECRET`: `your_strong_secret_key`
     - `ADMIN_DEFAULT_EMAIL`: `admin@energymeter.com`
     - `ADMIN_DEFAULT_PASSWORD`: `admin123`
     - `NODE_ENV`: `production`
4. Click **Deploy**.
5. Once built, open your Render URL in your browser:
   `https://energy-backend-gwex.onrender.com`
   - The **React Dashboard** will open immediately!
   - All `/api/...` REST endpoints run on the same URL!
   - You can connect your custom domain directly to this single Render service!


---

## Step 4: Configure & Flash the ESP32

1. Open `esp32_firmware/esp32_firmware.ino` in Arduino IDE.
2. Update the cloud endpoint with your Render backend URL:
   ```cpp
   const char* CLOUD_API_URL = "https://energy-backend-gwex.onrender.com/api/device/telemetry";
   const char* DEVICE_ID     = "ESP32_METER_01";
   const char* DEVICE_API_KEY = "meter_secret_key_123";
   ```
3. Verify WiFi credentials:
   ```cpp
   const char* WIFI_SSID = "Nothing Phone (3a)_2505";
   const char* WIFI_PASS = "praveen DSP";
   ```
4. Flash the code to your ESP32.
5. Once connected, your ESP32 will:
   - Display real-time data on the TFT screen.
   - Transmit telemetry every 5 seconds to your PostgreSQL database.
   - Sync tariff and quota changes made from your website.

---

## Step 5: Log In and Test

Open your website in any browser:

### 1. Default Credentials:
- **System Administrator**:
  - Email: `admin@energymeter.com`
  - Password: `admin123`
  - *Has full access to register new meters, create users, and inspect all telemetry.*

- **Consumer User**:
  - Email: `praveen@energymeter.com`
  - Password: `user123`
  - *Has access to their assigned meter (`ESP32_METER_01`), live speed gauge, quota balance, and historical Chart.js graphs.*
