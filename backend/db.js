const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// PostgreSQL connection config
// Render provides DATABASE_URL like: postgres://user:pass@host/dbname
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' || (connectionString && !connectionString.includes('localhost'))
    ? { rejectUnauthorized: false }
    : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Auto-initialize tables and seed default admin and device
async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('Connecting to PostgreSQL database...');

    // 1. Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS devices (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL DEFAULT 'Smart Power Meter',
        api_key VARCHAR(100) NOT NULL,
        assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        unit_price NUMERIC(8,2) DEFAULT 8.50,
        allowed_units NUMERIC(10,3) DEFAULT 100.00,
        is_active BOOLEAN DEFAULT true,
        last_seen TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS telemetry (
        id BIGSERIAL PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        voltage NUMERIC(6,2) NOT NULL,
        current NUMERIC(7,3) NOT NULL,
        power NUMERIC(8,2) NOT NULL,
        pf NUMERIC(4,2) NOT NULL,
        energy NUMERIC(12,4) NOT NULL,
        cost NUMERIC(10,2) NOT NULL,
        is_load_on BOOLEAN DEFAULT false,
        recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry(device_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(assigned_user_id);
    `);

    // 2. Check if default Admin exists; if not, create one
    const adminCheck = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (adminCheck.rows.length === 0) {
      const defaultAdminPass = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
      const defaultAdminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'admin@energymeter.com';
      const hash = await bcrypt.hash(defaultAdminPass, 10);
      
      const adminRes = await client.query(
        `INSERT INTO users (username, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         RETURNING id`,
        ['admin', defaultAdminEmail, hash]
      );
      console.log(`[DB] Created default admin account: ${defaultAdminEmail} / ${defaultAdminPass}`);

      // Create a demo consumer user
      const userHash = await bcrypt.hash('user123', 10);
      const userRes = await client.query(
        `INSERT INTO users (username, email, password_hash, role)
         VALUES ($1, $2, $3, 'user')
         RETURNING id`,
        ['praveen', 'praveen@energymeter.com', userHash]
      );

      // Create a default meter assigned to consumer user
      await client.query(
        `INSERT INTO devices (id, name, api_key, assigned_user_id, unit_price, allowed_units)
         VALUES ($1, $2, $3, $4, 8.50, 100.0)
         ON CONFLICT (id) DO NOTHING`,
        ['ESP32_METER_01', 'Living Room PZEM Meter', 'meter_secret_key_123', userRes.rows[0].id]
      );
      console.log('[DB] Created default device: ESP32_METER_01 with API Key: meter_secret_key_123');
    }

    console.log('[DB] PostgreSQL schema initialized successfully.');
  } catch (err) {
    console.error('[DB] Error initializing database tables:', err);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDatabase,
  query: (text, params) => pool.query(text, params),
};
