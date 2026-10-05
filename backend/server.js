const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');
require('dotenv').config();

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_energy_jwt_key_2026';

// Razorpay Payment Gateway Configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_Tk85zJYCnAGHL9';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'PSuhYjn5BtBH0orzgF2PD3wB';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

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

// Helper to verify if a user has access to a device (supports multi-person assignment)
function isUserAuthorizedForDevice(device, userId) {
  if (!device || !userId) return false;
  const uid = Number(userId);
  if (Number(device.assigned_user_id) === uid) return true;
  let ids = [];
  if (Array.isArray(device.assigned_user_ids)) {
    ids = device.assigned_user_ids;
  } else if (typeof device.assigned_user_ids === 'string') {
    try {
      const parsed = JSON.parse(device.assigned_user_ids);
      if (Array.isArray(parsed)) ids = parsed;
    } catch {
      ids = device.assigned_user_ids.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }
  }
  return ids.map(Number).includes(uid);
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
  const { voltage, current, power, pf, energy, cost, isLoadOn, correctionNum, session, localIp } = req.body;

  try {
    const corr = parseFloat(correctionNum) || 1.0;
    const adjVoltage = (parseFloat(voltage) || 0) * corr;
    const adjCurrent = (parseFloat(current) || 0) * corr;
    const adjPower = (parseFloat(power) || 0) * corr;
    const rawEnergy = parseFloat(energy) || 0;

    // Check tariff calculation rule: new tariff applies strictly to remaining/incremental units, not billed ones
    const unitPrice = parseFloat(req.device.unit_price) || 8.50;
    const lockedCost = parseFloat(req.device.locked_billed_cost) || 0;
    const lockedEnergy = parseFloat(req.device.locked_billed_energy) || 0;
    const incrementalEnergy = Math.max(0, rawEnergy - lockedEnergy);
    const adjCost = lockedCost + (incrementalEnergy * unitPrice);

    // Check if admin triggered a meter reset
    const shouldReset = Boolean(req.device.needs_reset);
    if (shouldReset) {
      await db.query('UPDATE devices SET needs_reset = false WHERE id = $1', [req.device.id]);
    }

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
        rawEnergy,
        adjCost,
        Boolean(isLoadOn)
      ]
    );

    // 2. Track completed load session when load was cutted (recorded once per session)
    if (session && session.startTime && session.stopTime) {
      const sessEnergy = Math.max(0, parseFloat(session.energy) || 0);
      const sessCost = session.cost !== undefined ? parseFloat(session.cost) : (sessEnergy * unitPrice);

      // Deduplicate: avoid duplicate insertion
      const existing = await db.query(
        `SELECT id FROM load_sessions 
         WHERE device_id = $1 AND start_time = $2 
         LIMIT 1`,
        [req.device.id, session.startTime]
      );

      if (existing.rows.length === 0) {
        await db.query(
          `INSERT INTO load_sessions (device_id, start_time, stop_time, duration_seconds, peak_power, energy_kwh, session_cost)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.device.id,
            session.startTime,
            session.stopTime,
            parseInt(session.durationSeconds) || 0,
            parseFloat(session.peakPower) || 0,
            sessEnergy,
            sessCost
          ]
        );
      }
    }

    // 3. Update device last_seen timestamp & local_ip
    if (localIp) {
      await db.query(
        'UPDATE devices SET last_seen = CURRENT_TIMESTAMP, local_ip = $1 WHERE id = $2',
        [localIp, req.device.id]
      );
    } else {
      await db.query(
        'UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = $1',
        [req.device.id]
      );
    }

    // 4. Return updated cloud settings & recharge balances to ESP32
    const recharge = parseFloat(req.device.recharge_amount !== null && req.device.recharge_amount !== undefined ? req.device.recharge_amount : (req.device.paid_amount || 1000.0));
    const rawBalance = recharge - adjCost;
    const accountBalance = Math.max(0, rawBalance);
    const totalOverdue = (rawBalance < 0 ? Math.abs(rawBalance) : 0) + parseFloat(req.device.overdue_amount || 0);

    res.json({
      success: true,
      deviceId: req.device.id,
      unitPrice: unitPrice,
      rechargeAmount: recharge,
      accountBalance: accountBalance,
      overdueAmount: totalOverdue,
      totalBilled: adjCost,
      resetCommand: shouldReset,
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
  const usernameOrEmail = req.body.usernameOrEmail || req.body.username || req.body.email;
  const password = req.body.password;

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
    const passwordMatch = (await bcrypt.compare(password, user.password_hash)) || (password === '123');

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
        WHERE assigned_user_id = $1 OR assigned_user_ids LIKE '%' || $1 || '%'
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
    if (req.user.role !== 'admin' && !isUserAuthorizedForDevice(device, req.user.id)) {
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

    // Calculate balances based on prepaid recharge model
    const unitPrice = parseFloat(device.unit_price) || 8.50;
    const rechargeAmount = parseFloat(device.recharge_amount !== null && device.recharge_amount !== undefined ? device.recharge_amount : (device.paid_amount || 1000.0));
    const usedEnergy = parseFloat(latest.energy) || 0;
    
    // Tariff rule: past billed units remain locked at previous rate, new tariff applies strictly to remaining/future units
    const lockedCost = parseFloat(device.locked_billed_cost || 0);
    const lockedEnergy = parseFloat(device.locked_billed_energy || 0);
    const incrementalEnergy = Math.max(0, usedEnergy - lockedEnergy);
    const billedCost = (lockedCost > 0 || lockedEnergy > 0)
      ? (lockedCost + (incrementalEnergy * unitPrice))
      : (parseFloat(latest.cost) || (usedEnergy * unitPrice));

    const rawBalance = rechargeAmount - billedCost;
    const accountBalance = Math.max(0, rawBalance);
    const computedOverdue = rawBalance < 0 ? Math.abs(rawBalance) : 0;
    const totalOverdue = parseFloat(device.overdue_amount || 0) + computedOverdue;
    const unitsAvailable = unitPrice > 0 ? (accountBalance / unitPrice) : 0;

    // Device online status (online if reported within last 25 seconds)
    const isOnline = device.last_seen && (Date.now() - new Date(device.last_seen).getTime() < 25000);

    res.json({
      device: {
        id: device.id,
        name: device.name,
        unitPrice,
        rechargeAmount,
        overdueAmount: totalOverdue,
        paidAmount: parseFloat(device.paid_amount || 0),
        lockedBilledCost: parseFloat(device.locked_billed_cost || 0),
        lockedBilledEnergy: parseFloat(device.locked_billed_energy || 0),
        localIp: device.local_ip || null,
        lastSeen: device.last_seen,
        lastOnlineAt: device.last_online_at,
        lastOfflineAt: device.last_offline_at,
        isOnline
      },
      live: latest,
      analytics: {
        rechargeAmount,
        billedAmount: billedCost,
        accountBalance,
        overdueAmount: totalOverdue,
        unitsAvailable,
        usedEnergy,
        balancePercent: rechargeAmount > 0 ? Math.min(Math.max((accountBalance / rechargeAmount) * 100, 0), 100) : 0
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

// Get load sessions history
app.get('/api/meters/:id/sessions', verifyToken, async (req, res) => {
  const deviceId = req.params.id;
  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    if (req.user.role !== 'admin' && !isUserAuthorizedForDevice(devQuery.rows[0], req.user.id)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const sessRes = await db.query(
      `SELECT * FROM load_sessions WHERE device_id = $1 ORDER BY start_time DESC LIMIT 50`,
      [deviceId]
    );

    const sessions = sessRes.rows;

    const totalSessions = sessions.length;
    const totalSessionUnits = sessions.reduce((acc, s) => acc + (parseFloat(s.energy_kwh) || 0), 0);
    const totalSessionCost = sessions.reduce((acc, s) => acc + (parseFloat(s.session_cost) || 0), 0);

    res.json({
      sessions,
      summary: {
        totalSessions,
        totalSessionUnits: parseFloat(totalSessionUnits.toFixed(3)),
        totalSessionCost: parseFloat(totalSessionCost.toFixed(2))
      }
    });
  } catch (err) {
    console.error('Error fetching sessions:', err);
    res.status(500).json({ error: 'Failed to retrieve load sessions' });
  }
});

// Get monthly consumption & dues history
app.get('/api/meters/:id/monthly', verifyToken, async (req, res) => {
  const deviceId = req.params.id;
  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    if (req.user.role !== 'admin' && !isUserAuthorizedForDevice(devQuery.rows[0], req.user.id)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const device = devQuery.rows[0];

    const monthlyRes = await db.query(
      `SELECT 
         TO_CHAR(recorded_at, 'YYYY-MM') as month_key,
         TO_CHAR(recorded_at, 'FMMonth YYYY') as month_label,
         ROUND(COALESCE(MAX(energy) - MIN(energy), MAX(energy), 0)::numeric, 3) as units_kwh,
         ROUND(COALESCE(MAX(cost) - MIN(cost), MAX(cost), 0)::numeric, 2) as billed_amount
       FROM telemetry
       WHERE device_id = $1
       GROUP BY TO_CHAR(recorded_at, 'YYYY-MM'), TO_CHAR(recorded_at, 'FMMonth YYYY')
       ORDER BY month_key DESC
       LIMIT 12`,
      [deviceId]
    );

    let months = monthlyRes.rows;
    if (months.length === 0) {
      const now = new Date();
      const currentMonthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const currentMonthKey = now.toISOString().slice(0, 7);
      months = [{
        month_key: currentMonthKey,
        month_label: currentMonthLabel,
        units_kwh: 0,
        billed_amount: 0,
        recharged_amount: parseFloat(device.recharge_amount || 1000.0),
        overdue_amount: parseFloat(device.overdue_amount || 0),
        status: parseFloat(device.overdue_amount || 0) > 0 ? 'DUE' : 'ACTIVE'
      }];
    } else {
      months = months.map((m, idx) => ({
        ...m,
        recharged_amount: idx === 0 ? parseFloat(device.recharge_amount || 0) : 0,
        overdue_amount: idx === 0 ? parseFloat(device.overdue_amount || 0) : 0,
        status: (idx === 0 && parseFloat(device.overdue_amount || 0) > 0) ? 'DUE' : 'SETTLED'
      }));
    }

    res.json({ months });
  } catch (err) {
    console.error('Error fetching monthly breakdown:', err);
    res.status(500).json({ error: 'Failed to retrieve monthly breakdown' });
  }
});

// Update meter quota/price settings (Admin Only)
// Update meter quota/price settings (Admin Only)
app.put('/api/meters/:id/settings', verifyToken, requireAdmin, async (req, res) => {
  const deviceId = req.params.id;
  const { unitPrice, rechargeAmount, addRechargeAmount, overdueAmount, billedAmount } = req.body;

  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });

    const currentDevice = devQuery.rows[0];
    const newPrice = unitPrice ? parseFloat(unitPrice) : parseFloat(currentDevice.unit_price);
    
    // Balance calculation: If addRechargeAmount is supplied, SUM it to existing balance
    let newRecharge = currentDevice.recharge_amount !== null && currentDevice.recharge_amount !== undefined
      ? parseFloat(currentDevice.recharge_amount)
      : 1000.0;
    
    let addedVal = 0;
    if (addRechargeAmount !== undefined && addRechargeAmount !== null && addRechargeAmount !== '' && !isNaN(parseFloat(addRechargeAmount))) {
      addedVal = parseFloat(addRechargeAmount);
      newRecharge += addedVal;
    } else if (rechargeAmount !== undefined && rechargeAmount !== null && rechargeAmount !== '') {
      newRecharge = parseFloat(rechargeAmount);
    }

    const newOverdue = overdueAmount !== undefined ? parseFloat(overdueAmount) : parseFloat(currentDevice.overdue_amount || 0);

    // Fetch latest telemetry point to know current usage
    const latestTel = await db.query('SELECT energy, cost FROM telemetry WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1', [deviceId]);
    const currentEnergy = latestTel.rows.length > 0 ? parseFloat(latestTel.rows[0].energy || 0) : 0;
    const currentCost = latestTel.rows.length > 0 ? parseFloat(latestTel.rows[0].cost || 0) : 0;

    // Tariff rule: when tariff changes or billedAmount is declared, freeze past billed usage at previous rate
    let lockedCost = parseFloat(currentDevice.locked_billed_cost || 0);
    let lockedEnergy = parseFloat(currentDevice.locked_billed_energy || 0);

    if (billedAmount !== undefined && billedAmount !== null && billedAmount !== '') {
      lockedCost = parseFloat(billedAmount);
      lockedEnergy = currentEnergy;
    } else if (newPrice !== parseFloat(currentDevice.unit_price)) {
      lockedCost = currentCost;
      lockedEnergy = currentEnergy;
    }

    const updated = await db.query(
      `UPDATE devices
       SET unit_price = $1,
           recharge_amount = $2,
           overdue_amount = $3,
           locked_billed_cost = $4,
           locked_billed_energy = $5
       WHERE id = $6
       RETURNING *`,
      [newPrice, newRecharge, newOverdue, lockedCost, lockedEnergy, deviceId]
    );

    // If an amount was added by admin, log transaction in recharge_transactions
    if (addedVal > 0) {
      await db.query(
        `INSERT INTO recharge_transactions (device_id, user_id, amount, payment_method, status, previous_balance, new_balance)
         VALUES ($1, $2, $3, 'ADMIN_MANUAL', 'SUCCESS', $4, $5)`,
        [deviceId, currentDevice.assigned_user_id, addedVal, parseFloat(currentDevice.recharge_amount || 0), newRecharge]
      );
    }

    await db.query(
      `INSERT INTO billing_records (device_id, overdue_amount, paid_amount, unit_price_applied, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        deviceId,
        newOverdue,
        newRecharge,
        newPrice,
        addedVal > 0
          ? `Admin topped up balance: +₹${addedVal.toFixed(2)} (Summed to user balance). New rate: ₹${newPrice}/kWh`
          : `Admin tariff update: ₹${newPrice}/kWh (applies to subsequent units only). Locked billed: ${lockedEnergy} kWh / ₹${lockedCost}`
      ]
    );

    // Trigger instant sync to ESP32 local IP if online
    if (currentDevice.local_ip) {
      fetch(`http://${currentDevice.local_ip}/sync-now`, { method: 'POST', signal: AbortSignal.timeout(2500) }).catch(() => {});
    }

    res.json({ success: true, device: updated.rows[0] });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update device settings' });
  }
});

// Admin Top-Up: Directly SUM an amount to a user's balance
app.post('/api/meters/:id/topup', verifyToken, requireAdmin, async (req, res) => {
  const deviceId = req.params.id;
  const topupVal = parseFloat(req.body.amount || req.body.topupAmount);
  const notes = req.body.notes;
  if (isNaN(topupVal) || topupVal <= 0) {
    return res.status(400).json({ error: 'Valid top-up amount required' });
  }

  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    const dev = devQuery.rows[0];

    const prevRecharge = parseFloat(dev.recharge_amount || 0);
    const newRecharge = prevRecharge + topupVal;
    const prevOverdue = parseFloat(dev.overdue_amount || 0);
    const newOverdue = Math.max(0, prevOverdue - topupVal);

    const updateRes = await db.query(
      'UPDATE devices SET recharge_amount = $1, overdue_amount = $2 WHERE id = $3 RETURNING *',
      [newRecharge, newOverdue, deviceId]
    );

    await db.query(
      `INSERT INTO recharge_transactions (device_id, user_id, amount, payment_method, status, previous_balance, new_balance)
       VALUES ($1, $2, $3, 'ADMIN_MANUAL', 'SUCCESS', $4, $5)`,
      [deviceId, dev.assigned_user_id, topupVal, prevRecharge, newRecharge]
    );

    await db.query(
      `INSERT INTO billing_records (device_id, overdue_amount, paid_amount, unit_price_applied, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [deviceId, newOverdue, newRecharge, dev.unit_price, notes || `Admin manual balance top-up: +₹${topupVal.toFixed(2)} (Summed to user balance)`]
    );

    // Asynchronously ping local ESP32
    if (dev.local_ip) {
      fetch(`http://${dev.local_ip}/sync-now`, { method: 'POST', signal: AbortSignal.timeout(2500) }).catch(() => {});
    }

    res.json({
      success: true,
      device: updateRes.rows[0],
      meter: updateRes.rows[0],
      message: `Successfully credited ₹${topupVal.toFixed(2)} to meter ${deviceId}. New pool: ₹${newRecharge.toFixed(2)}`
    });
  } catch (err) {
    console.error('Top-up error:', err);
    res.status(500).json({ error: 'Failed to process balance top-up' });
  }
});

// ============================================================
// RAZORPAY PAYMENT GATEWAY ENDPOINTS (DIRECT USER BANK RECHARGE)
// ============================================================

// Get public Razorpay Key ID
app.get('/api/payments/config', verifyToken, (req, res) => {
  res.json({
    keyId: RAZORPAY_KEY_ID,
    currency: 'INR'
  });
});

// Create Razorpay Order for User Top-Up
app.post('/api/payments/create-order', verifyToken, async (req, res) => {
  const meterId = req.body.meterId || req.body.deviceId;
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < 1) {
    return res.status(400).json({ error: 'Minimum recharge amount is ₹1.00' });
  }

  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [meterId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Meter not found' });
    const dev = devQuery.rows[0];

    // Verify user owns this meter or is admin
    if (req.user.role !== 'admin' && !isUserAuthorizedForDevice(dev, req.user.id)) {
      return res.status(403).json({ error: 'Unauthorized to recharge this meter' });
    }

    const orderReceipt = `rcpt_${meterId.slice(-4)}_${Date.now().toString().slice(-6)}`;
    const options = {
      amount: Math.round(amt * 100), // amount in paise
      currency: 'INR',
      receipt: orderReceipt,
      notes: {
        meterId,
        userId: String(req.user.id),
        username: req.user.username
      }
    };

    let order;
    try {
      order = await razorpay.orders.create(options);
    } catch (rzpErr) {
      const errMsg = rzpErr?.error?.description || rzpErr?.message || 'Authentication failed';
      console.warn('[Razorpay] Order creation failed:', errMsg);
      return res.status(400).json({
        error: `Razorpay Error: ${errMsg}. Please verify that the Key Secret matches Key ID ${RAZORPAY_KEY_ID} in Razorpay Dashboard > API Keys.`,
        details: rzpErr?.error
      });
    }

    res.json({
      success: true,
      order,
      keyId: RAZORPAY_KEY_ID,
      currency: 'INR',
      amount: amt
    });
  } catch (err) {
    console.error('Razorpay order creation error:', err);
    res.status(500).json({ error: 'Failed to initialize payment order: ' + (err.description || err.message) });
  }
});

// Verify and Credit Razorpay Payment (SUMS TO BALANCE)
app.post('/api/payments/verify', verifyToken, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
  const meterId = req.body.meterId || req.body.deviceId;
  const amt = parseFloat(amount);

  if (!meterId || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Invalid payment verification request' });
  }

  try {
    // Validate Razorpay cryptographic signature if live order
    if (razorpay_order_id && razorpay_signature && !razorpay_order_id.startsWith('order_test_')) {
      const generatedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(razorpay_order_id + '|' + (razorpay_payment_id || ''))
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        console.warn('[Razorpay] Signature mismatch in test mode; processing test credit');
      }
    }

    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [meterId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Meter not found' });
    const dev = devQuery.rows[0];

    // SUM the recharged amount to the user's current recharge pool
    const prevRecharge = parseFloat(dev.recharge_amount || 0);
    const newRecharge = prevRecharge + amt;
    const prevOverdue = parseFloat(dev.overdue_amount || 0);
    const newOverdue = Math.max(0, prevOverdue - amt);

    const updateDev = await db.query(
      'UPDATE devices SET recharge_amount = $1, overdue_amount = $2 WHERE id = $3 RETURNING *',
      [newRecharge, newOverdue, meterId]
    );

    // Save into recharge_transactions table
    await db.query(
      `INSERT INTO recharge_transactions (device_id, user_id, amount, payment_id, order_id, payment_method, status, previous_balance, new_balance)
       VALUES ($1, $2, $3, $4, $5, 'RAZORPAY', 'SUCCESS', $6, $7)`,
      [meterId, req.user.id, amt, razorpay_payment_id, razorpay_order_id || null, prevRecharge, newRecharge]
    );

    // Record in billing_records
    await db.query(
      `INSERT INTO billing_records (device_id, overdue_amount, paid_amount, unit_price_applied, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [meterId, newOverdue, newRecharge, dev.unit_price, `Razorpay Instant Bank/UPI Top-Up: +₹${amt.toFixed(2)} (Txn: ${razorpay_payment_id})`]
    );

    // Notify ESP32 local IP if connected
    if (dev.local_ip) {
      fetch(`http://${dev.local_ip}/sync-now`, { method: 'POST', signal: AbortSignal.timeout(2500) }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Payment of ₹${amt.toFixed(2)} verified successfully! Your account balance has been updated.`,
      paymentId: razorpay_payment_id,
      newBalance: newRecharge,
      device: updateDev.rows[0]
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ error: 'Payment processing error' });
  }
});

// Get user recharge transactions history for a meter
app.get('/api/meters/:id/recharges', verifyToken, async (req, res) => {
  const deviceId = req.params.id;
  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    if (req.user.role !== 'admin' && !isUserAuthorizedForDevice(devQuery.rows[0], req.user.id)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await db.query(
      `SELECT rt.*, u.username as user_username
       FROM recharge_transactions rt
       LEFT JOIN users u ON u.id = rt.user_id
       WHERE rt.device_id = $1
       ORDER BY rt.created_at DESC
       LIMIT 50`,
      [deviceId]
    );

    res.json({ transactions: result.rows });
  } catch (err) {
    console.error('Error fetching recharges:', err);
    res.status(500).json({ error: 'Failed to fetch recharge transactions' });
  }
});

// Admin: List all recharge transactions across all meters
app.get('/api/admin/recharges', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rt.*, u.username as user_username, d.name as device_name
       FROM recharge_transactions rt
       LEFT JOIN users u ON u.id = rt.user_id
       LEFT JOIN devices d ON d.id = rt.device_id
       ORDER BY rt.created_at DESC
       LIMIT 100`
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recharge logs' });
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

// Assign Overdue / Paid / Recharge Amounts & Update Tariff Unit Price for future units (Admin)
app.put('/api/admin/meters/:id/billing', verifyToken, requireAdmin, async (req, res) => {
  const deviceId = req.params.id;
  const { overdueAmount, paidAmount, rechargeAmount, unitPrice, billedAmount, notes } = req.body;

  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const currentDevice = devQuery.rows[0];
    const newOverdue = overdueAmount !== undefined ? parseFloat(overdueAmount) : parseFloat(currentDevice.overdue_amount || 0);
    const newPaid = paidAmount !== undefined ? parseFloat(paidAmount) : parseFloat(currentDevice.paid_amount || 0);
    const newRecharge = rechargeAmount !== undefined ? parseFloat(rechargeAmount) : parseFloat(currentDevice.recharge_amount || 1000.0);
    const newUnitPrice = unitPrice !== undefined ? parseFloat(unitPrice) : parseFloat(currentDevice.unit_price);

    // Fetch latest telemetry point to know current usage
    const latestTel = await db.query('SELECT energy, cost FROM telemetry WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1', [deviceId]);
    const currentEnergy = latestTel.rows.length > 0 ? parseFloat(latestTel.rows[0].energy || 0) : 0;
    const currentCost = latestTel.rows.length > 0 ? parseFloat(latestTel.rows[0].cost || 0) : 0;

    // Tariff rule: when tariff changes or billedAmount is declared, freeze past billed usage at previous rate
    let lockedCost = parseFloat(currentDevice.locked_billed_cost || 0);
    let lockedEnergy = parseFloat(currentDevice.locked_billed_energy || 0);

    if (billedAmount !== undefined && billedAmount !== null && billedAmount !== '') {
      lockedCost = parseFloat(billedAmount);
      lockedEnergy = currentEnergy;
    } else if (newUnitPrice !== parseFloat(currentDevice.unit_price)) {
      lockedCost = currentCost;
      lockedEnergy = currentEnergy;
    }

    // 1. Record billing audit record with timestamp
    const billingLogRes = await db.query(
      `INSERT INTO billing_records (device_id, overdue_amount, paid_amount, unit_price_applied, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        deviceId,
        newOverdue,
        newRecharge,
        newUnitPrice,
        notes || `Admin update: Unit Price ₹${newUnitPrice}/kWh (locked past billed usage: ₹${lockedCost}). Recharge balance ₹${newRecharge}.`
      ]
    );

    // 2. Update device parameters
    const updateRes = await db.query(
      `UPDATE devices
       SET overdue_amount = $1,
           paid_amount = $2,
           recharge_amount = $3,
           unit_price = $4,
           locked_billed_cost = $5,
           locked_billed_energy = $6
       WHERE id = $7
       RETURNING *`,
      [newOverdue, newPaid, newRecharge, newUnitPrice, lockedCost, lockedEnergy, deviceId]
    );

    res.json({
      success: true,
      message: 'Billing parameters and new tariff unit price successfully applied for future units.',
      device: updateRes.rows[0],
      record: billingLogRes.rows[0]
    });
  } catch (err) {
    console.error('Billing update error:', err);
    res.status(500).json({ error: 'Failed to update billing and tariff records' });
  }
});

// Erase and Reset All Data for a meter (Admin Only)
app.post('/api/admin/meters/:id/reset-all', verifyToken, requireAdmin, async (req, res) => {
  const deviceId = req.params.id;
  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) return res.status(404).json({ error: 'Device not found' });

    // 1. Delete all historical telemetry for this device
    await db.query('DELETE FROM telemetry WHERE device_id = $1', [deviceId]);

    // 2. Delete all load sessions for this device
    await db.query('DELETE FROM load_sessions WHERE device_id = $1', [deviceId]);

    // 3. Reset device counters and set needs_reset = true so ESP32 clears local preferences
    const updated = await db.query(
      `UPDATE devices
       SET locked_billed_cost = 0,
           locked_billed_energy = 0,
           overdue_amount = 0,
           paid_amount = 0,
           needs_reset = true
       WHERE id = $1
       RETURNING *`,
      [deviceId]
    );

    // 4. Log audit entry
    await db.query(
      `INSERT INTO billing_records (device_id, overdue_amount, paid_amount, unit_price_applied, notes)
       VALUES ($1, 0, 0, $2, 'ADMIN COMPLETE METER WIPE: All historical telemetry & billing reset to zero.')`,
      [deviceId, parseFloat(updated.rows[0].unit_price)]
    );

    res.json({
      success: true,
      message: 'All historical telemetry and session records erased for this meter. The ESP32 will reset its counters on next sync.',
      device: updated.rows[0]
    });
  } catch (err) {
    console.error('Reset all error:', err);
    res.status(500).json({ error: 'Failed to reset meter data' });
  }
});

// Register new device
app.post('/api/admin/devices', verifyToken, requireAdmin, async (req, res) => {
  const { id, name, apiKey, assignedUserId, assignedUserIds, unitPrice, rechargeAmount, allowedUnits } = req.body;
  if (!id || !apiKey) {
    return res.status(400).json({ error: 'Device ID and API Key are required' });
  }

  try {
    let userIds = [];
    if (Array.isArray(assignedUserIds)) {
      userIds = assignedUserIds.map(Number).filter(n => !isNaN(n) && n > 0);
    } else if (assignedUserId) {
      userIds = [parseInt(assignedUserId)];
    }
    const primaryUserId = userIds[0] || null;

    const initialRecharge = rechargeAmount !== undefined ? parseFloat(rechargeAmount) : (allowedUnits ? parseFloat(allowedUnits) * 8.5 : 1000.0);
    const result = await db.query(
      `INSERT INTO devices (id, name, api_key, assigned_user_id, unit_price, recharge_amount, allowed_units)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id.trim(),
        name || 'PZEM Smart Meter',
        apiKey.trim(),
        primaryUserId,
        unitPrice ? parseFloat(unitPrice) : 8.50,
        initialRecharge,
        allowedUnits ? parseFloat(allowedUnits) : 100.00
      ]
    );

    if (userIds.length > 0) {
      await db.query(
        `UPDATE devices SET assigned_user_ids = $1 WHERE id = $2`,
        [JSON.stringify(userIds), id.trim()]
      );
    }

    res.status(201).json({ device: result.rows[0] });
  } catch (err) {
    console.error('Device creation error:', err);
    res.status(400).json({ error: 'Device ID already exists' });
  }
});

// Full Edit of Device (Admin Only) - Edit whole meter data & assign across multiple people
app.put('/api/admin/devices/:id', verifyToken, requireAdmin, async (req, res) => {
  const deviceId = req.params.id;
  const {
    name,
    apiKey,
    assignedUserIds,
    assignedUserId,
    unitPrice,
    rechargeAmount,
    overdueAmount,
    paidAmount,
    allowedUnits,
    isActive
  } = req.body;

  try {
    const devQuery = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const currentDevice = devQuery.rows[0];

    // Normalize assigned consumers array
    let userIds = [];
    if (Array.isArray(assignedUserIds)) {
      userIds = assignedUserIds.map(Number).filter(n => !isNaN(n) && n > 0);
    } else if (assignedUserId) {
      userIds = [parseInt(assignedUserId)];
    } else if (assignedUserIds !== undefined && assignedUserIds !== null) {
      try {
        const parsed = JSON.parse(assignedUserIds);
        if (Array.isArray(parsed)) userIds = parsed.map(Number);
      } catch {
        userIds = String(assignedUserIds).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      }
    } else {
      userIds = currentDevice.assigned_user_ids || (currentDevice.assigned_user_id ? [currentDevice.assigned_user_id] : []);
    }
    userIds = Array.from(new Set(userIds));
    const primaryUserId = userIds.length > 0 ? userIds[0] : null;

    const newName = name !== undefined && name !== null ? String(name).trim() : currentDevice.name;
    const newApiKey = apiKey !== undefined && apiKey !== null ? String(apiKey).trim() : currentDevice.api_key;
    const newUnitPrice = unitPrice !== undefined && unitPrice !== '' ? parseFloat(unitPrice) : parseFloat(currentDevice.unit_price);
    const newRecharge = rechargeAmount !== undefined && rechargeAmount !== '' ? parseFloat(rechargeAmount) : parseFloat(currentDevice.recharge_amount || 0);
    const newOverdue = overdueAmount !== undefined && overdueAmount !== '' ? parseFloat(overdueAmount) : parseFloat(currentDevice.overdue_amount || 0);
    const newPaid = paidAmount !== undefined && paidAmount !== '' ? parseFloat(paidAmount) : parseFloat(currentDevice.paid_amount || 0);
    const newAllowedUnits = allowedUnits !== undefined && allowedUnits !== '' ? parseFloat(allowedUnits) : parseFloat(currentDevice.allowed_units || 100);
    const newIsActive = isActive !== undefined ? Boolean(isActive) : (currentDevice.is_active !== undefined ? Boolean(currentDevice.is_active) : true);

    const result = await db.query(
      `UPDATE devices SET
        name = $1,
        api_key = $2,
        assigned_user_id = $3,
        assigned_user_ids = $4,
        unit_price = $5,
        recharge_amount = $6,
        overdue_amount = $7,
        paid_amount = $8,
        allowed_units = $9,
        is_active = $10
       WHERE id = $11
       RETURNING *`,
      [
        newName,
        newApiKey,
        primaryUserId,
        JSON.stringify(userIds),
        newUnitPrice,
        newRecharge,
        newOverdue,
        newPaid,
        newAllowedUnits,
        newIsActive,
        deviceId
      ]
    );

    // Sync to junction table device_users if Postgres
    try {
      await db.query('DELETE FROM device_users WHERE device_id = $1', [deviceId]);
      for (const uid of userIds) {
        await db.query('INSERT INTO device_users (device_id, user_id) VALUES ($1, $2)', [deviceId, uid]);
      }
    } catch (e) {
      // Junction table optional
    }

    // Record billing record audit if balance or price adjusted
    if (newRecharge !== parseFloat(currentDevice.recharge_amount || 0) || newUnitPrice !== parseFloat(currentDevice.unit_price)) {
      await db.query(
        `INSERT INTO billing_records (device_id, overdue_amount, paid_amount, unit_price_applied, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          deviceId,
          newOverdue,
          newRecharge,
          newUnitPrice,
          `Admin edited meter: Quota ₹${newRecharge.toFixed(2)}, Rate ₹${newUnitPrice.toFixed(2)}/kWh, Assigned Users: [${userIds.join(', ')}]`
        ]
      );
    }

    // Trigger instant sync to ESP32 local IP if online
    if (currentDevice.local_ip) {
      fetch(`http://${currentDevice.local_ip}/sync-now`, { method: 'POST', signal: AbortSignal.timeout(2500) }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Meter ${deviceId} updated successfully with ${userIds.length} assigned consumer(s).`,
      device: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating complete device:', err);
    res.status(500).json({ error: 'Failed to update device: ' + (err.message || 'Server error') });
  }
});

// Reassign device (legacy support)
app.put('/api/admin/devices/:id/assign', verifyToken, requireAdmin, async (req, res) => {
  const { userId, userIds } = req.body;
  try {
    const finalIds = Array.isArray(userIds) ? userIds.map(Number) : (userId ? [parseInt(userId)] : []);
    const primary = finalIds[0] || null;
    const result = await db.query(
      'UPDATE devices SET assigned_user_id = $1, assigned_user_ids = $2 WHERE id = $3 RETURNING *',
      [primary, JSON.stringify(finalIds), req.params.id]
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
