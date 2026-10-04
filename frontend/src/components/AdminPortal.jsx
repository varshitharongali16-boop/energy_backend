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
  XCircle
} from 'lucide-react';

export default function AdminPortal({ onSwitchToDashboard, onLogout, showToast }) {
  const [devices, setDevices] = useState([]);
  const [users, setUsers] = useState([]);

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

  useEffect(() => {
    loadData();
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

      showToast('User created successfully!');
      setUsername('');
      setEmail('');
      setPassword('');
      loadData();
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
            <Zap size={24} />
          </div>
          <div>
            <h1 className="brand-title">ADMIN MASTER HUB</h1>
            <p className="brand-subtitle">ESP32 Fleet & Consumer Account Management</p>
          </div>
        </div>

        <div className="nav-actions">
          <button
            onClick={onSwitchToDashboard}
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '7px 12px' }}
          >
            <ArrowLeft size={14} />
            <span>Live Dashboard</span>
          </button>

          <button
            onClick={onLogout}
            className="btn btn-danger"
            style={{ fontSize: '0.8rem', padding: '7px 12px' }}
          >
            <LogOut size={14} />
            <span>Log Out</span>
          </button>
        </div>
      </header>

      {/* Stats Overview */}
      <section className="grid">
        <div className="tile glass">
          <div className="tile-icon" style={{ color: '#00f0ff' }}>
            <Cpu size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Registered Meters</div>
            <div className="tile-val">{devices.length}</div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: '#a855f7' }}>
            <Users size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Consumer Users</div>
            <div className="tile-val">{users.length}</div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: '#10b981' }}>
            <ShieldCheck size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Security Role</div>
            <div className="tile-val" style={{ fontSize: '1.15rem', color: 'var(--emerald)' }}>
              SUPER ADMIN
            </div>
          </div>
        </div>
      </section>

      {/* Forms Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px',
          marginBottom: '22px'
        }}
      >
        {/* Register Meter Form */}
        <section className="form-card glass">
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
            📟 Provision New ESP32 Meter
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Assign a Device ID and secret API key to ingest readings.
          </p>

          <form onSubmit={handleRegisterDevice}>
            <div className="input-wrap" style={{ marginBottom: '12px' }}>
              <label>Device ID (Matches ESP32 code)</label>
              <input
                type="text"
                placeholder="ESP32_METER_02"
                value={devId}
                onChange={(e) => setDevId(e.target.value)}
                required
              />
            </div>

            <div className="input-wrap" style={{ marginBottom: '12px' }}>
              <label>Display Name</label>
              <input
                type="text"
                placeholder="Second Floor Meter"
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
                required
              />
            </div>

            <div className="input-wrap" style={{ marginBottom: '12px' }}>
              <label>Device API Key</label>
              <input
                type="text"
                placeholder="meter_secret_xyz_456"
                value={devKey}
                onChange={(e) => setDevKey(e.target.value)}
                required
              />
            </div>

            <div className="input-wrap" style={{ marginBottom: '12px' }}>
              <label>Assign to Consumer</label>
              <select
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
              >
                <option value="">-- Unassigned --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.email})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div className="input-wrap">
                <label>Unit Price (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={devPrice}
                  onChange={(e) => setDevPrice(e.target.value)}
                />
              </div>
              <div className="input-wrap">
                <label>Quota (kWh)</label>
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
              <span>Provision Meter</span>
            </button>
          </form>
        </section>

        {/* Create User Form */}
        <section className="form-card glass">
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
            👤 Create Consumer Account
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Create credentials for meter owners to log in.
          </p>

          <form onSubmit={handleCreateUser}>
            <div className="input-wrap" style={{ marginBottom: '12px' }}>
              <label>Username</label>
              <input
                type="text"
                placeholder="john_doe"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="input-wrap" style={{ marginBottom: '12px' }}>
              <label>Email Address</label>
              <input
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="input-wrap" style={{ marginBottom: '12px' }}>
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="input-wrap" style={{ marginBottom: '18px' }}>
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="user">Consumer User</option>
                <option value="admin">Administrator</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              <PlusCircle size={16} />
              <span>Create Account</span>
            </button>
          </form>
        </section>
      </div>

      {/* Fleet Table */}
      <section className="form-card glass" style={{ marginBottom: '22px' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
          📡 Smart Meter Fleet
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          Real-time status of all registered ESP32 meters.
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
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Users Table */}
      <section className="form-card glass">
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
          👥 Registered Accounts
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          System administrator and consumer credentials.
        </p>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Meters</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge-role role-${u.role}`}>{u.role}</span>
                  </td>
                  <td>{u.meter_count} meter(s)</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
