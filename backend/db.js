const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
let isUsingMemoryDb = false;

// In-Memory Database store for local development / testing without live PostgreSQL
const memDb = {
  users: [],
  devices: [],
  telemetry: [],
  billing_records: [],
  device_status_logs: [],
  load_sessions: [],
  recharge_transactions: []
};

let pool = null;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' || !connectionString.includes('localhost')
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 3500
  });

  pool.on('error', (err) => {
    console.warn('[DB] PostgreSQL pool background notice:', err.message);
  });
}

// Seed in-memory data
async function seedMemoryDatabase() {
  const pwdHash = await bcrypt.hash('123', 10);

  memDb.users = [
    {
      id: 1,
      username: 'admin',
      email: 'admin@energymeter.com',
      password_hash: pwdHash,
      role: 'admin',
      created_at: new Date('2026-09-01T10:00:00Z')
    },
    {
      id: 2,
      username: 'praveen',
      email: 'praveen@energymeter.com',
      password_hash: pwdHash,
      role: 'user',
      created_at: new Date('2026-09-05T12:00:00Z')
    }
  ];

  memDb.devices = [
    {
      id: 'ESP32_METER_01',
      name: 'Living Room PZEM Meter',
      api_key: 'meter_secret_key_123',
      assigned_user_id: 2,
      unit_price: 12.00,
      allowed_units: 100.0,
      recharge_amount: 1000.00,
      overdue_amount: 0.00,
      paid_amount: 0.00,
      locked_billed_cost: 0.00,
      locked_billed_energy: 0.00,
      needs_reset: false,
      local_ip: '192.168.1.150',
      is_active: true,
      last_seen: new Date(),
      last_online_at: new Date(),
      last_offline_at: null,
      created_at: new Date('2026-09-05T12:30:00Z')
    }
  ];

  // Seed sample telemetry entries
  const baseTime = Date.now() - 3600 * 1000;
  for (let i = 0; i < 20; i++) {
    const t = new Date(baseTime + i * 180000);
    const power = 110 + (i % 5) * 2.5;
    const energy = 0.120 + i * 0.006;
    const cost = energy * 12.00;
    memDb.telemetry.push({
      id: i + 1,
      device_id: 'ESP32_METER_01',
      voltage: 231.4,
      current: 0.51,
      power: power,
      pf: 0.98,
      energy: energy,
      cost: cost,
      is_load_on: true,
      recorded_at: t
    });
  }

  // Seed status logs
  memDb.device_status_logs = [
    { id: 1, device_id: 'ESP32_METER_01', status: 'ONLINE', timestamp: new Date(Date.now() - 7200000) }
  ];

  // Seed load session
  memDb.load_sessions = [
    {
      id: 1,
      device_id: 'ESP32_METER_01',
      start_time: new Date(Date.now() - 3600000),
      stop_time: null,
      duration_seconds: 3600,
      peak_power: 116.3,
      energy_kwh: 0.116,
      session_cost: 1.39,
      created_at: new Date(Date.now() - 3600000)
    }
  ];

  // Seed initial recharge transactions
  memDb.recharge_transactions = [
    {
      id: 1,
      device_id: 'ESP32_METER_01',
      user_id: 2,
      amount: 1000.00,
      payment_id: 'pay_init_demo_01',
      order_id: 'order_init_01',
      payment_method: 'RAZORPAY_CHECKOUT',
      status: 'SUCCESS',
      previous_balance: 0.00,
      new_balance: 1000.00,
      created_at: new Date(Date.now() - 86400000)
    }
  ];

  console.log('[DB] In-memory database initialized with seeded users: "admin" (123) and "praveen" (123).');
}

// In-Memory Query Router
async function executeMemoryQuery(text, params = []) {
  const q = text.trim();
  const lower = q.toLowerCase();

  // 1. Version / time / overview stats
  if (lower.includes('select version()')) {
    return { rows: [{ version: 'PostgreSQL 16 (In-Memory Emulation)' }] };
  }
  if (lower.includes('select now()')) {
    return { rows: [{ db_time: new Date() }] };
  }
  if (lower.includes('select count(*) as count from users')) {
    return { rows: [{ count: memDb.users.length }] };
  }
  if (lower.includes('select count(*) as count from devices')) {
    return { rows: [{ count: memDb.devices.length }] };
  }
  if (lower.includes('select count(*) as count, min(recorded_at) as first_log')) {
    const first = memDb.telemetry.length > 0 ? memDb.telemetry[0].recorded_at : null;
    const last = memDb.telemetry.length > 0 ? memDb.telemetry[memDb.telemetry.length - 1].recorded_at : null;
    return { rows: [{ count: memDb.telemetry.length, first_log: first, last_log: last }] };
  }

  // 2. Users Table Queries
  if (lower.startsWith('select') && lower.includes('from users')) {
    if (lower.includes('where') && (lower.includes('username') || lower.includes('email'))) {
      const paramVal = (params[0] || '').toString().toLowerCase().trim();
      const user = memDb.users.find(u =>
        u.username.toLowerCase() === paramVal || u.email.toLowerCase() === paramVal
      );
      return { rows: user ? [user] : [] };
    }
    if (lower.includes('where id =')) {
      const idVal = parseInt(params[0]);
      const user = memDb.users.find(u => u.id === idVal);
      return { rows: user ? [user] : [] };
    }
    // List all users
    const userList = memDb.users.map(u => ({
      ...u,
      meter_count: memDb.devices.filter(d => d.assigned_user_id === u.id).length
    }));
    return { rows: userList };
  }

  if (lower.startsWith('insert into users')) {
    const newId = memDb.users.length > 0 ? Math.max(...memDb.users.map(u => u.id)) + 1 : 1;
    const newUser = {
      id: newId,
      username: params[0],
      email: params[1],
      password_hash: params[2],
      role: params[3] || 'user',
      created_at: new Date()
    };
    memDb.users.push(newUser);
    return { rows: [newUser] };
  }

  if (lower.startsWith('update users')) {
    const targetId = parseInt(params[params.length - 1]);
    const user = memDb.users.find(u => u.id === targetId);
    if (user) {
      if (params[0]) user.username = params[0];
      if (params[1]) user.email = params[1];
      if (params[2] && params[2].startsWith('$2')) user.password_hash = params[2];
      if (params[3]) user.role = params[3];
      return { rows: [user] };
    }
    return { rows: [] };
  }

  if (lower.startsWith('delete from users')) {
    const idVal = parseInt(params[0]);
    memDb.users = memDb.users.filter(u => u.id !== idVal);
    return { rows: [] };
  }

  // 3. Devices Table Queries
  if (lower.startsWith('select') && lower.includes('from devices')) {
    if (lower.includes('where d.id =') || lower.includes('where id =')) {
      const devId = params[0];
      const d = memDb.devices.find(x => x.id === devId);
      if (!d) return { rows: [] };
      const assignedUser = memDb.users.find(u => u.id === d.assigned_user_id);
      return {
        rows: [{
          ...d,
          assigned_username: assignedUser ? assignedUser.username : null,
          assigned_email: assignedUser ? assignedUser.email : null
        }]
      };
    }
    if (lower.includes('where assigned_user_id =') || lower.includes('where d.assigned_user_id =')) {
      const uid = parseInt(params[0]);
      const list = memDb.devices.filter(d => d.assigned_user_id === uid);
      return { rows: list };
    }
    // List all devices with user joins
    const allDevs = memDb.devices.map(d => {
      const assignedUser = memDb.users.find(u => u.id === d.assigned_user_id);
      return {
        ...d,
        assigned_username: assignedUser ? assignedUser.username : null,
        assigned_email: assignedUser ? assignedUser.email : null
      };
    });
    return { rows: allDevs };
  }

  if (lower.startsWith('update devices')) {
    // Determine device ID from query params or where clause
    let devId = null;
    let targetDev = null;

    if (lower.includes('where id =')) {
      devId = params[params.length - 1];
      targetDev = memDb.devices.find(d => d.id === devId);
    }

    if (targetDev) {
      if (lower.includes('recharge_amount =')) {
        // e.g. top-up or recharge update
        if (typeof params[0] === 'number') targetDev.recharge_amount = params[0];
        if (typeof params[1] === 'number') targetDev.overdue_amount = params[1];
      }
      if (lower.includes('unit_price =')) {
        targetDev.unit_price = params[0];
      }
      if (lower.includes('last_seen =')) {
        targetDev.last_seen = new Date();
      }
      return { rows: [targetDev] };
    }
    return { rows: [] };
  }

  if (lower.startsWith('insert into devices')) {
    const newDev = {
      id: params[0],
      name: params[1] || 'Smart Meter',
      api_key: params[2],
      assigned_user_id: params[3] ? parseInt(params[3]) : null,
      unit_price: parseFloat(params[4] || 8.50),
      allowed_units: 100.0,
      recharge_amount: parseFloat(params[5] || 1000.00),
      overdue_amount: 0.00,
      paid_amount: 0.00,
      locked_billed_cost: 0.00,
      locked_billed_energy: 0.00,
      needs_reset: false,
      is_active: true,
      last_seen: new Date(),
      created_at: new Date()
    };
    memDb.devices.push(newDev);
    return { rows: [newDev] };
  }

  if (lower.startsWith('delete from devices')) {
    const devId = params[0];
    memDb.devices = memDb.devices.filter(d => d.id !== devId);
    return { rows: [] };
  }

  // 4. Telemetry Queries
  if (lower.startsWith('select') && lower.includes('from telemetry')) {
    let result = [...memDb.telemetry];
    if (lower.includes('where device_id =')) {
      const devId = params[0];
      result = result.filter(t => t.device_id === devId);
    }
    if (lower.includes('order by recorded_at desc') || lower.includes('order by t.recorded_at desc')) {
      result.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
    }
    if (lower.includes('limit 1')) {
      return { rows: result.slice(0, 1) };
    }
    if (lower.includes('limit $1') || lower.includes('limit $2')) {
      const lim = parseInt(params[params.length - 1]) || 50;
      return { rows: result.slice(0, lim) };
    }
    return { rows: result };
  }

  if (lower.startsWith('insert into telemetry')) {
    const newTel = {
      id: memDb.telemetry.length + 1,
      device_id: params[0],
      voltage: params[1],
      current: params[2],
      power: params[3],
      pf: params[4],
      energy: params[5],
      cost: params[6],
      is_load_on: params[7],
      recorded_at: new Date()
    };
    memDb.telemetry.push(newTel);
    return { rows: [newTel] };
  }

  // 5. Recharge Transactions
  if (lower.startsWith('select') && lower.includes('from recharge_transactions')) {
    let txs = [...memDb.recharge_transactions];
    if (lower.includes('where device_id =') || lower.includes('where rt.device_id =')) {
      const devId = params[0];
      txs = txs.filter(t => t.device_id === devId);
    }
    txs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: txs };
  }

  if (lower.startsWith('insert into recharge_transactions')) {
    const newTx = {
      id: memDb.recharge_transactions.length + 1,
      device_id: params[0],
      user_id: params[1],
      amount: params[2],
      payment_id: params[3],
      order_id: params[4],
      payment_method: params[5],
      status: params[6],
      previous_balance: params[7],
      new_balance: params[8],
      created_at: new Date()
    };
    memDb.recharge_transactions.push(newTx);
    return { rows: [newTx] };
  }

  // 6. Billing Records
  if (lower.startsWith('select') && lower.includes('from billing_records')) {
    let records = [...memDb.billing_records];
    if (lower.includes('where device_id =')) {
      records = records.filter(b => b.device_id === params[0]);
    }
    records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: records };
  }

  if (lower.startsWith('insert into billing_records')) {
    const newB = {
      id: memDb.billing_records.length + 1,
      device_id: params[0],
      overdue_amount: params[1],
      paid_amount: params[2],
      unit_price_applied: params[3],
      notes: params[4],
      created_at: new Date()
    };
    memDb.billing_records.push(newB);
    return { rows: [newB] };
  }

  // 7. Device Status Logs
  if (lower.startsWith('select') && lower.includes('from device_status_logs')) {
    let logs = [...memDb.device_status_logs];
    if (lower.includes('where device_id =')) {
      logs = logs.filter(l => l.device_id === params[0]);
    }
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { rows: logs };
  }

  if (lower.startsWith('insert into device_status_logs')) {
    const newLog = {
      id: memDb.device_status_logs.length + 1,
      device_id: params[0],
      status: params[1],
      timestamp: new Date()
    };
    memDb.device_status_logs.push(newLog);
    return { rows: [newLog] };
  }

  // 8. Load Sessions
  if (lower.startsWith('select') && lower.includes('from load_sessions')) {
    let sessions = [...memDb.load_sessions];
    if (lower.includes('where device_id =')) {
      sessions = sessions.filter(s => s.device_id === params[0]);
    }
    sessions.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    return { rows: sessions };
  }

  return { rows: [] };
}

// Auto-initialize tables and seed default admin and device
async function initDatabase() {
  if (!pool) {
    console.log('[DB] No DATABASE_URL specified. Initializing in-memory PostgreSQL engine.');
    isUsingMemoryDb = true;
    await seedMemoryDatabase();
    return;
  }

  try {
    console.log('[DB] Attempting connection to PostgreSQL database...');
    const client = await pool.connect();
    try {
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

        CREATE TABLE IF NOT EXISTS billing_records (
          id SERIAL PRIMARY KEY,
          device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          overdue_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
          paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
          unit_price_applied NUMERIC(8,2) NOT NULL,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS device_status_logs (
          id SERIAL PRIMARY KEY,
          device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          status VARCHAR(20) NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

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

        CREATE TABLE IF NOT EXISTS recharge_transactions (
          id SERIAL PRIMARY KEY,
          device_id VARCHAR(50) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          amount NUMERIC(10,2) NOT NULL,
          payment_id VARCHAR(100),
          order_id VARCHAR(100),
          payment_method VARCHAR(50) DEFAULT 'RAZORPAY',
          status VARCHAR(20) DEFAULT 'SUCCESS',
          previous_balance NUMERIC(10,2) DEFAULT 0.00,
          new_balance NUMERIC(10,2) DEFAULT 0.00,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE devices ADD COLUMN IF NOT EXISTS overdue_amount NUMERIC(10,2) DEFAULT 0.00;
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(10,2) DEFAULT 0.00;
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS recharge_amount NUMERIC(10,2) DEFAULT 1000.00;
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS locked_billed_cost NUMERIC(10,2) DEFAULT 0.00;
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS locked_billed_energy NUMERIC(12,4) DEFAULT 0.00;
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS needs_reset BOOLEAN DEFAULT false;
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS local_ip VARCHAR(50);
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_offline_at TIMESTAMP WITH TIME ZONE;

        CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry(device_id, recorded_at DESC);
        CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(assigned_user_id);
        CREATE INDEX IF NOT EXISTS idx_billing_device ON billing_records(device_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_status_logs_device ON device_status_logs(device_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_load_sessions_device ON load_sessions(device_id, start_time DESC);
        CREATE INDEX IF NOT EXISTS idx_recharge_device ON recharge_transactions(device_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_recharge_user ON recharge_transactions(user_id, created_at DESC);
      `);

      // Seed default accounts
      const pwd123Hash = await bcrypt.hash('123', 10);

      const adminCheck = await client.query("SELECT id FROM users WHERE username = 'admin' OR role = 'admin' LIMIT 1");
      if (adminCheck.rows.length === 0) {
        await client.query(
          `INSERT INTO users (username, email, password_hash, role)
           VALUES ($1, $2, $3, 'admin')`,
          ['admin', 'admin@energymeter.com', pwd123Hash]
        );
        console.log('[DB] Created admin account: admin / 123');
      } else {
        await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [pwd123Hash, adminCheck.rows[0].id]);
      }

      const praveenCheck = await client.query("SELECT id FROM users WHERE username = 'praveen' LIMIT 1");
      let praveenId;
      if (praveenCheck.rows.length === 0) {
        const pRes = await client.query(
          `INSERT INTO users (username, email, password_hash, role)
           VALUES ($1, $2, $3, 'user')
           RETURNING id`,
          ['praveen', 'praveen@energymeter.com', pwd123Hash]
        );
        praveenId = pRes.rows[0].id;
        console.log('[DB] Created consumer user: praveen / 123');
      } else {
        praveenId = praveenCheck.rows[0].id;
        await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [pwd123Hash, praveenId]);
      }

      await client.query(
        `INSERT INTO devices (id, name, api_key, assigned_user_id, unit_price, allowed_units, recharge_amount)
         VALUES ($1, $2, $3, $4, 12.00, 100.0, 1000.0)
         ON CONFLICT (id) DO UPDATE SET assigned_user_id = COALESCE(devices.assigned_user_id, EXCLUDED.assigned_user_id)`,
        ['ESP32_METER_01', 'Living Room PZEM Meter', 'meter_secret_key_123', praveenId]
      );

      console.log('[DB] Live PostgreSQL schema and seed initialized successfully.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[DB] Live PostgreSQL unavailable (' + err.message + '). Switching to in-memory PostgreSQL engine.');
    isUsingMemoryDb = true;
    await seedMemoryDatabase();
  }
}

module.exports = {
  pool,
  initDatabase,
  query: async (text, params) => {
    if (isUsingMemoryDb || !pool) {
      return executeMemoryQuery(text, params);
    }
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.warn('[DB] Live query failed, falling back to memory db:', err.message);
      return executeMemoryQuery(text, params);
    }
  }
};
