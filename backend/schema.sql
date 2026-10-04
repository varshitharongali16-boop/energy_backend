-- ============================================================
-- SMART ENERGY METER - POSTGRESQL DATABASE SCHEMA
-- ============================================================

-- 1. Users Table (Admin & Meter Consumers)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user', -- 'admin' or 'user'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Devices Table (ESP32 Meters registered in the system)
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(50) PRIMARY KEY, -- e.g. "ESP32_METER_01"
    name VARCHAR(100) NOT NULL DEFAULT 'Smart Power Meter',
    api_key VARCHAR(100) NOT NULL, -- Device secret used by ESP32 to authenticate
    assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    unit_price NUMERIC(8,2) DEFAULT 8.50,
    allowed_units NUMERIC(10,3) DEFAULT 100.00,
    is_active BOOLEAN DEFAULT true,
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Telemetry Table (Time-Series Energy Data from ESP32)
CREATE TABLE IF NOT EXISTS telemetry (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    voltage NUMERIC(6,2) NOT NULL,
    current NUMERIC(7,3) NOT NULL,
    power NUMERIC(8,2) NOT NULL,
    pf NUMERIC(4,2) NOT NULL,
    energy NUMERIC(12,4) NOT NULL, -- Total accumulated kWh
    cost NUMERIC(10,2) NOT NULL,
    is_load_on BOOLEAN DEFAULT false,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning fast queries on dashboard charts
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry(device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(assigned_user_id);
