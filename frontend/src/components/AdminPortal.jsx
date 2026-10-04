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
  HardDrive,
  Eye,
  DollarSign,
  Clock,
  FileText,
  AlertCircle
} from 'lucide-react';

export default function AdminPortal({ onSwitchToDashboard, onSwitchToLanding, onLogout, showToast }) {
  const [activeTab, setActiveTab] = useState('meters'); // 'meters', 'users', 'database'
  const [devices, setDevices] = useState([]);
  const [users, setUsers] = useState([]);

  // Database Stats & Logs
  const [dbOverview, setDbOverview] = useState(null);
  const [dbLogs, setDbLogs] = useState([]);
  const [loadingDb, setLoadingDb] = useState(false);

  // Meter Deep-Dive Inspection State
  const [inspectedMeterId, setInspectedMeterId] = useState(null);
  const [meterDetails, setMeterDetails] = useState(null);
  const [loadingMeterDetails, setLoadingMeterDetails] = useState(false);

  // Billing Update State for Inspected Meter
  const [billOverdue, setBillOverdue] = useState('');
  const [billPaid, setBillPaid] = useState('');
  const [billRecharge, setBillRecharge] = useState('1000.00');
  const [billBilledAmount, setBillBilledAmount] = useState('');
  const [billUnitPrice, setBillUnitPrice] = useState('');
  const [billNotes, setBillNotes] = useState('');

  // New Device Form State
  const [devId, setDevId] = useState('');
  const [devName, setDevName] = useState('');
  const [devKey, setDevKey] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [devPrice, setDevPrice] = useState('8.50');
  const [devRecharge, setDevRecharge] = useState('1000.00');

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

  const handleInspectMeter = async (meterId) => {
    setInspectedMeterId(meterId);
    setLoadingMeterDetails(true);
    try {
      const res = await fetchApi(`/api/admin/meters/${meterId}/details`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch meter details');

      setMeterDetails(data);
      setBillOverdue(data.device.overdue_amount !== undefined ? data.device.overdue_amount : '0.00');
      setBillPaid(data.device.paid_amount !== undefined ? data.device.paid_amount : '0.00');
      setBillRecharge(data.device.recharge_amount !== undefined ? data.device.recharge_amount : '1000.00');
      const currentBilled = parseFloat(data.device.locked_billed_cost || 0) > 0
        ? parseFloat(data.device.locked_billed_cost).toFixed(2)
        : (data.latest?.cost !== undefined ? parseFloat(data.latest.cost).toFixed(2) : '0.00');
      setBillBilledAmount(currentBilled);
      setBillUnitPrice(data.device.unit_price || '8.50');
      setBillNotes('');
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoadingMeterDetails(false);
    }
  };

  const triggerLocalEspSync = async (ip) => {
    if (!ip) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);
      await fetch(`http://${ip}/sync-now`, { signal: controller.signal, mode: 'no-cors' });
      clearTimeout(timeoutId);
    } catch (e) {
      // Local network call error can be ignored if admin is remote
    }
  };

  const handleUpdateBilling = async (e) => {
    e.preventDefault();
    if (!inspectedMeterId) return;

    try {
      const res = await fetchApi(`/api/admin/meters/${inspectedMeterId}/billing`, {
        method: 'PUT',
        body: JSON.stringify({
          overdueAmount: billOverdue,
          paidAmount: billPaid,
          rechargeAmount: billRecharge,
          billedAmount: billBilledAmount,
          unitPrice: billUnitPrice,
          notes: billNotes || 'Admin updated billing records and new tariff'
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update billing');

      showToast('Billing and next-order tariff rates successfully updated!');
      const mIp = meterDetails?.device?.local_ip || meterDetails?.device?.localIp;
      if (mIp) triggerLocalEspSync(mIp);
      handleInspectMeter(inspectedMeterId);
      loadData();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleResetAllMeterData = async () => {
    if (!inspectedMeterId) return;
    const confirmWipe = window.confirm(
      `⚠️ DANGER: Are you sure you want to permanently erase ALL historical telemetry and load sessions for meter "${inspectedMeterId}"?\n\nThis will wipe all historical telemetry, clear all load sessions, and signal the ESP32 hardware to reset its internal counters on its next sync.`
    );
    if (!confirmWipe) return;

    try {
      const res = await fetchApi(`/api/admin/meters/${inspectedMeterId}/reset-all`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset meter data');

      showToast('All past meter telemetry & session records erased successfully!');
      const mIp = meterDetails?.device?.local_ip || meterDetails?.device?.localIp;
      if (mIp) triggerLocalEspSync(mIp);
      handleInspectMeter(inspectedMeterId);
      loadData();
      loadDatabaseStats();
    } catch (err) {
      showToast(err.message);
    }
  };

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
          rechargeAmount: devRecharge
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
          <div className="tile-icon" style={{ background: '#e0f2fe', color: 'var(--cyan)' }}>
            <Cpu size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Registered Meters</div>
            <div className="tile-val">{devices.length}</div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ background: '#f3e8ff', color: 'var(--purple)' }}>
            <Users size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Total Accounts</div>
            <div className="tile-val">{users.length}</div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ background: '#ecfdf5', color: 'var(--emerald)' }}>
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
          <div className="tile-icon" style={{ background: '#f1f5f9', color: 'var(--blue)' }}>
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
                    placeholder="e.g. Second Floor Meter"
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
                    <label>Initial Tariff (₹/kWh)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={devPrice}
                      onChange={(e) => setDevPrice(e.target.value)}
                    />
                  </div>
                  <div className="input-wrap">
                    <label>Initial Prepaid Quota (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={devRecharge}
                      onChange={(e) => setDevRecharge(e.target.value)}
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
                ⚡ Meter Telemetry & Hourly Sync Notice
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.55', marginBottom: '14px' }}>
                Clicking on any meter in the fleet below opens its <strong>comprehensive live readings, billing dues manager, and online/offline history</strong>.
              </p>
              <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '12px 14px', borderRadius: '10px', fontSize: '0.78rem', color: 'var(--cyan)', fontFamily: 'monospace', marginBottom: '14px', wordBreak: 'break-all' }}>
                POST /api/device/telemetry<br />
                Headers: x-device-id, x-api-key
              </div>
              <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <li>Supports hourly batch reports or live telemetry stream.</li>
                <li>Admin can set <strong>Overdue Amount</strong> and <strong>Paid Amount</strong> per meter.</li>
                <li>New tariff rates applied by admin take effect for <strong>subsequent billing orders</strong>.</li>
                <li>System automatically logs exact timestamps when meters transition between <strong>ONLINE</strong> and <strong>OFFLINE</strong>.</li>
              </ul>
            </section>
          </div>

          {/* Fleet Table */}
          <section className="form-card glass">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                  📡 Active Smart Meter Fleet
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Click on any meter row to inspect live readings, assign overdue/paid amounts, and modify tariff rates.
                </p>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--cyan)', background: '#e0f2fe', padding: '4px 10px', borderRadius: '20px' }}>
                💡 Click any row to inspect
              </span>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Device ID</th>
                    <th>Name</th>
                    <th>Assigned Consumer</th>
                    <th>Tariff Rate</th>
                    <th>Overdue (₹)</th>
                    <th>Paid (₹)</th>
                    <th>Live Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                        No meters registered yet. Use the form above to provision your first ESP32 meter.
                      </td>
                    </tr>
                  ) : (
                    devices.map((d) => {
                      const isOnline = d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 35000;
                      return (
                        <tr
                          key={d.id}
                          className="clickable-row"
                          onClick={() => handleInspectMeter(d.id)}
                          title="Click to view all readings, billing records, and online/offline logs"
                        >
                          <td>
                            <strong>{d.id}</strong>
                          </td>
                          <td>{d.name}</td>
                          <td>{d.assigned_username || <span style={{ color: '#94a3b8' }}>Unassigned</span>}</td>
                          <td style={{ fontWeight: 700 }}>₹{parseFloat(d.unit_price).toFixed(2)}</td>
                          <td style={{ color: parseFloat(d.overdue_amount) > 0 ? 'var(--red)' : 'var(--text-secondary)', fontWeight: 700 }}>
                            ₹{parseFloat(d.overdue_amount || 0).toFixed(2)}
                          </td>
                          <td style={{ color: 'var(--emerald)', fontWeight: 700 }}>
                            ₹{parseFloat(d.paid_amount || 0).toFixed(2)}
                          </td>
                          <td>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                color: isOnline ? 'var(--emerald)' : 'var(--red)',
                                background: isOnline ? '#ecfdf5' : '#fef2f2',
                                padding: '3px 8px',
                                borderRadius: '12px'
                              }}
                            >
                              {isOnline ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                              {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: '8px' }}>
                              <button
                                onClick={() => handleInspectMeter(d.id)}
                                className="btn btn-outline"
                                style={{ padding: '6px 10px', fontSize: '0.75rem', color: 'var(--cyan)' }}
                                title="Inspect Meter & Manage Billing"
                              >
                                <Eye size={13} />
                                <span>Inspect</span>
                              </button>

                              <button
                                onClick={() => handleDeleteDevice(d)}
                                className="btn btn-danger"
                                style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                                title="Delete Meter"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
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
              <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800 }}>Connection Status</span>
                <p style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--emerald)', marginTop: '4px' }}>
                  ● {dbOverview?.status || 'Connected'}
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800 }}>Telemetry Logs in DB</span>
                <p style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--cyan)', marginTop: '4px' }}>
                  {dbOverview?.totalTelemetryLogs?.toLocaleString() || 0} rows
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800 }}>Total User Accounts</span>
                <p style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--purple)', marginTop: '4px' }}>
                  {dbOverview?.totalUsers || users.length} users
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800 }}>Latest Telemetry Timestamp</span>
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
                        <td style={{ color: 'var(--cyan)', fontWeight: 800 }}>
                          {parseFloat(log.power).toFixed(1)} W
                        </td>
                        <td>{parseFloat(log.energy).toFixed(3)}</td>
                        <td>{parseFloat(log.pf).toFixed(2)}</td>
                        <td style={{ fontWeight: 700 }}>₹{parseFloat(log.cost).toFixed(2)}</td>
                        <td>
                          <span style={{ color: log.is_load_on ? 'var(--emerald)' : 'var(--red)', fontWeight: 800 }}>
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

      {/* ======================================================== */}
      {/* METER DEEP-DIVE & BILLING INSPECTION MODAL */}
      {/* ======================================================== */}
      {inspectedMeterId && (
        <div className="modal-overlay" onClick={() => setInspectedMeterId(null)}>
          <div className="modal-box large" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Cpu size={22} style={{ color: 'var(--cyan)' }} />
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>
                    {meterDetails?.device?.name || inspectedMeterId}
                  </h3>
                  <span style={{ fontSize: '0.8rem', background: '#e0f2fe', color: 'var(--cyan)', padding: '3px 8px', borderRadius: '8px', fontWeight: 700 }}>
                    {inspectedMeterId}
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Assigned Consumer: <strong>{meterDetails?.device?.assigned_username || 'Unassigned'}</strong> ({meterDetails?.device?.assigned_email || 'N/A'})
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    color: meterDetails?.device?.isOnline ? 'var(--emerald)' : 'var(--red)',
                    background: meterDetails?.device?.isOnline ? '#ecfdf5' : '#fef2f2',
                    padding: '4px 10px',
                    borderRadius: '20px'
                  }}
                >
                  {meterDetails?.device?.isOnline ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {meterDetails?.device?.isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>

                {(meterDetails?.device?.local_ip || meterDetails?.device?.localIp) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ip = meterDetails.device.local_ip || meterDetails.device.localIp;
                      showToast(`Pinging meter at http://${ip}/sync-now...`);
                      await triggerLocalEspSync(ip);
                      setTimeout(() => handleInspectMeter(inspectedMeterId), 1000);
                      showToast('Instant sync signal sent to ESP32!');
                    }}
                    className="btn btn-outline"
                    style={{ fontSize: '0.74rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    title="Send immediate database sync signal to ESP32 over local network"
                  >
                    <RefreshCw size={12} />
                    <span>Sync ESP32 ({meterDetails.device.local_ip || meterDetails.device.localIp})</span>
                  </button>
                )}

                <button
                  onClick={() => setInspectedMeterId(null)}
                  style={{ background: 'transparent', border: 0, color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {loadingMeterDetails ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cyan)' }}>
                <RefreshCw size={24} className="spin-icon" style={{ marginBottom: '8px' }} />
                <p>Loading real-time meter telemetry and billing history...</p>
              </div>
            ) : (
              <>
                {/* Real-time Meter Readings Grid */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    ⚡ Real-Time Ingested Telemetry
                  </h4>
                  <div className="meter-detail-grid">
                    <div className="meter-detail-card">
                      <div className="label">Active Power</div>
                      <div className="value" style={{ color: 'var(--cyan)' }}>
                        {meterDetails?.latest ? parseFloat(meterDetails.latest.power).toFixed(1) : '0.0'} W
                      </div>
                    </div>

                    <div className="meter-detail-card">
                      <div className="label">True RMS Voltage</div>
                      <div className="value">
                        {meterDetails?.latest ? parseFloat(meterDetails.latest.voltage).toFixed(1) : '0.0'} V
                      </div>
                    </div>

                    <div className="meter-detail-card">
                      <div className="label">Line Current</div>
                      <div className="value">
                        {meterDetails?.latest ? parseFloat(meterDetails.latest.current).toFixed(2) : '0.00'} A
                      </div>
                    </div>

                    <div className="meter-detail-card">
                      <div className="label">Total Energy</div>
                      <div className="value" style={{ color: 'var(--emerald)' }}>
                        {meterDetails?.latest ? parseFloat(meterDetails.latest.energy).toFixed(3) : '0.000'} kWh
                      </div>
                    </div>

                    <div className="meter-detail-card">
                      <div className="label">Power Factor</div>
                      <div className="value">
                        {meterDetails?.latest ? parseFloat(meterDetails.latest.pf).toFixed(2) : '1.00'}
                      </div>
                    </div>

                    <div className="meter-detail-card">
                      <div className="label">Load State</div>
                      <div className="value" style={{ color: meterDetails?.latest?.is_load_on ? 'var(--emerald)' : 'var(--text-secondary)' }}>
                        {meterDetails?.latest?.is_load_on ? 'ON (Active)' : 'STANDBY'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Billing, Recharge & Tariff Rate Assignment Form */}
                <div style={{ background: '#f8fafc', padding: '18px 20px', borderRadius: '16px', border: '1px solid var(--border-subtle)', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <DollarSign size={18} style={{ color: 'var(--cyan)' }} />
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 800 }}>
                      Manage Quota, Billed Amount & Tariff Rates (Admin Only)
                    </h4>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                    Credit user recharges, declare already billed amounts, and revise tariffs.
                    <span style={{ color: 'var(--blue)', fontWeight: 700 }}> Any tariff increase applies strictly to the remaining units. Previously billed units stay locked at their old rate.</span>
                  </p>

                  {/* Real-time Calculation & Tariff Impact Preview */}
                  {(() => {
                    const rChg = parseFloat(billRecharge) || 0;
                    const bAmt = parseFloat(billBilledAmount) || 0;
                    const uPrc = parseFloat(billUnitPrice) || 8.50;
                    const prevBal = Math.max(0, rChg - bAmt);
                    const remUnits = uPrc > 0 ? (prevBal / uPrc) : 0;

                    return (
                      <div style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '12px 16px',
                        marginBottom: '16px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                          <div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Prepaid Quota</div>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--blue)' }}>₹{rChg.toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Locked Billed (Protected)</div>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--amber)' }}>₹{bAmt.toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Remaining Balance</div>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--emerald)' }}>₹{prevBal.toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>New Tariff Rate</div>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--cyan)' }}>₹{uPrc.toFixed(2)} / kWh</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Remaining Units Available</div>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--purple)' }}>{remUnits.toFixed(3)} kWh</div>
                          </div>
                        </div>

                        <div style={{ fontSize: '0.74rem', color: '#0369a1', background: '#e0f2fe', padding: '6px 10px', borderRadius: '8px', lineHeight: 1.4 }}>
                          ⚡ <strong>Tariff Protection Rule Active:</strong> Changing the tariff to <strong>₹{uPrc.toFixed(2)}/kWh</strong> will strictly apply to the remaining <strong>{remUnits.toFixed(3)} kWh</strong>. The already billed usage of <strong>₹{bAmt.toFixed(2)}</strong> is protected and cannot be retroactively increased.
                        </div>
                      </div>
                    );
                  })()}

                  <form onSubmit={handleUpdateBilling}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                      <div className="input-wrap">
                        <label>Recharge Quota Credited (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={billRecharge}
                          onChange={(e) => setBillRecharge(e.target.value)}
                          required
                        />
                      </div>

                      <div className="input-wrap">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <label style={{ margin: 0 }}>Already Billed Usage (₹)</label>
                          <button
                            type="button"
                            onClick={() => {
                              const currCost = parseFloat(meterDetails?.latest?.cost || 0);
                              setBillBilledAmount(currCost.toFixed(2));
                            }}
                            className="btn btn-outline"
                            style={{ fontSize: '0.7rem', padding: '2px 8px', lineHeight: 1 }}
                            title="Set billed amount to current meter consumption cost"
                          >
                            📍 Lock Current ₹{(parseFloat(meterDetails?.latest?.cost || 0)).toFixed(2)}
                          </button>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          value={billBilledAmount}
                          onChange={(e) => setBillBilledAmount(e.target.value)}
                          placeholder="Tell billed amount (e.g. 250.00)"
                          required
                        />
                      </div>

                      <div className="input-wrap">
                        <label>Overdue Dues Amount (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={billOverdue}
                          onChange={(e) => setBillOverdue(e.target.value)}
                          required
                        />
                      </div>

                      <div className="input-wrap">
                        <label>Tariff Unit Price (₹/kWh)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={billUnitPrice}
                          onChange={(e) => setBillUnitPrice(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="input-wrap" style={{ marginBottom: '14px' }}>
                      <label>Audit Log Note</label>
                      <input
                        type="text"
                        placeholder="e.g. Set billed to ₹300, increased tariff to ₹10/kWh for remaining units"
                        value={billNotes}
                        onChange={(e) => setBillNotes(e.target.value)}
                      />
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ padding: '8px 18px', fontSize: '0.82rem' }}>
                      <Save size={14} />
                      <span>Apply Quota, Billed Amount & Tariff</span>
                    </button>
                  </form>
                </div>

                {/* Reset Meter Data Danger Zone */}
                <div style={{ background: '#fef2f2', padding: '16px 20px', borderRadius: '16px', border: '1px solid #fecaca', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <h4 style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--red)', marginBottom: '3px' }}>
                        ⚠️ Erase & Reset All Past Meter Data
                      </h4>
                      <p style={{ fontSize: '0.78rem', color: '#991b1b', margin: 0 }}>
                        Permanently erases all historical telemetry, clears session records, resets counters to zero, and signals the ESP32 hardware to clear its internal memory on next sync.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetAllMeterData}
                      className="btn btn-danger"
                      style={{ padding: '8px 18px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                    >
                      <Trash2 size={14} />
                      <span>Erase All Meter Data</span>
                    </button>
                  </div>
                </div>

                {/* Online / Offline Status Logs */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Clock size={16} style={{ color: 'var(--purple)' }} />
                    <h4 style={{ fontSize: '0.88rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                      Online & Offline Transition Log History
                    </h4>
                  </div>

                  <div className="table-wrapper" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Recorded Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!meterDetails?.statusLogs || meterDetails.statusLogs.length === 0) ? (
                          <tr>
                            <td colSpan="2" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '12px' }}>
                              No state transitions recorded yet.
                            </td>
                          </tr>
                        ) : (
                          meterDetails.statusLogs.map((s) => (
                            <tr key={s.id}>
                              <td>
                                <span style={{
                                  color: s.status === 'ONLINE' ? 'var(--emerald)' : 'var(--red)',
                                  fontWeight: 800,
                                  background: s.status === 'ONLINE' ? '#ecfdf5' : '#fef2f2',
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  fontSize: '0.75rem'
                                }}>
                                  ● {s.status}
                                </span>
                              </td>
                              <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {new Date(s.timestamp).toLocaleString()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Billing History Table */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <FileText size={16} style={{ color: 'var(--blue)' }} />
                    <h4 style={{ fontSize: '0.88rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                      Billing & Tariff Audit History
                    </h4>
                  </div>

                  <div className="table-wrapper" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Unit Price (₹/kWh)</th>
                          <th>Overdue (₹)</th>
                          <th>Paid (₹)</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!meterDetails?.billingRecords || meterDetails.billingRecords.length === 0) ? (
                          <tr>
                            <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '12px' }}>
                              No billing audit entries yet.
                            </td>
                          </tr>
                        ) : (
                          meterDetails.billingRecords.map((b) => (
                            <tr key={b.id}>
                              <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                {new Date(b.created_at).toLocaleString()}
                              </td>
                              <td style={{ fontWeight: 700 }}>₹{parseFloat(b.unit_price_applied).toFixed(2)}</td>
                              <td style={{ color: 'var(--red)', fontWeight: 700 }}>₹{parseFloat(b.overdue_amount).toFixed(2)}</td>
                              <td style={{ color: 'var(--emerald)', fontWeight: 700 }}>₹{parseFloat(b.paid_amount).toFixed(2)}</td>
                              <td style={{ fontSize: '0.78rem' }}>{b.notes}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
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
