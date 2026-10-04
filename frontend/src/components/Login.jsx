import React, { useState } from 'react';
import { getApiBase, setApiBase, setAuth } from '../api';
import { Zap, ShieldCheck, AlertCircle } from 'lucide-react';

export default function Login({ onLoginSuccess, showToast }) {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [backendUrl, setBackendUrlState] = useState(getApiBase());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const targetUrl = setApiBase(backendUrl);

    try {
      const res = await fetch(`${targetUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      setAuth(data.token, data.user);
      showToast(`Welcome back, ${data.user.username}!`);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Cannot connect to backend server. Verify your URL.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '85vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div className="glass" style={{ width: '100%', maxWidth: '440px', padding: '36px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '26px' }}>
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--cyan), var(--blue))',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              marginBottom: '12px',
              boxShadow: '0 0 24px var(--cyan-glow)'
            }}
          >
            <Zap size={28} />
          </div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
            Energy Cloud Portal
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            ESP32 + PZEM-004T Cloud Intelligence
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#fca5a5',
              padding: '10px 14px',
              borderRadius: '12px',
              fontSize: '0.84rem',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="input-wrap" style={{ marginBottom: '14px' }}>
            <label htmlFor="loginEmail">Email or Username</label>
            <input
              id="loginEmail"
              type="text"
              placeholder="admin@energymeter.com"
              value={usernameOrEmail}
              onChange={(e) => setUsernameOrEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-wrap" style={{ marginBottom: '18px' }}>
            <label htmlFor="loginPassword">Password</label>
            <input
              id="loginPassword"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="input-wrap" style={{ marginBottom: '22px' }}>
            <label htmlFor="backendUrl" style={{ fontSize: '0.7rem', color: '#64748b' }}>
              Render Backend URL
            </label>
            <input
              id="backendUrl"
              type="url"
              placeholder="https://energy-backend-gwex.onrender.com"
              value={backendUrl}
              onChange={(e) => setBackendUrlState(e.target.value)}
              style={{ fontSize: '0.82rem', padding: '9px 12px', color: 'var(--cyan)' }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div
          style={{
            marginTop: '24px',
            padding: '14px',
            borderRadius: '14px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 700 }}>
            <ShieldCheck size={14} style={{ color: 'var(--emerald)' }} />
            <span>Default Seed Credentials:</span>
          </div>
          <div>• <strong>Admin:</strong> admin@energymeter.com / admin123</div>
          <div>• <strong>User:</strong> praveen@energymeter.com / user123</div>
        </div>
      </div>
    </div>
  );
}
