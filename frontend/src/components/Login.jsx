import React, { useState } from 'react';
import { getApiBase, setAuth } from '../api';
import {
  Zap,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowLeft,
  ShieldCheck
} from 'lucide-react';

export default function Login({ onLoginSuccess, onGoBackToLanding, showToast }) {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const targetUrl = getApiBase();

    try {
      const res = await fetch(`${targetUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed. Please verify your credentials.');
      }

      setAuth(data.token, data.user);
      showToast(`Welcome back, ${data.user.username}!`);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Cannot connect to authentication service.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page-wrapper">
      {/* Ambient Animated Orbs */}
      <div className="ambient-orb orb-1"></div>
      <div className="ambient-orb orb-2"></div>
      <div className="ambient-orb orb-3"></div>

      <div className="login-card glass">
        {/* Back to Home Button */}
        {onGoBackToLanding && (
          <button
            onClick={onGoBackToLanding}
            className="back-btn"
            title="Return to System Overview"
          >
            <ArrowLeft size={16} />
            <span>Overview & Specs</span>
          </button>
        )}

        {/* Brand Icon & Header */}
        <div className="login-header">
          <div className="login-icon-box">
            <Zap size={30} className="login-zap-icon" />
          </div>
          <h2 className="login-title">GRIDSENSE ACCESS</h2>
          <p className="login-subtitle">
            Secure Smart Energy Telemetry & Control Portal
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="login-error-banner">
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Sign In Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label htmlFor="loginEmail">Email or Username</label>
            <div className="input-with-icon">
              <Mail size={18} className="field-icon" />
              <input
                id="loginEmail"
                type="text"
                placeholder="Enter your username or email"
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="loginPassword">Password</label>
            <div className="input-with-icon">
              <Lock size={18} className="field-icon" />
              <input
                id="loginPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="toggle-password-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary login-submit-btn"
            disabled={loading}
          >
            {loading ? (
              <span className="submit-loading-text">
                <span className="spinner-dot"></span> Authenticating...
              </span>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>
        </form>

        {/* Security & Registration Policy Notice */}
        <div className="login-policy-box">
          <ShieldCheck size={16} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
          <span>
            Institutional access is strictly managed. Student & consumer accounts are provisioned exclusively by the Administrator.
          </span>
        </div>
      </div>
    </div>
  );
}
