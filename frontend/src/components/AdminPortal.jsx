import React, { useState, useEffect } from 'react';
import { fetchApi } from '../api';
import {
  Zap,
  Users,
  Cpu,
  PlusCircle,
  ArrowLeft,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Key,
  Trash2,
  Database,
  RefreshCw,
  Save,
  X,
  Lock,
  Layers,
  Activity,
  HardDrive
} from 'lucide-react';

export default function AdminPortal({ onSwitchToDashboard, onSwitchToLanding, onLogout, showToast }) {
  const [activeTab, setActiveTab] = useState('meters'); // 'meters', 'users', 'database'
  const [devices, setDevices] = useState([]);
  const [users, setUsers] = useState([]);

  // Database Stats & Logs
  const [dbOverview, setDbOverview] = useState(null);
  const [dbLogs, setDbLogs] = useState([]);
  const [loadingDb, setLoadingDb] = useState(false);

  // New Device Form State
  const [devId, setDevId] = useState('');
  const [devName, setDevName] = useState('');
  const [devKey, setDevKey] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [devPrice, setDevPrice] = useState('8.50');
  const [devUnits, setDevUnits] = useState('100.0');

  // New User Form State
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');

  // Edit User / Change Password Modal State
  const [editingUser, setEditingUser] = useState(null);
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('user');

  const loadData = async () => {
    try {
      const [devRes, userRes] = await Promise.all([
        fetchApi('/api/meters'),
        fetchApi('/api/admin/users')
      ]);

      const devData = await devRes.json();
      const userData = await userRes.json();

      if (devData.meters) setDevices(devData.meters);
      if (userData.users) setUsers(userData.users);
    } catch (err) {
      showToast('Error loading admin records');
    }
  };

  const loadDatabaseStats = async () => {
    setLoadingDb(true);
    try {
      const [ovRes, logsRes] = await Promise.all([
        fetchApi('/api/admin/database/overview'),
        fetchApi('/api/admin/database/telemetry-logs?limit=50')
      ]);

      const ovData = await ovRes.json();
      const logsData = await logsRes.json();

      if (ovRes.ok) setDbOverview(ovData);
      if (logsRes.ok && logsData.logs) setDbLogs(logsData.logs);
      showToast('Database records synchronized');
    } catch (err) {
      showToast('Error querying database records');
    } finally {
      setLoadingDb(false);
    }
  };

  useEffect(() => {
    loadData();
    loadDatabaseStats();
  }, []);

  const handleRegisterDevice = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchApi('/api/admin/devices', {
        method: 'POST',
        body: JSON.stringify({
          id: devId,
          name: devName,
          apiKey: devKey,
          assignedUserId: assignedUserId || null,
          unitPrice: devPrice,
          allowedUnits: devUnits
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register meter');

      showToast('Meter provisioned successfully!');
      setDevId('');
      setDevName('');
      setDevKey('');
      loadData();
      loadDatabaseStats();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchApi('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, email, password, role })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      showToast(`Account created for ${data.user.username}!`);
      setUsername('');
      setEmail('');
      setPassword('');
      loadData();
      loadDatabaseStats();
    } catch (err) {
      showToast(err.message);
    }
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditEmail(user.email);
    setEditPassword('');
    setEditRole(user.role);
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const res = await fetchApi(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: editUsername,
          email: editEmail,
          password: editPassword || undefined,
          role: editRole
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update credentials');

      showToast(`Credentials updated for "${data.user.username}"!`);
      setEditingUser(null);
      loadData();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!confirm(`Are you sure you want to delete user "${user.username}"?`)) return;

    try {
      const res = await fetchApi(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');

      showToast(`User "${user.username}" removed`);
      loadData();
      loadDatabaseStats();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDeleteDevice = async (device) => {
    if (!confirm(`Are you sure you want to unregister meter "${device.id}"?`)) return;

    try {
      const res = await fetchApi(`/api/admin/devices/${device.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete device');

      showToast(`Meter "${device.id}" deleted`);
      loadData();
      loadDatabaseStats();
    } catch (err) {
      showToast(err.message);
    }
  };

  return (
    <div className="container">
      {/* Top Header */}
      <header className="header glass">
        <div className="brand">
          <div className="brand-icon">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="brand-title">ADMIN MASTER CONTROL</h1>
            <p className="brand-subtitle">PostgreSQL Database, Fleet & User Security Hub</p>
          </div>
        </div>

        <div className="nav-actions">
          {onSwitchToLanding && (
            <button
              onClick={onSwitchToLanding}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '7px 12px' }}
              title="Return to System Introduction & Specs"
            >
              <Layers size={14} />
              <span>Intro</span>
            </button>
          )}

          <button
            onClick={onSwitchToDashboard}
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '7px 12px' }}
          >
            <ArrowLeft size={14} />
            <span>Live Meters</span>
          </button>

          <button
            onClick={onLogout}
            className="btn btn-danger"
            style={{ fontSize: '0.8rem', padding: '7px 12px' }}
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Database & Fleet Health Stats Overview */}
      <section className="grid" style={{ marginBottom: '20px' }}>
        <div className="tile glass">
          <div className="tile-icon" style={{ color: 'var(--cyan)' }}>
            <Cpu size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Registered Meters</div>
            <div className="tile-val">{devices.length}</div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: 'var(--purple)' }}>
            <Users size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Total Accounts</div>
            <div className="tile-val">{users.length}</div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: 'var(--emerald)' }}>
            <Database size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">DB Telemetry Records</div>
            <div className="tile-val" style={{ color: 'var(--emerald)' }}>
              {dbOverview?.totalTelemetryLogs?.toLocaleString() || '...'}
            </div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: 'var(--blue)' }}>
            <HardDrive size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Database Status</div>
            <div className="tile-val" style={{ fontSize: '1rem', color: 'var(--cyan)' }}>
              {dbOverview?.status || 'Active (Render PG)'}
            </div>
          </div>
        </div>
      </section>

      {/* Tab Navigation */}
      <div className="admin-tabs glass" style={{ marginBottom: '22px' }}>
        <button
          className={`tab-btn ${activeTab === 'meters' ? 'active' : ''}`}
          onClick={() => setActiveTab('meters')}
        >
          <Cpu size={16} />
          <span>Fleet & Meter Provisioning</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <Users size={16} />
          <span>User Accounts & Password Authority</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'database' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('database');
            loadDatabaseStats();
          }}
        >
          <Database size={16} />
          <span>PostgreSQL Database & Live Logs</span>
        </button>
      </div>

      {/* ======================================================== */}
      {/* TAB 1: FLEET & METERS */}
      {/* ======================================================== */}
      {activeTab === 'meters' && (
        <>
          {/* Provision Meter Form */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '22px' }}>
            <section className="form-card glass">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
                📟 Provision New ESP32 Meter
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Assign a unique Device ID and secret API key to enable encrypted telemetry ingestion into PostgreSQL.
              </p>

              <form onSubmit={handleRegisterDevice}>
                <div className="input-wrap" style={{ marginBottom: '12px' }}>
                  <label>Device ID (Matches ESP32 firmware)</label>
                  <input
                    type="text"
                    placeholder="e.g. ESP32_METER_02"
                    value={devId}
                    onChange={(e) => setDevId(e.target.value)}
                    required
                  />
                </div>

                <div className="input-wrap" style={{ marginBottom: '12px' }}>
                  <label>Meter Display Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Main Lab Power Substation"
                    value={devName}
                    onChange={(e) => setDevName(e.target.value)}
                    required
                  />
                </div>

                <div className="input-wrap" style={{ marginBottom: '12px' }}>
                  <label>Device Secret API Key</label>
                  <input
                    type="text"
                    placeholder="e.g. meter_secret_token_123"
                    value={devKey}
                    onChange={(e) => setDevKey(e.target.value)}
                    required
                  />
                </div>

                <div className="input-wrap" style={{ marginBottom: '12px' }}>
                  <label>Assign to Consumer / Student</label>
                  <select
                    value={assignedUserId}
                    onChange={(e) => setAssignedUserId(e.target.value)}
                  >
                    <option value="">-- Unassigned Meter --</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username} ({u.email}) - [{u.role.toUpperCase()}]
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                  <div className="input-wrap">
                    <label>Tariff Rate (₹/kWh)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={devPrice}
                      onChange={(e) => setDevPrice(e.target.value)}
                    />
                  </div>
                  <div className="input-wrap">
                    <label>Quota Limit (kWh)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={devUnits}
                      onChange={(e) => setDevUnits(e.target.value)}
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  <PlusCircle size={16} />
                  <span>Provision Meter to Cloud</span>
                </button>
              </form>
            </section>

            {/* Quick Fleet Quick Info */}
            <section className="form-card glass">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '6px' }}>
                ⚡ Hardware Connectivity Guide
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '14px' }}>
                All provisioned meters stream telemetry directly to this server:
              </p>
              <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '12px', borderRadius: '10px', fontSize: '0.78rem', color: 'var(--cyan)', fontFamily: 'monospace', marginBottom: '14px', wordBreak: 'break-all' }}>
                POST /api/device/telemetry<br />
                Headers: x-device-id, x-api-key
              </div>
              <ul style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <li>Meters report Active Power, Voltage, Current, Energy & Power Factor.</li>
                <li>When allowed quota reaches 0, the server triggers autonomous load cutoff.</li>
                <li>Device status automatically updates to <strong>ONLINE</strong> whenever a ping is received within 25s.</li>
              </ul>
            </section>
          </div>

          {/* Fleet Table */}
          <section className="form-card glass">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
              📡 Active Smart Meter Fleet
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Real-time synchronization status of all provisioned hardware nodes.
            </p>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Device ID</th>
                    <th>Name</th>
                    <th>Assigned Consumer</th>
                    <th>Tariff Rate</th>
                    <th>Quota Limit</th>
                    <th>Live Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                        No meters registered yet. Use the form above to provision your first ESP32 meter.
                      </td>
                    </tr>
                  ) : (
                    devices.map((d) => {
                      const isOnline = d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 25000;
                      return (
                        <tr key={d.id}>
                          <td>
                            <strong>{d.id}</strong>
                          </td>
                          <td>{d.name}</td>
                          <td>{d.assigned_username || <span style={{ color: '#64748b' }}>Unassigned</span>}</td>
                          <td>₹{parseFloat(d.unit_price).toFixed(2)}</td>
                          <td>{parseFloat(d.allowed_units).toFixed(1)} kWh</td>
                          <td>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: isOnline ? 'var(--emerald)' : 'var(--red)'
                              }}
                            >
                              {isOnline ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                              {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              onClick={() => handleDeleteDevice(d)}
                              className="btn btn-danger"
                              style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                              title="Delete Meter"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ======================================================== */}
      {/* TAB 2: USER MANAGEMENT & PASSWORDS */}
      {/* ======================================================== */}
      {activeTab === 'users' && (
        <>
          {/* Create User Form */}
          <section className="form-card glass" style={{ marginBottom: '22px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
              👤 Create New Account (Student / Consumer / Administrator)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Self-registration is restricted. Administrators have sole authority to create credentials for students and consumers.
            </p>

            <form onSubmit={handleCreateUser}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <div className="input-wrap">
                  <label>Username</label>
                  <input
                    type="text"
                    placeholder="e.g. rahul_sharma"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>

                <div className="input-wrap">
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="e.g. rahul@institution.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="input-wrap">
                  <label>Password</label>
                  <input
                    type="password"
                    placeholder="Initial password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="input-wrap">
                  <label>Access Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="user">Consumer / Student User</option>
                    <option value="admin">Administrator (Super Admin)</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="btn btn-primary">
                <PlusCircle size={16} />
                <span>Provision User Account</span>
              </button>
            </form>
          </section>

          {/* Accounts & Password Management Table */}
          <section className="form-card glass">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
              👥 User Accounts & Database Password Authority
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              As administrator, you can change the username, email, and password for <strong>any user</strong> (including yourself or other admins).
            </p>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Username</th>
                    <th>Email Address</th>
                    <th>Access Role</th>
                    <th>Meters Assigned</th>
                    <th>Registered Date</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>#{u.id}</span>
                      </td>
                      <td>
                        <strong>{u.username}</strong>
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <span className={`badge-role role-${u.role}`}>{u.role}</span>
                      </td>
                      <td>{u.meter_count} meter(s)</td>
                      <td>{new Date(u.created_at).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button
                            onClick={() => openEditModal(u)}
                            className="btn btn-outline"
                            style={{ padding: '6px 12px', fontSize: '0.75rem', color: 'var(--cyan)' }}
                            title="Change Username, Email, or Password"
                          >
                            <Key size={13} />
                            <span>Edit / Change Password</span>
                          </button>

                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="btn btn-danger"
                            style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                            title="Delete User Account"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ======================================================== */}
      {/* TAB 3: POSTGRESQL DATABASE & LIVE LOGS */}
      {/* ======================================================== */}
      {activeTab === 'database' && (
        <>
          <section className="form-card glass" style={{ marginBottom: '22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                  🗄️ PostgreSQL Cloud Database Status
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Inspect live database connection parameters, total telemetry rows, and timestamp ranges.
                </p>
              </div>

              <button
                onClick={loadDatabaseStats}
                className="btn btn-outline"
                disabled={loadingDb}
                style={{ fontSize: '0.8rem', padding: '7px 12px' }}
              >
                <RefreshCw size={14} className={loadingDb ? 'spin-icon' : ''} />
                <span>Refresh DB Telemetry</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Connection Status</span>
                <p style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--emerald)', marginTop: '4px' }}>
                  ● {dbOverview?.status || 'Connected'}
                </p>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Telemetry Logs in DB</span>
                <p style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan)', marginTop: '4px' }}>
                  {dbOverview?.totalTelemetryLogs?.toLocaleString() || 0} rows
                </p>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Total User Accounts</span>
                <p style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--purple)', marginTop: '4px' }}>
                  {dbOverview?.totalUsers || users.length} users
                </p>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Latest Telemetry Timestamp</span>
                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                  {dbOverview?.lastLog ? new Date(dbOverview.lastLog).toLocaleTimeString() : 'Awaiting data'}
                </p>
              </div>
            </div>
          </section>

          {/* Raw Database Telemetry Table */}
          <section className="form-card glass">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
              📊 Real-Time Database Ingestion Table (Latest 50 Telemetry Entries)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Direct live window into the PostgreSQL <code>telemetry</code> table.
            </p>

            <div className="table-wrapper" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Log ID</th>
                    <th>Device ID</th>
                    <th>Voltage</th>
                    <th>Current</th>
                    <th>Active Power</th>
                    <th>Energy (kWh)</th>
                    <th>Power Factor</th>
                    <th>Accumulated Cost</th>
                    <th>Relay State</th>
                    <th>Recorded Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {dbLogs.length === 0 ? (
                    <tr>
                      <td colSpan="10" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                        No telemetry logs in database yet. Power up your ESP32 PZEM-004T to begin streaming.
                      </td>
                    </tr>
                  ) : (
                    dbLogs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>#{log.id}</span>
                        </td>
                        <td>
                          <strong>{log.device_id}</strong>
                        </td>
                        <td>{parseFloat(log.voltage).toFixed(1)} V</td>
                        <td>{parseFloat(log.current).toFixed(2)} A</td>
                        <td style={{ color: 'var(--cyan)', fontWeight: 700 }}>
                          {parseFloat(log.power).toFixed(1)} W
                        </td>
                        <td>{parseFloat(log.energy).toFixed(3)}</td>
                        <td>{parseFloat(log.pf).toFixed(2)}</td>
                        <td>₹{parseFloat(log.cost).toFixed(2)}</td>
                        <td>
                          <span style={{ color: log.is_load_on ? 'var(--emerald)' : 'var(--red)', fontWeight: 700 }}>
                            {log.is_load_on ? 'ON' : 'OFF'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {new Date(log.recorded_at).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Edit User & Change Password Modal */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Key size={18} style={{ color: 'var(--cyan)' }} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Edit Account Credentials</h3>
              </div>
              <button
                onClick={() => setEditingUser(null)}
                style={{ background: 'transparent', border: 0, color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Editing Account <strong>#{editingUser.id} ({editingUser.username})</strong>.
              You can update their username, email, access role, or set a new password.
            </p>

            <form onSubmit={handleUpdateUser}>
              <div className="input-wrap" style={{ marginBottom: '12px' }}>
                <label>Username</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  required
                />
              </div>

              <div className="input-wrap" style={{ marginBottom: '12px' }}>
                <label>Email Address</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                />
              </div>

              <div className="input-wrap" style={{ marginBottom: '12px' }}>
                <label>New Password (Leave blank to keep current password)</label>
                <input
                  type="password"
                  placeholder="Enter new password (optional)"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
              </div>

              <div className="input-wrap" style={{ marginBottom: '20px' }}>
                <label>Account Role</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  <option value="user">Consumer / Student User</option>
                  <option value="admin">Administrator (Super Admin)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  <Save size={14} />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
