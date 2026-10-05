import React, { useState, useEffect } from 'react';
import { fetchApi } from '../api';
import Gauge from './Gauge';
import HistoryChart from './HistoryChart';
import {
  Zap,
  Activity,
  DollarSign,
  Clock,
  LogOut,
  Shield,
  Layers,
  TrendingUp,
  AlertTriangle,
  Volume2,
  VolumeX,
  Calendar,
  ListFilter,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  ArrowUpRight,
  Lock
} from 'lucide-react';

// Helper to dynamically load Razorpay Checkout Script
function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function Dashboard({ user, onLogout, onSwitchToAdmin, onSwitchToLanding, showToast }) {
  const [meters, setMeters] = useState([]);
  const [selectedMeterId, setSelectedMeterId] = useState('');
  const [liveData, setLiveData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);

  // Sessions and Monthly History
  const [sessions, setSessions] = useState([]);
  const [sessionSummary, setSessionSummary] = useState(null);
  const [monthlyRecords, setMonthlyRecords] = useState([]);

  // Razorpay Recharge States
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [rechargeAmountInput, setRechargeAmountInput] = useState(500);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [rechargeHistory, setRechargeHistory] = useState([]);

  // Alarm threshold
  const [overloadThreshold, setOverloadThreshold] = useState(2500);
  const [soundEnabled, setSoundEnabled] = useState(false);

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

  // Poll live telemetry every 3s
  useEffect(() => {
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
    const interval = setInterval(fetchLive, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedMeterId, overloadThreshold, soundEnabled]);

  // Load sessions, monthly history, and recharge logs when selected meter changes
  useEffect(() => {
    if (!selectedMeterId) return;

    async function fetchHistoryTables() {
      try {
        const [sessRes, monthRes, rchRes] = await Promise.all([
          fetchApi(`/api/meters/${selectedMeterId}/sessions`),
          fetchApi(`/api/meters/${selectedMeterId}/monthly`),
          fetchApi(`/api/meters/${selectedMeterId}/recharges`)
        ]);

        const sessData = await sessRes.json();
        const monthData = await monthRes.json();
        const rchData = await rchRes.json();

        if (sessRes.ok && sessData.sessions) {
          setSessions(sessData.sessions);
          setSessionSummary(sessData.summary);
        }
        if (monthRes.ok && monthData.months) {
          setMonthlyRecords(monthData.months);
        }
        if (rchRes.ok && rchData.transactions) {
          setRechargeHistory(rchData.transactions);
        }
      } catch (err) {
        console.warn('History tables fetch error:', err);
      }
    }

    fetchHistoryTables();
    const interval = setInterval(fetchHistoryTables, 15000);
    return () => clearInterval(interval);
  }, [selectedMeterId]);

  const triggerLocalEspSync = async (ip) => {
    if (!ip) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);
      await fetch(`http://${ip}/sync-now`, { signal: controller.signal, mode: 'no-cors' });
      clearTimeout(timeoutId);
    } catch (e) {}
  };

  // Handle direct Razorpay online bank/UPI recharge
  const handleRazorpayRecharge = async (amountToPay) => {
    const amt = parseFloat(amountToPay || rechargeAmountInput);
    if (isNaN(amt) || amt < 1) {
      showToast('Please enter a valid recharge amount (minimum ₹1.00)');
      return;
    }

    setRechargeLoading(true);
    try {
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded) {
        showToast('Unable to load Razorpay payment gateway. Please verify your internet connection.');
        setRechargeLoading(false);
        return;
      }

      // Step 1: Request verified order from server
      const orderRes = await fetchApi('/api/payments/create-order', {
        method: 'POST',
        body: JSON.stringify({ meterId: selectedMeterId, amount: amt })
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        showToast(orderData.error || 'Failed to initialize payment order');
        setRechargeLoading(false);
        return;
      }

      // Step 2: Open official Razorpay Checkout Window
      const options = {
        key: orderData.keyId || 'rzp_test_TKTk2IuoVuHf8v',
        amount: orderData.order.amount,
        currency: orderData.order.currency || 'INR',
        name: 'Voltronix Energy',
        description: `Prepaid Recharge for ${deviceInfo?.name || selectedMeterId}`,
        order_id: orderData.order.id,
        handler: async function (response) {
          try {
            showToast('Payment successful! Crediting meter balance...');
            const verifyRes = await fetchApi('/api/payments/verify', {
              method: 'POST',
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id || null,
                razorpay_signature: response.razorpay_signature || null,
                meterId: selectedMeterId,
                amount: amt
              })
            });
            const verifyData = await verifyRes.json();
            if (verifyRes.ok) {
              showToast(`🎉 ₹${amt.toFixed(2)} credited successfully to meter!`);
              setShowRechargeModal(false);
              // Trigger instant live refresh
              const liveRes = await fetchApi(`/api/meters/${selectedMeterId}/live`);
              const liveJson = await liveRes.json();
              if (liveRes.ok) {
                setLiveData(liveJson.live);
                setAnalytics(liveJson.analytics);
                setDeviceInfo(liveJson.device);
              }
              // Refresh recharge history
              const rchRes = await fetchApi(`/api/meters/${selectedMeterId}/recharges`);
              const rchJson = await rchRes.json();
              if (rchRes.ok && rchJson.transactions) {
                setRechargeHistory(rchJson.transactions);
              }
              // Immediately signal ESP32 hardware display to refresh
              triggerLocalEspSync(deviceInfo?.local_ip || deviceInfo?.localIp);
            } else {
              showToast(verifyData.error || 'Payment verification failed');
            }
          } catch (err) {
            showToast('Error finalizing recharge');
          } finally {
            setRechargeLoading(false);
          }
        },
        prefill: {
          name: user.username,
          email: user.email || `${user.username}@energymeter.com`,
          contact: '9999999999'
        },
        notes: {
          meterId: selectedMeterId,
          userId: user.id
        },
        theme: {
          color: '#0284c7'
        },
        modal: {
          ondismiss: function () {
            setRechargeLoading(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (resp) {
        setRechargeLoading(false);
        showToast('Payment Cancelled / Incomplete: ' + (resp.error?.description || 'Transaction not completed'));
      });
      rzp.open();
    } catch (err) {
      console.error('Payment checkout error:', err);
      showToast('Failed to start payment gateway');
      setRechargeLoading(false);
    }
  };

  // Metrics extraction
  const power = liveData ? parseFloat(liveData.power) || 0 : 0;
  const isLoadOn = liveData ? Boolean(liveData.is_load_on) : false;
  const voltage = liveData ? parseFloat(liveData.voltage) || 0 : 0;
  const current = liveData ? parseFloat(liveData.current) || 0 : 0;
  const pf = liveData ? parseFloat(liveData.pf) || 0 : 0;
  const recordedAt = liveData && liveData.recorded_at ? new Date(liveData.recorded_at).toLocaleTimeString() : '--:--:--';

  const usedEnergy = analytics ? analytics.usedEnergy : 0;
  const unitPrice = deviceInfo ? deviceInfo.unitPrice : 8.50;
  const rechargeAmount = analytics ? analytics.rechargeAmount : 1000.0;
  const billedAmount = analytics ? analytics.billedAmount : 0;
  const accountBalance = analytics ? analytics.accountBalance : 0;
  const overdueAmount = analytics ? analytics.overdueAmount : 0;
  const unitsAvailable = analytics ? analytics.unitsAvailable : 0;
  const balancePercent = analytics ? analytics.balancePercent : 0;

  const isOnline = deviceInfo ? deviceInfo.isOnline : false;
  const isOverloaded = power >= overloadThreshold;

  // Projections Math
  const hourlyBurnCost = (power / 1000) * unitPrice;
  const dailyProjectedKWh = (power / 1000) * 24;
  const dailyProjectedCost = dailyProjectedKWh * unitPrice;
  const monthlyProjectedCost = dailyProjectedCost * 30;

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
            <span>{isOnline ? 'METER ONLINE' : 'METER OFFLINE'}</span>
          </div>

          <div className="user-badge">
            <span>{user.username}</span>
            <span className={`badge-role role-${user.role}`}>{user.role}</span>
          </div>

          <button
            onClick={() => setShowRechargeModal(true)}
            className="btn btn-primary"
            style={{
              fontSize: '0.8rem',
              padding: '7px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              fontWeight: 800,
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
            }}
          >
            <CreditCard size={14} />
            <span>⚡ Recharge</span>
          </button>

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

      {/* Overdue Alert Banner if overdue > 0 */}
      {overdueAmount > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderRadius: '16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          marginBottom: '18px',
          boxShadow: '0 2px 10px rgba(239,68,68,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertCircle size={22} style={{ color: 'var(--red)' }} />
            <div>
              <strong style={{ fontSize: '0.95rem' }}>Outstanding Dues Notice: ₹{overdueAmount.toFixed(2)}</strong>
              <div style={{ fontSize: '0.78rem', opacity: 0.9 }}>
                Recharge balance has been depleted. Please contact your administrator to recharge your account.
              </div>
            </div>
          </div>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, background: '#fee2e2', color: 'var(--red)', padding: '5px 12px', borderRadius: '20px' }}>
            PAYMENT DUE
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

        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          🔒 Tariff rate: <strong>₹{unitPrice.toFixed(2)}/kWh</strong> (Admin configured)
        </div>
      </div>

      {/* Hero Power & Quota Row */}
      <section className="hero">
        <Gauge
          power={power}
          isLoadOn={isLoadOn}
          lastSeen={recordedAt}
          overloadLimit={overloadThreshold}
        />

        {/* Prepaid Recharge & Energy Balance Card */}
        <div className="budget-card glass">
          <div className="card-top" style={{ marginBottom: '14px' }}>
            <span className="card-label">Prepaid Balance & Energy Quota</span>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 800,
                color: balancePercent < 20 ? 'var(--red)' : balancePercent < 50 ? 'var(--amber)' : 'var(--emerald)'
              }}
            >
              {Math.round(balancePercent)}% BALANCE LEFT
            </span>
          </div>

          {/* Account Balance */}
          <div className="metric-group">
            <div className="metric-header">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Available Account Balance</span>
              <div className="metric-val" style={{ color: accountBalance > 0 ? 'var(--emerald)' : 'var(--red)' }}>
                ₹{accountBalance.toFixed(2)}
              </div>
            </div>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{
                  width: `${balancePercent}%`,
                  background: balancePercent < 20
                    ? 'linear-gradient(90deg, #ef4444, #f59e0b)'
                    : 'linear-gradient(90deg, #10b981, #0284c7)'
                }}
              />
            </div>
            <div className="metric-meta">
              <span>Recharged: <strong>₹{rechargeAmount.toFixed(2)}</strong></span>
              <span>Consumed: <strong>₹{billedAmount.toFixed(2)}</strong></span>
            </div>
          </div>

          {/* Units Remaining based on Balance */}
          <div className="metric-group" style={{ marginTop: '16px' }}>
            <div className="metric-header">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Units Available from Balance</span>
              <div className="metric-val" style={{ color: 'var(--cyan)' }}>
                {unitsAvailable.toFixed(3)}{' '}
                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>kWh</span>
              </div>
            </div>
            <div className="metric-meta" style={{ marginTop: '4px' }}>
              <span>Total Energy Consumed: <strong>{usedEnergy.toFixed(3)}</strong> kWh</span>
              {overdueAmount > 0 && (
                <span style={{ color: 'var(--red)', fontWeight: 800 }}>Overdue: ₹{overdueAmount.toFixed(2)}</span>
              )}
            </div>
          </div>

          {/* Quick Razorpay Direct Bank / UPI Recharge Action */}
          <div style={{
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Direct Bank / UPI Top-Up
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Instant balance credit via Razorpay Gateway
              </div>
            </div>

            <button
              onClick={() => setShowRechargeModal(true)}
              className="btn btn-primary"
              style={{
                fontSize: '0.82rem',
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)'
              }}
            >
              <CreditCard size={15} />
              <span>⚡ Recharge Balance</span>
            </button>
          </div>
        </div>
      </section>

      {/* Bill & Cost Projections Card */}
      <section className="projection-card glass">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={18} style={{ color: 'var(--cyan)' }} />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>Billing Run Rate & Consumption Projections</h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Calculated at active draw of {power.toFixed(0)}W & ₹{unitPrice.toFixed(2)}/kWh tariff
          </span>
        </div>

        <div className="projection-grid">
          <div className="projection-item">
            <span className="projection-label">Active Burn Rate</span>
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
            <span className="projection-label">Active Power Draw</span>
            <div className="projection-val" style={{ color: 'var(--emerald)' }}>
              {power.toFixed(1)} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Watts</span>
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
            <div className="tile-label">Tariff Unit Price</div>
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
            <div className="tile-val" style={{ color: overdueAmount > 0 ? 'var(--red)' : 'var(--text-primary)' }}>
              ₹{overdueAmount.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="tile glass">
          <div className="tile-icon" style={{ color: 'var(--emerald)' }}>
            <DollarSign size={22} />
          </div>
          <div className="tile-body">
            <div className="tile-label">Total Recharged</div>
            <div className="tile-val" style={{ color: 'var(--emerald)' }}>
              ₹{rechargeAmount.toFixed(2)}
            </div>
          </div>
        </div>
      </section>

      {/* Load Sessions Breakdown Table */}
      <section className="form-card glass" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ListFilter size={18} style={{ color: 'var(--cyan)' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Load Sessions & Energy Breakdown</h3>
          </div>
          {sessionSummary && (
            <div style={{ display: 'flex', gap: '14px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span>Total Sessions: <strong>{sessionSummary.totalSessions}</strong></span>
              <span>Total Session Units: <strong style={{ color: 'var(--cyan)' }}>{sessionSummary.totalSessionUnits} kWh</strong></span>
              <span>Session Cost: <strong style={{ color: 'var(--emerald)' }}>₹{sessionSummary.totalSessionCost}</strong></span>
            </div>
          )}
        </div>

        <div className="table-wrapper" style={{ maxHeight: '280px', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Session #</th>
                <th>Start Time</th>
                <th>Stop Time</th>
                <th>Duration</th>
                <th>Peak Load (W)</th>
                <th>Energy (kWh)</th>
                <th>Session Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                    No recorded load sessions yet. Turn on a connected appliance to record session analytics.
                  </td>
                </tr>
              ) : (
                sessions.map((sess, idx) => (
                  <tr key={sess.id || idx}>
                    <td><strong>#{sessions.length - idx}</strong></td>
                    <td style={{ fontSize: '0.8rem' }}>{sess.start_time ? new Date(sess.start_time).toLocaleString() : '--'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{sess.stop_time ? new Date(sess.stop_time).toLocaleString() : 'In Progress'}</td>
                    <td>{Math.floor((sess.duration_seconds || 0) / 60)}m {((sess.duration_seconds || 0) % 60)}s</td>
                    <td style={{ fontWeight: 700, color: 'var(--cyan)' }}>{parseFloat(sess.peak_power || 0).toFixed(1)} W</td>
                    <td style={{ fontWeight: 700 }}>{parseFloat(sess.energy_kwh || 0).toFixed(3)} kWh</td>
                    <td style={{ fontWeight: 800, color: 'var(--emerald)' }}>₹{parseFloat(sess.session_cost || 0).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Monthly Consumption & Dues History Table */}
      <section className="form-card glass" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <Calendar size={18} style={{ color: 'var(--purple)' }} />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Monthly Energy & Dues Breakdown</h3>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Units Consumed (kWh)</th>
                <th>Total Billed Amount</th>
                <th>Recharged Funds</th>
                <th>Overdue Status</th>
                <th>Payment Status</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRecords.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                    Monthly consumption ledger will populate as telemetry is aggregated.
                  </td>
                </tr>
              ) : (
                monthlyRecords.map((m, idx) => (
                  <tr key={m.month_key || idx}>
                    <td><strong>{m.month_label || m.month_key}</strong></td>
                    <td style={{ fontWeight: 700, color: 'var(--cyan)' }}>{parseFloat(m.units_kwh || 0).toFixed(3)} kWh</td>
                    <td style={{ fontWeight: 800 }}>₹{parseFloat(m.billed_amount || 0).toFixed(2)}</td>
                    <td style={{ color: 'var(--emerald)', fontWeight: 700 }}>₹{parseFloat(m.recharged_amount || 0).toFixed(2)}</td>
                    <td style={{ color: parseFloat(m.overdue_amount || 0) > 0 ? 'var(--red)' : 'var(--text-secondary)', fontWeight: 700 }}>
                      ₹{parseFloat(m.overdue_amount || 0).toFixed(2)}
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '8px',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        background: m.status === 'DUE' ? '#fef2f2' : '#ecfdf5',
                        color: m.status === 'DUE' ? 'var(--red)' : 'var(--emerald)'
                      }}>
                        ● {m.status || 'ACTIVE'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Online Recharge & Top-Up History Table */}
      <section className="form-card glass" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CreditCard size={18} style={{ color: 'var(--emerald)' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Prepaid Recharge & Bank Payment History</h3>
          </div>
          <button
            onClick={() => setShowRechargeModal(true)}
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>+ Recharge Now</span>
          </button>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Transaction ID</th>
                <th>Payment Mode</th>
                <th>Amount Added</th>
                <th>Balance After</th>
                <th>Payment Status</th>
              </tr>
            </thead>
            <tbody>
              {rechargeHistory.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                    No recharge transactions recorded yet. Click <strong>Recharge Balance</strong> above to add prepaid energy credits via UPI/Bank account.
                  </td>
                </tr>
              ) : (
                rechargeHistory.map((r, idx) => (
                  <tr key={r.id || idx}>
                    <td style={{ fontSize: '0.8rem' }}>{new Date(r.created_at).toLocaleString()}</td>
                    <td>
                      <code style={{ fontSize: '0.78rem', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                        {r.payment_id || `TXN_${r.id}`}
                      </code>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--cyan)' }}>
                        {r.payment_method === 'RAZORPAY' ? '⚡ Razorpay Bank/UPI' : (r.payment_method || 'MANUAL')}
                      </span>
                    </td>
                    <td style={{ fontWeight: 800, color: 'var(--emerald)', fontSize: '0.95rem' }}>
                      +₹{parseFloat(r.amount).toFixed(2)}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      ₹{parseFloat(r.new_balance || 0).toFixed(2)}
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '8px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        background: '#ecfdf5',
                        color: 'var(--emerald)'
                      }}>
                        ● {r.status || 'SUCCESS'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historical Telemetry Chart with Export CSV */}
      <HistoryChart meterId={selectedMeterId} />

      {/* Razorpay Online Recharge Modal */}
      {showRechargeModal && (
        <div className="modal-overlay" onClick={() => !rechargeLoading && setShowRechargeModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
                }}>
                  <CreditCard size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 900 }}>Recharge Energy Balance</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Direct Bank Account, UPI & Card Top-Up</p>
                </div>
              </div>
              <button
                disabled={rechargeLoading}
                onClick={() => setShowRechargeModal(false)}
                style={{ background: 'transparent', border: 0, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Target Smart Meter:</span>
                <strong>{deviceInfo?.name || selectedMeterId}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Current Available Balance:</span>
                <strong style={{ color: accountBalance > 0 ? 'var(--emerald)' : 'var(--red)' }}>₹{accountBalance.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Applicable Unit Tariff:</span>
                <span><strong>₹{unitPrice.toFixed(2)}</strong> / kWh</span>
              </div>
            </div>

            {/* Amount Selection */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Select Recharge Preset (₹):
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' }}>
                {[100, 250, 500, 1000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRechargeAmountInput(preset)}
                    className="btn"
                    style={{
                      padding: '8px 0',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      background: rechargeAmountInput === preset ? 'linear-gradient(135deg, #0284c7, #2563eb)' : '#ffffff',
                      color: rechargeAmountInput === preset ? '#ffffff' : 'var(--text-primary)',
                      border: '1px solid',
                      borderColor: rechargeAmountInput === preset ? '#0284c7' : 'var(--border-subtle)',
                      boxShadow: rechargeAmountInput === preset ? '0 4px 10px rgba(2, 132, 199, 0.25)' : 'none'
                    }}
                  >
                    ₹{preset}
                  </button>
                ))}
              </div>

              <div className="input-wrap">
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Custom Amount (₹)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={rechargeAmountInput}
                  onChange={(e) => setRechargeAmountInput(Math.max(1, parseFloat(e.target.value) || 0))}
                  placeholder="Enter amount in ₹"
                  style={{ fontSize: '1.15rem', fontWeight: 800, padding: '10px 14px' }}
                />
              </div>

              <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Estimated Energy Units:</span>
                <strong style={{ color: 'var(--cyan)' }}>
                  ~{unitPrice > 0 ? (rechargeAmountInput / unitPrice).toFixed(1) : 0} kWh
                </strong>
              </div>
            </div>

            {/* Payment Gateway Trust Badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 14px', borderRadius: '10px',
              background: '#ecfdf5', border: '1px solid #a7f3d0',
              color: '#065f46', fontSize: '0.75rem', marginBottom: '18px'
            }}>
              <Lock size={15} style={{ flexShrink: 0 }} />
              <div>
                <strong>Secured by Razorpay:</strong> Instant verification with Netbanking (SBI, HDFC, ICICI, etc.), UPI (Google Pay, PhonePe), and Debit/Credit Cards.
              </div>
            </div>

            <button
              onClick={() => handleRazorpayRecharge()}
              disabled={rechargeLoading}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '0.95rem',
                fontWeight: 800,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                background: 'linear-gradient(135deg, #0284c7, #2563eb)'
              }}
            >
              <CreditCard size={18} />
              <span>{rechargeLoading ? 'Contacting Payment Gateway...' : `Proceed to Pay ₹${rechargeAmountInput} (Bank / UPI / Card)`}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
