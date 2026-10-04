const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_energy_jwt_key_2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ============================================================
// AUTH MIDDLEWARES
// ============================================================
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = decoded;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin privileges required' });
  }
}

// Device Auth Middleware for ESP32
async function verifyDevice(req, res, next) {
  const deviceId = req.headers['x-device-id'] || req.body.deviceId;
  const apiKey = req.headers['x-api-key'] || req.body.apiKey;

  if (!deviceId || !apiKey) {
    return res.status(401).json({ error: 'Device ID and API Key required' });
  }

  try {
    const result = await db.query(
      'SELECT * FROM devices WHERE id = $1 AND api_key = $2 AND is_active = true',
      [deviceId, apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized or inactive device' });
    }

    req.device = result.rows[0];
    next();
  } catch (err) {
    console.error('Device auth error:', err);
    res.status(500).json({ error: 'Device validation failure' });
  }
}

// ============================================================
// API STATUS / HEALTH CHECK
// ============================================================
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    system: 'ESP32 Energy Monitor Cloud API',
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// ESP32 INGESTION ENDPOINT (Called by ESP32 via HTTPS POST)
// ============================================================
app.post('/api/device/telemetry', verifyDevice, async (req, res) => {
  const { voltage, current, power, pf, energy, cost, isLoadOn, correctionNum } = req.body;

  try {
    const corr = parseFloat(correctionNum) || 1.0;
    const adjVoltage = (parseFloat(voltage) || 0) * corr;
    const adjCurrent = (parseFloat(current) || 0) * corr;
    const adjPower = (parseFloat(power) || 0) * corr;
    const adjEnergy = parseFloat(energy) || 0;
    const adjCost = parseFloat(cost) || 0;

    // Check if device was previously offline (> 35s or null)
    const wasOffline = !req.device.last_seen || (Date.now() - new Date(req.device.last_seen).getTime() > 35000);
    if (wasOffline) {
      await db.query(
        `INSERT INTO device_status_logs (device_id, status, timestamp) VALUES ($1, 'ONLINE', CURRENT_TIMESTAMP)`,
        [req.device.id]
      );
      await db.query(
        `UPDATE devices SET last_online_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.device.id]
      );
    }

    // 1. Insert telemetry reading into PostgreSQL
    await db.query(
      `INSERT INTO telemetry (device_id, voltage, current, power, pf, energy, cost, is_load_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.device.id,
        adjVoltage,
        adjCurrent,
        adjPower,
        parseFloat(pf) || 0,
        adjEnergy,
        adjCost,
        Boolean(isLoadOn)
      ]
    );

    // 2. Update device last_seen timestamp
    await db.query(
      'UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = $1',
      [req.device.id]
    );

    // 3. Return latest cloud device settings so ESP32 can synchronize unit price & allowed units
    res.json({
      success: true,
      deviceId: req.device.id,
      unitPrice: parseFloat(req.device.unit_price),
      allowedUnits: parseFloat(req.device.allowed_units),
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    console.error('Failed to record telemetry:', err);
    res.status(500).json({ error: 'Database record error' });
  }
});

// ============================================================
// AUTHENTICATION ROUTES (Admin & Consumer Users)
// ============================================================
app.post('/api/auth/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password) {
    return res.status(400).json({ error: 'Username/Email and password required' });
  }

  try {
    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1',
      [usernameOrEmail.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal login error' });
  }
});

app.get('/api/auth/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// ============================================================
// METERS & TELEMETRY DASHBOARD ROUTES
// ============================================================

// List meters assigned to logged-in user (or all if admin)
app.get('/api/meters', verifyToken, async (req, res) => {
  try {
    let queryText = '';
    let params = [];

    if (req.user.role === 'admin') {
      queryText = `
        SELECT d.*, u.username as assigned_username, u.email as assigned_email
        FROM devices d
        LEFT JOIN users u ON d.assigned_user_id = u.id
        ORDER BY d.created_at ASC
      `;
    } else {
      queryText = `
        SELECT * FROM devices
        WHERE assigned_user_id = $1
        ORDER BY created_at ASC
      `;
      params = [req.user.id];
    }

    const result = await db.query(queryText, params);
    res.json({ meters: result.rows });
  } catch (err) {
    console.error('Error fetching meters:', err);
    res.status(500).json({ error: 'Failed to retrieve meters' });
  }
});

// Get latest live telemetry for a specific meter
app.get('/api/meters/:id/live', verifyToken, async (req, res) => {
  const deviceId = req.params.id;

  try {
    // 1. Check access permissions
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });

    const device = devQuery.rows[0];
    if (req.user.role !== 'admin' && device.assigned_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to this meter' });
    }

    // 2. Fetch latest telemetry row
    const telQuery = await db.query(
      `SELECT * FROM telemetry WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [deviceId]
    );

    const latest = telQuery.rows[0] || {
      voltage: 0,
      current: 0,
      power: 0,
      pf: 0,
      energy: 0,
      cost: 0,
      is_load_on: false,
      recorded_at: null
    };

    // Calculate balances
    const unitPrice = parseFloat(device.unit_price);
    const allowedUnits = parseFloat(device.allowed_units);
    const usedEnergy = parseFloat(latest.energy);
    const unitsLeft = Math.max(0, allowedUnits - usedEnergy);
    const totalAllowedAmount = allowedUnits * unitPrice;
    const amountRemaining = Math.max(0, totalAllowedAmount - (usedEnergy * unitPrice));

    // Device online status (online if reported within last 25 seconds)
    const isOnline = device.last_seen && (Date.now() - new Date(device.last_seen).getTime() < 25000);

    res.json({
      device: {
        id: device.id,
        name: device.name,
        unitPrice,
        allowedUnits,
        overdueAmount: parseFloat(device.overdue_amount || 0),
        paidAmount: parseFloat(device.paid_amount || 0),
        lastSeen: device.last_seen,
        lastOnlineAt: device.last_online_at,
        lastOfflineAt: device.last_offline_at,
        isOnline
      },
      live: latest,
      analytics: {
        unitsLeft,
        usedEnergy,
        totalAllowedAmount,
        amountRemaining,
        percentRemaining: allowedUnits > 0 ? (unitsLeft / allowedUnits) * 100 : 0
      }
    });
  } catch (err) {
    console.error('Error fetching live data:', err);
    res.status(500).json({ error: 'Error fetching meter status' });
  }
});

// Get historical chart data (24 Hours, 7 Days, or 30 Days)
app.get('/api/meters/:id/history', verifyToken, async (req, res) => {
  const deviceId = req.params.id;
  const range = req.query.range || '24h'; // '24h', '7d', '30d'

  try {
    let intervalStr = '24 hours';
    let sampleCount = 60; // points for chart

    if (range === '7d') {
      intervalStr = '7 days';
      sampleCount = 84;
    } else if (range === '30d') {
      intervalStr = '30 days';
      sampleCount = 90;
    }

    const result = await db.query(
      `SELECT recorded_at, power, voltage, current, energy, cost
       FROM telemetry
       WHERE device_id = $1 AND recorded_at >= NOW() - INTERVAL '${intervalStr}'
       ORDER BY recorded_at ASC
       LIMIT 400`,
      [deviceId]
    );

    res.json({ points: result.rows });
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch history data' });
  }
});

// Update meter quota/price settings
app.put('/api/meters/:id/settings', verifyToken, async (req, res) => {
  const deviceId = req.params.id;
  const { unitPrice, allowedUnits } = req.body;

  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });

    const device = devQuery.rows[0];
    if (req.user.role !== 'admin' && device.assigned_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updated = await db.query(
      `UPDATE devices
       SET unit_price = COALESCE($1, unit_price),
           allowed_units = COALESCE($2, allowed_units)
       WHERE id = $3
       RETURNING *`,
      [unitPrice ? parseFloat(unitPrice) : null, allowedUnits ? parseFloat(allowedUnits) : null, deviceId]
    );

    res.json({ success: true, device: updated.rows[0] });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update device settings' });
  }
});

// ============================================================
// ADMIN CONTROL MANAGEMENT ROUTES
// ============================================================

// List all users
app.get('/api/admin/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.username, u.email, u.role, u.created_at,
              COUNT(d.id) as meter_count
       FROM users u
       LEFT JOIN devices d ON d.assigned_user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create new user (Admin)
app.post('/api/admin/users', verifyToken, requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password required' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role, created_at`,
      [username.trim(), email.trim().toLowerCase(), hash, role === 'admin' ? 'admin' : 'user']
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error('User creation error:', err);
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

// Update user credentials & details (Admin)
app.put('/api/admin/users/:id', verifyToken, requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  const userId = req.params.id;

  try {
    let queryText = '';
    let params = [];

    if (password && password.trim().length > 0) {
      const hash = await bcrypt.hash(password.trim(), 10);
      queryText = `
        UPDATE users
        SET username = COALESCE($1, username),
            email = COALESCE($2, email),
            password_hash = $3,
            role = COALESCE($4, role)
        WHERE id = $5
        RETURNING id, username, email, role, created_at
      `;
      params = [
        username ? username.trim() : null,
        email ? email.trim().toLowerCase() : null,
        hash,
        role || null,
        userId
      ];
    } else {
      queryText = `
        UPDATE users
        SET username = COALESCE($1, username),
            email = COALESCE($2, email),
            role = COALESCE($3, role)
        WHERE id = $4
        RETURNING id, username, email, role, created_at
      `;
      params = [
        username ? username.trim() : null,
        email ? email.trim().toLowerCase() : null,
        role || null,
        userId
      ];
    }

    const result = await db.query(queryText, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('User update error:', err);
    res.status(400).json({ error: 'Failed to update user. Username or email may already be taken.' });
  }
});

// Delete user
app.delete('/api/admin/users/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Reject public student registration
app.post('/api/auth/register', (req, res) => {
  res.status(403).json({
    error: 'Self-registration is disabled. Accounts must be provisioned by the Administrator.'
  });
});

// Database Management: Overview & Health stats (Admin)
app.get('/api/admin/database/overview', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [userCountRes, devCountRes, telCountRes, verRes, timeRes] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM users'),
      db.query('SELECT COUNT(*) as count FROM devices'),
      db.query('SELECT COUNT(*) as count, MIN(recorded_at) as first_log, MAX(recorded_at) as last_log FROM telemetry'),
      db.query('SELECT version()'),
      db.query('SELECT NOW() as db_time')
    ]);

    res.json({
      status: 'Connected',
      version: verRes.rows[0]?.version || 'PostgreSQL',
      dbTime: timeRes.rows[0]?.db_time,
      totalUsers: parseInt(userCountRes.rows[0]?.count || 0),
      totalDevices: parseInt(devCountRes.rows[0]?.count || 0),
      totalTelemetryLogs: parseInt(telCountRes.rows[0]?.count || 0),
      firstLog: telCountRes.rows[0]?.first_log,
      lastLog: telCountRes.rows[0]?.last_log
    });
  } catch (err) {
    console.error('Database overview error:', err);
    res.status(500).json({ error: 'Failed to query database stats' });
  }
});

// Database Management: Inspect raw telemetry records in DB (Admin)
app.get('/api/admin/database/telemetry-logs', verifyToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const result = await db.query(
      `SELECT t.id, t.device_id, d.name as device_name, t.voltage, t.current, t.power, t.pf, t.energy, t.cost, t.is_load_on, t.recorded_at
       FROM telemetry t
       LEFT JOIN devices d ON t.device_id = d.id
       ORDER BY t.recorded_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json({ logs: result.rows });
  } catch (err) {
    console.error('Database telemetry query error:', err);
    res.status(500).json({ error: 'Failed to retrieve telemetry logs' });
  }
});

// Delete device (Admin)
app.delete('/api/admin/devices/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM devices WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// Deep-Dive Meter Inspection & Details (Admin)
app.get('/api/admin/meters/:id/details', verifyToken, requireAdmin, async (req, res) => {
  const deviceId = req.params.id;

  try {
    const devRes = await db.query(
      `SELECT d.*, u.username as assigned_username, u.email as assigned_email
       FROM devices d
       LEFT JOIN users u ON d.assigned_user_id = u.id
       WHERE d.id = $1`,
      [deviceId]
    );

    if (devRes.rows.length === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    const device = devRes.rows[0];
    const isOnline = device.last_seen && (Date.now() - new Date(device.last_seen).getTime() < 35000);

    // If offline and last_offline_at needs updating
    if (!isOnline && device.last_seen) {
      const offlineTime = new Date(new Date(device.last_seen).getTime() + 35000);
      if (!device.last_offline_at || new Date(device.last_offline_at) < new Date(device.last_seen)) {
        await db.query(
          `UPDATE devices SET last_offline_at = $1 WHERE id = $2`,
          [offlineTime, deviceId]
        );
        await db.query(
          `INSERT INTO device_status_logs (device_id, status, timestamp) VALUES ($1, 'OFFLINE', $2)`,
          [deviceId, offlineTime]
        );
        device.last_offline_at = offlineTime;
      }
    }

    // Parallel fetch: latest telemetry, recent 30 logs, billing records, status logs
    const [latestTel, logsRes, billingRes, statusRes] = await Promise.all([
      db.query(`SELECT * FROM telemetry WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [deviceId]),
      db.query(`SELECT * FROM telemetry WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 30`, [deviceId]),
      db.query(`SELECT * FROM billing_records WHERE device_id = $1 ORDER BY created_at DESC LIMIT 15`, [deviceId]),
      db.query(`SELECT * FROM device_status_logs WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 15`, [deviceId])
    ]);

    res.json({
      device: {
        ...device,
        isOnline
      },
      latest: latestTel.rows[0] || null,
      telemetryLogs: logsRes.rows,
      billingRecords: billingRes.rows,
      statusLogs: statusRes.rows
    });
  } catch (err) {
    console.error('Error fetching meter details:', err);
    res.status(500).json({ error: 'Failed to retrieve meter details' });
  }
});

// Assign Overdue / Paid Amounts & Update Tariff Unit Price for next orders (Admin)
app.put('/api/admin/meters/:id/billing', verifyToken, requireAdmin, async (req, res) => {
  const deviceId = req.params.id;
  const { overdueAmount, paidAmount, unitPrice, notes } = req.body;

  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const currentDevice = devQuery.rows[0];
    const newOverdue = overdueAmount !== undefined ? parseFloat(overdueAmount) : parseFloat(currentDevice.overdue_amount || 0);
    const newPaid = paidAmount !== undefined ? parseFloat(paidAmount) : parseFloat(currentDevice.paid_amount || 0);
    const newUnitPrice = unitPrice !== undefined ? parseFloat(unitPrice) : parseFloat(currentDevice.unit_price);

    // 1. Record billing audit record with timestamp (records when tariff / overdue / paid was assigned)
    const billingLogRes = await db.query(
      `INSERT INTO billing_records (device_id, overdue_amount, paid_amount, unit_price_applied, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        deviceId,
        newOverdue,
        newPaid,
        newUnitPrice,
        notes || 'Tariff/Balance assigned by Administrator (applies to subsequent orders)'
      ]
    );

    // 2. Update device parameters
    const updateRes = await db.query(
      `UPDATE devices
       SET overdue_amount = $1,
           paid_amount = $2,
           unit_price = $3
       WHERE id = $4
       RETURNING *`,
      [newOverdue, newPaid, newUnitPrice, deviceId]
    );

    res.json({
      success: true,
      message: 'Billing parameters and new unit price successfully applied for next orders.',
      device: updateRes.rows[0],
      record: billingLogRes.rows[0]
    });
  } catch (err) {
    console.error('Billing update error:', err);
    res.status(500).json({ error: 'Failed to update billing and tariff records' });
  }
});

// Register new device
app.post('/api/admin/devices', verifyToken, requireAdmin, async (req, res) => {
  const { id, name, apiKey, assignedUserId, unitPrice, allowedUnits } = req.body;
  if (!id || !apiKey) {
    return res.status(400).json({ error: 'Device ID and API Key are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO devices (id, name, api_key, assigned_user_id, unit_price, allowed_units)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id.trim(),
        name || 'PZEM Smart Meter',
        apiKey.trim(),
        assignedUserId ? parseInt(assignedUserId) : null,
        unitPrice ? parseFloat(unitPrice) : 8.50,
        allowedUnits ? parseFloat(allowedUnits) : 100.00
      ]
    );

    res.status(201).json({ device: result.rows[0] });
  } catch (err) {
    console.error('Device creation error:', err);
    res.status(400).json({ error: 'Device ID already exists' });
  }
});

// Reassign device
app.put('/api/admin/devices/:id/assign', verifyToken, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  try {
    const result = await db.query(
      'UPDATE devices SET assigned_user_id = $1 WHERE id = $2 RETURNING *',
      [userId ? parseInt(userId) : null, req.params.id]
    );
    res.json({ device: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign device' });
  }
});

// ============================================================
// SERVE REACT FRONTEND (STATIC ASSETS & SPA ROUTING)
// ============================================================
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ============================================================
// START SERVER & DATABASE INITIALIZATION
// ============================================================
app.listen(PORT, async () => {
  console.log(`[API] Server running on port ${PORT}`);
  await db.initDatabase();
});
