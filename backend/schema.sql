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
    recharge_amount NUMERIC(10,2) DEFAULT 1000.00, -- Prepaid funds credited
    locked_billed_cost NUMERIC(10,2) DEFAULT 0.00, -- Locked cost from previous tariffs
    locked_billed_energy NUMERIC(12,4) DEFAULT 0.00, -- Locked kWh from previous tariffs
    overdue_amount NUMERIC(10,2) DEFAULT 0.00,
    paid_amount NUMERIC(10,2) DEFAULT 0.00,
    needs_reset BOOLEAN DEFAULT false, -- Set by Admin to wipe meter
    local_ip VARCHAR(50), -- Local IP address reported by ESP32 (e.g. 192.168.1.105)
    is_active BOOLEAN DEFAULT true,
    last_seen TIMESTAMP WITH TIME ZONE,
    last_online_at TIMESTAMP WITH TIME ZONE,
    last_offline_at TIMESTAMP WITH TIME ZONE,
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

-- 4. Load Sessions Table (Per-session load consumption & cost)
CREATE TABLE IF NOT EXISTS load_sessions (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    stop_time TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER DEFAULT 0,
    peak_power NUMERIC(8,2) DEFAULT 0.00,
    energy_kwh NUMERIC(10,4) DEFAULT 0.00,
    session_cost NUMERIC(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Billing & Tariff Audit Records Table
CREATE TABLE IF NOT EXISTS billing_records (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    overdue_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    unit_price_applied NUMERIC(8,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Online / Offline Status Transition Logs Table
CREATE TABLE IF NOT EXISTS device_status_logs (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL, -- 'ONLINE' or 'OFFLINE'
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning fast queries
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry(device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_load_sessions_device ON load_sessions(device_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_billing_device ON billing_records(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_logs_device ON device_status_logs(device_id, timestamp DESC);
