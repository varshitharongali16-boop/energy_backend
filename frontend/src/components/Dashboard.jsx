import React, { useState, useEffect, useRef } from 'react';
import { fetchApi } from '../api';
import Gauge from './Gauge';
import HistoryChart from './HistoryChart';
import {
  Zap,
  Activity,
  DollarSign,
  Clock,
  Settings,
  LogOut,
  Shield,
  Layers,
  TrendingUp,
  AlertTriangle,
  Volume2,
  VolumeX,
  Sparkles,
  Calendar
} from 'lucide-react';

export default function Dashboard({ user, onLogout, onSwitchToAdmin, onSwitchToLanding, showToast }) {
  const [meters, setMeters] = useState([]);
  const [selectedMeterId, setSelectedMeterId] = useState('');
  const [liveData, setLiveData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);

  // Settings & Overload Alarm
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [newUnits, setNewUnits] = useState('');
  const [overloadThreshold, setOverloadThreshold] = useState(2500);
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Interactive Demo Mode
  const [demoMode, setDemoMode] = useState(false);
  const simulatedEnergyRef = useRef(12.450);

  // Audio tone generator for alarms
  const playAlarmTone = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880Hz A5 note
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
      console.warn('Audio tone error', e);
    }
  };

  // Load meters assigned to this user
  useEffect(() => {
    async function loadMeters() {
      try {
        const res = await fetchApi('/api/meters');
        const data = await res.json();
        if (data.meters && data.meters.length > 0) {
          setMeters(data.meters);
          setSelectedMeterId(data.meters[0].id);
        } else {
          showToast('No smart meter assigned to this account.');
        }
      } catch (err) {
        showToast('Failed to load assigned meters');
      }
    }
    loadMeters();
  }, []);

  // Polling or Demo Simulator
  useEffect(() => {
    if (demoMode) {
      // Simulator generates fluctuating PZEM readings
      const simInterval = setInterval(() => {
        const simPower = Math.floor(600 + Math.random() * 2200 + (Math.sin(Date.now() / 2000) * 400));
        const simVoltage = 228 + (Math.random() * 8);
        const simCurrent = simPower / simVoltage;
        simulatedEnergyRef.current += (simPower / 3600000);
        const simEnergy = simulatedEnergyRef.current;
        const price = deviceInfo ? deviceInfo.unitPrice : 8.50;
        const allowed = deviceInfo ? deviceInfo.allowedUnits : 100.0;
        const cost = simEnergy * price;
        const unitsLeft = Math.max(0, allowed - simEnergy);
        const allowedAmount = allowed * price;
        const amountRem = Math.max(0, allowedAmount - cost);

        setLiveData({
          power: simPower,
          voltage: simVoltage,
          current: simCurrent,
          pf: 0.98,
          energy: simEnergy,
          cost: cost,
          is_load_on: simPower > 10,
          recorded_at: new Date().toISOString()
        });

        setAnalytics({
          unitsLeft,
          usedEnergy: simEnergy,
          totalAllowedAmount: allowedAmount,
          amountRemaining: amountRem,
          percentRemaining: (unitsLeft / allowed) * 100
        });

        if (simPower >= overloadThreshold) {
          playAlarmTone();
        }
      }, 1500);

      return () => clearInterval(simInterval);
    }

    if (!selectedMeterId) return;

    let isMounted = true;
    async function fetchLive() {
      try {
        const res = await fetchApi(`/api/meters/${selectedMeterId}/live`);
        const data = await res.json();
        if (!isMounted || !res.ok) return;

        setLiveData(data.live);
        setAnalytics(data.analytics);
        setDeviceInfo(data.device);

        const activePower = parseFloat(data.live.power) || 0;
        if (activePower >= overloadThreshold) {
          playAlarmTone();
        }
      } catch (err) {
        console.warn('Live poll error:', err);
      }
    }

    fetchLive();
    const interval = setInterval(fetchLive, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedMeterId, demoMode, overloadThreshold, soundEnabled]);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (demoMode) {
      setDeviceInfo((prev) => ({
        ...prev,
        unitPrice: parseFloat(newPrice),
        allowedUnits: parseFloat(newUnits)
      }));
      showToast('Settings saved for Demo mode!');
      setIsSettingsOpen(false);
      return;
    }

    if (!selectedMeterId) return;

    try {
      const res = await fetchApi(`/api/meters/${selectedMeterId}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ unitPrice: newPrice, allowedUnits: newUnits })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update settings');
      showToast('Settings saved! Syncing down to ESP32...');
      setIsSettingsOpen(false);
    } catch (err) {
      showToast(err.message);
    }
  };

  const power = liveData ? parseFloat(liveData.power) || 0 : 0;
  const isLoadOn = liveData ? Boolean(liveData.is_load_on) : false;
  const voltage = liveData ? parseFloat(liveData.voltage) || 0 : 0;
  const current = liveData ? parseFloat(liveData.current) || 0 : 0;
  const pf = liveData ? parseFloat(liveData.pf) || 0 : 0;
  const recordedAt = liveData && liveData.recorded_at ? new Date(liveData.recorded_at).toLocaleTimeString() : '--:--:--';

  const unitsLeft = analytics ? analytics.unitsLeft : 0;
  const usedEnergy = analytics ? analytics.usedEnergy : 0;
  const allowedUnits = deviceInfo ? deviceInfo.allowedUnits : 100;
  const unitPrice = deviceInfo ? deviceInfo.unitPrice : 8.50;
  const amountRemaining = analytics ? analytics.amountRemaining : 0;
  const totalCost = liveData ? parseFloat(liveData.cost) || 0 : 0;
  const totalAllowedAmount = analytics ? analytics.totalAllowedAmount : 0;
  const percentRemaining = analytics ? Math.min(Math.max(analytics.percentRemaining, 0), 100) : 100;
  const moneyPct = totalAllowedAmount > 0 ? Math.min(Math.max((amountRemaining / totalAllowedAmount) * 100, 0), 100) : 0;

  const isOnline = demoMode ? true : (deviceInfo ? deviceInfo.isOnline : false);
  const isOverloaded = power >= overloadThreshold;

  // Projections Math
  const hourlyBurnCost = (power / 1000) * unitPrice;
  const dailyProjectedKWh = (power / 1000) * 24;
  const dailyProjectedCost = dailyProjectedKWh * unitPrice;
  const monthlyProjectedCost = dailyProjectedCost * 30;
  const daysOfQuotaLeft = dailyProjectedKWh > 0 ? (unitsLeft / dailyProjectedKWh).toFixed(1) : '∞';

  return (
    <div className="container">
      {/* Top Header */}
      <header className="header glass">
        <div className="brand">
          <div className="brand-icon">
            <Zap size={24} />
          </div>
          <div>
            <h1 className="brand-title">VOLTRONIX CLOUD</h1>
            <p className="brand-subtitle">Smart Energy Monitor & Analytics</p>
          </div>
        </div>

        <div className="nav-actions">
          {/* Demo Mode Switch */}
          <div
            onClick={() => {
              setDemoMode(!demoMode);
              showToast(demoMode ? 'Switched to Live ESP32 Telemetry' : 'Demo Simulator Activated!');
            }}
            className={`demo-toggle ${demoMode ? 'active' : ''}`}
            title="Toggle simulated live energy data"
          >
            <Sparkles size={14} />
            <span>{demoMode ? 'DEMO ACTIVE' : 'DEMO MODE'}</span>
            <span className="demo-switch-dot"></span>
          </div>

          {/* Sound Alert Toggle */}
          <button
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              showToast(soundEnabled ? 'Alert sounds muted' : 'Alert sounds enabled');
            }}
            className="btn btn-outline"
            style={{ padding: '7px 11px', fontSize: '0.8rem' }}
            title={soundEnabled ? 'Mute alarm beeps' : 'Enable audio alarm beeps'}
          >
            {soundEnabled ? <Volume2 size={15} style={{ color: 'var(--cyan)' }} /> : <VolumeX size={15} />}
          </button>

          <div className="status-pill">
            <div className={`dot ${isOnline ? '' : 'offline'}`} />
            <span>{demoMode ? 'SIMULATOR LIVE' : (isOnline ? 'METER ONLINE' : 'METER OFFLINE')}</span>
          </div>

          <div className="user-badge">
            <span>{user.username}</span>
            <span className={`badge-role role-${user.role}`}>{user.role}</span>
          </div>

          {onSwitchToLanding && (
            <button
              onClick={onSwitchToLanding}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '7px 12px' }}
              title="View System Overview & Hardware Specs"
            >
              <Layers size={14} />
              <span>Intro</span>
            </button>
          )}

          {user.role === 'admin' && (
            <button
              onClick={onSwitchToAdmin}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '7px 12px' }}
            >
              <Shield size={14} />
              <span>Admin Hub</span>
            </button>
          )}

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

      {/* High Load Warning Banner */}
      {isOverloaded && (
        <div className="overload-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={20} style={{ color: 'var(--red)' }} />
            <div>
              <strong>HIGH POWER LOAD DETECTED: {power.toFixed(0)} Watts</strong>
              <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>
                Exceeded safety threshold of {overloadThreshold} W. Check connected high-draw appliances.
              </div>
            </div>
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, background: 'rgba(239,68,68,0.3)', padding: '4px 10px', borderRadius: '8px' }}>
            ALERT ACTIVE
          </span>
        </div>
      )}

      {/* Meter Select Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '18px',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Layers size={18} style={{ color: 'var(--cyan)' }} />
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Active Meter:
          </span>
          <select
            value={selectedMeterId}
            onChange={(e) => setSelectedMeterId(e.target.value)}
            style={{ width: 'auto', minWidth: '240px', padding: '8px 12px', fontSize: '0.88rem' }}
          >
            {meters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.id})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => {
            setNewPrice(unitPrice);
            setNewUnits(allowedUnits);
            setIsSettingsOpen(true);
          }}
          className="btn btn-outline"
          style={{ fontSize: '0.8rem', padding: '8px 16px' }}
        >
          <Settings size={15} />
          <span>Adjust Quota & Tariff</span>
        </button>
      </div>

      {/* Hero Power & Quota Row */}
      <section className="hero">
        <Gauge
          power={power}
          isLoadOn={isLoadOn}
          lastSeen={recordedAt}
          overloadLimit={overloadThreshold}
        />

        <div className="budget-card glass">
          <div className="card-top" style={{ marginBottom: '14px' }}>
            <span className="card-label">Quota & Budget Intelligence</span>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: percentRemaining < 20 ? 'var(--red)' : percentRemaining < 50 ? 'var(--amber)' : 'var(--emerald)'
              }}
            >
              {Math.round(percentRemaining)}% REMAINING
            </span>
          </div>

          {/* Units Left */}
          <div className="metric-group">
            <div className="metric-header">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Units Left</span>
              <div className="metric-val" style={{ color: 'var(--cyan)' }}>
                {unitsLeft.toFixed(3)}{' '}
                <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)' }}>kWh</span>
              </div>
            </div>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{
                  width: `${percentRemaining}%`,
                  background: 'linear-gradient(90deg, #00f0ff, #3b82f6)'
                }}
              />
            </div>
            <div className="metric-meta">
              <span>Used: <strong>{usedEnergy.toFixed(3)}</strong> kWh</span>
              <span>Allocated: <strong>{allowedUnits}</strong> kWh</span>
            </div>
          </div>

          {/* Money Balance */}
          <div className="metric-group">
            <div className="metric-header">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Account Balance</span>
              <div className="metric-val" style={{ color: 'var(--emerald)' }}>
                ₹{amountRemaining.toFixed(2)}
              </div>
            </div>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{
                  width: `${moneyPct}%`,
                  background: 'linear-gradient(90deg, #10b981, #00f0ff)'
                }}
              />
            </div>
            <div className="metric-meta">
              <span>Billed: ₹<strong>{totalCost.toFixed(2)}</strong></span>
              <span>Cap: ₹<strong>{totalAllowedAmount.toFixed(2)}</strong></span>
            </div>
          </div>
        </div>
      </section>

      {/* Bill & Cost Projections Card */}
      <section className="projection-card glass">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={18} style={{ color: 'var(--cyan)' }} />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>Smart Billing Projections & Run Rate</h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Calculated based on active wattage & ₹{unitPrice.toFixed(2)}/kWh tariff
          </span>
        </div>

        <div className="projection-grid">
          <div className="projection-item">
            <span className="projection-label">Current Burn Rate</span>
            <div className="projection-val" style={{ color: 'var(--cyan)' }}>
              ₹{hourlyBurnCost.toFixed(2)} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>/hr</span>
            </div>
          </div>

          <div className="projection-item">
            <span className="projection-label">Daily Projected Cost</span>
            <div className="projection-val" style={{ color: 'var(--amber)' }}>
              ₹{dailyProjectedCost.toFixed(2)} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>/day</span>
            </div>
          </div>

          <div className="projection-item">
            <span className="projection-label">Monthly Estimated Bill</span>
            <div className="projection-val" style={{ color: 'var(--purple)' }}>
              ₹{monthlyProjectedCost.toFixed(0)} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>/mo</span>
            </div>
          </div>

          <div className="projection-item">
            <span className="projection-label">Estimated Quota Runway</span>
            <div className="projection-val" style={{ color: 'var(--emerald)' }}>
              {daysOfQuotaLeft} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>days left</span>
            </div>
          </div>
        </div>
      </section>

      {/* Metric Tiles Grid */}
      <section className="grid">
        <div className="tile glass">
          <div className="tile-icon" style={{ color: '#00f0ff' }}>
            <Zap size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Line Voltage</div>
            <div className="tile-val">
              {voltage.toFixed(1)}
              <span className="tile-unit">V</span>
            </div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: '#a855f7' }}>
            <Activity size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Current Draw</div>
            <div className="tile-val">
              {current.toFixed(3)}
              <span className="tile-unit">A</span>
            </div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: '#f59e0b' }}>
            <Clock size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Power Factor</div>
            <div className="tile-val">
              {pf.toFixed(2)}
              <span className="tile-unit">PF</span>
            </div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: '#10b981' }}>
            <DollarSign size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Tariff Rate</div>
            <div className="tile-val">
              ₹{unitPrice.toFixed(2)}
              <span className="tile-unit">/kWh</span>
            </div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: 'var(--red)' }}>
            <AlertTriangle size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Overdue Dues</div>
            <div className="tile-val" style={{ color: 'var(--red)' }}>
              ₹{deviceInfo ? parseFloat(deviceInfo.overdueAmount || 0).toFixed(2) : '0.00'}
            </div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: 'var(--emerald)' }}>
            <DollarSign size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Total Paid</div>
            <div className="tile-val" style={{ color: 'var(--emerald)' }}>
              ₹{deviceInfo ? parseFloat(deviceInfo.paidAmount || 0).toFixed(2) : '0.00'}
            </div>
          </div>
        </div>
      </section>

      {/* Historical Telemetry Chart with Export CSV */}
      <HistoryChart meterId={selectedMeterId} />

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: '6px' }}>
              Update Quota & Alarm Thresholds
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              New values will be saved in PostgreSQL and synced to the ESP32.
            </p>

            <form onSubmit={handleSaveSettings}>
              <div className="input-wrap" style={{ marginBottom: '14px' }}>
                <label>Price Per Unit (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  required
                />
              </div>

              <div className="input-wrap" style={{ marginBottom: '14px' }}>
                <label>Allowed Quota Units (kWh)</label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  value={newUnits}
                  onChange={(e) => setNewUnits(e.target.value)}
                  required
                />
              </div>

              <div className="input-wrap" style={{ marginBottom: '20px' }}>
                <label>High Load Alarm Threshold (Watts)</label>
                <input
                  type="number"
                  step="50"
                  min="100"
                  value={overloadThreshold}
                  onChange={(e) => setOverloadThreshold(parseFloat(e.target.value) || 2500)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
