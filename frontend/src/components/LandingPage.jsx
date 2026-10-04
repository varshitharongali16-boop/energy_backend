import React from 'react';
import {
  Zap,
  Shield,
  Activity,
  Cpu,
  BarChart3,
  Clock,
  ArrowRight,
  Database,
  Lock,
  Radio,
  Layers,
  AlertTriangle,
  Flame,
  CheckCircle2
} from 'lucide-react';

export default function LandingPage({ onGoToLogin, isLoggedIn, user, onGoToDashboard }) {
  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="landing-container">
      {/* Top Navbar */}
      <nav className="landing-nav glass">
        <div className="brand" style={{ cursor: 'pointer' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="brand-icon">
            <Zap size={22} className="pulse-icon" />
          </div>
          <div>
            <span className="brand-title">GRIDSENSE IoT</span>
            <span className="brand-subtitle" style={{ display: 'block' }}>Smart Energy Intelligence</span>
          </div>
        </div>

        <div className="landing-nav-links">
          <button onClick={() => scrollToSection('features')} className="nav-link-btn">
            Features
          </button>
          <button onClick={() => scrollToSection('architecture')} className="nav-link-btn">
            Architecture
          </button>
          <button onClick={() => scrollToSection('hardware')} className="nav-link-btn">
            Hardware & PZEM
          </button>
        </div>

        <div className="landing-nav-action">
          {isLoggedIn ? (
            <button onClick={onGoToDashboard} className="btn btn-primary pulse-btn">
              <span>{user?.role === 'admin' ? 'Admin Hub' : 'My Meter Dashboard'}</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button onClick={onGoToLogin} className="btn btn-primary pulse-btn">
              <span>Sign In to Portal</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="landing-hero">
        <div className="hero-pill-badge">
          <span className="beacon-live"></span>
          <span>ESP32 + PZEM-004T CLOUD INTELLIGENCE PLATFORM</span>
        </div>

        <h1 className="hero-main-title">
          Next-Generation <br />
          <span className="gradient-text">Smart Energy Metering</span> <br />
          & Tariff Automation
        </h1>

        <p className="hero-desc">
          High-frequency IoT telemetry streaming from PZEM-004T power meters to cloud PostgreSQL.
          Automated quota runway tracking, acoustic overload defense, and institutional fleet governance in a unified fullstack portal.
        </p>

        <div className="hero-actions">
          {isLoggedIn ? (
            <button onClick={onGoToDashboard} className="btn btn-primary btn-large">
              <Zap size={18} />
              <span>Launch Live Dashboard</span>
              <ArrowRight size={18} />
            </button>
          ) : (
            <button onClick={onGoToLogin} className="btn btn-primary btn-large">
              <Lock size={18} />
              <span>Access Secure Portal</span>
              <ArrowRight size={18} />
            </button>
          )}

          <button onClick={() => scrollToSection('architecture')} className="btn btn-outline btn-large">
            <Layers size={18} />
            <span>Explore System Stack</span>
          </button>
        </div>

        {/* Live Metrics Ribbon */}
        <div className="metrics-ribbon glass">
          <div className="metric-cell">
            <span className="metric-num">&lt; 200ms</span>
            <span className="metric-tag">Edge Ingestion Latency</span>
          </div>
          <div className="metric-divider"></div>
          <div className="metric-cell">
            <span className="metric-num">0.01 kWh</span>
            <span className="metric-tag">PZEM-004T Precision</span>
          </div>
          <div className="metric-divider"></div>
          <div className="metric-cell">
            <span className="metric-num">24 / 7</span>
            <span className="metric-tag">Cloud Telemetry Uptime</span>
          </div>
          <div className="metric-divider"></div>
          <div className="metric-cell">
            <span className="metric-num">PostgreSQL</span>
            <span className="metric-tag">ACID Time-Series Store</span>
          </div>
        </div>
      </section>

      {/* Features Showcase */}
      <section id="features" className="landing-section">
        <div className="section-header">
          <span className="section-pill">SYSTEM CAPABILITIES</span>
          <h2 className="section-title">Engineered for Industrial & Institutional Reliability</h2>
          <p className="section-subtitle">
            Bridging embedded edge measurement with modern reactive cloud analytics.
          </p>
        </div>

        <div className="features-grid">
          <div className="feature-card glass">
            <div className="feature-icon" style={{ background: 'rgba(0, 240, 255, 0.15)', color: 'var(--cyan)' }}>
              <Radio size={26} />
            </div>
            <h3>PZEM-004T True RMS Measurement</h3>
            <p>
              High-accuracy hardware sampling of AC Voltage (80–260V), Current (0–100A), Active Power (0–23kW),
              Total Energy (kWh), and Power Factor with galvanic optical isolation.
            </p>
            <div className="feature-points">
              <span><CheckCircle2 size={14} className="text-cyan" /> 1.0% Factory Calibration Accuracy</span>
              <span><CheckCircle2 size={14} className="text-cyan" /> Hardware Optocoupler Surge Protection</span>
            </div>
          </div>

          <div className="feature-card glass">
            <div className="feature-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--emerald)' }}>
              <Activity size={26} />
            </div>
            <h3>Dynamic Quota & Tariff Runway</h3>
            <p>
              Continuous algorithmic forecasting of prepaid electricity balance. Predicts hours remaining
              based on active load wattage, tariff rates (₹/kWh), and quota consumption rate.
            </p>
            <div className="feature-points">
              <span><CheckCircle2 size={14} className="text-emerald" /> Real-time Quota Runway Countdown</span>
              <span><CheckCircle2 size={14} className="text-emerald" /> Dynamic Tariff Reconfiguration</span>
            </div>
          </div>

          <div className="feature-card glass">
            <div className="feature-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--red)' }}>
              <AlertTriangle size={26} />
            </div>
            <h3>Acoustic & Visual Overload Guard</h3>
            <p>
              Autonomous trip protection with live visual alerts and synthesized acoustic alarms when consumption
              crosses critical load or quota depletion thresholds.
            </p>
            <div className="feature-points">
              <span><CheckCircle2 size={14} className="text-red" /> Audio Frequency Alarms & Visual Beacons</span>
              <span><CheckCircle2 size={14} className="text-red" /> Relay State Telemetry Sync</span>
            </div>
          </div>

          <div className="feature-card glass">
            <div className="feature-icon" style={{ background: 'rgba(168, 85, 247, 0.15)', color: 'var(--purple)' }}>
              <Shield size={26} />
            </div>
            <h3>Administrative Fleet & User Governance</h3>
            <p>
              Super-admin panel providing centralized database access. Provision ESP32 meters, manage consumer and student
              credentials, update passwords, and inspect live database telemetry records.
            </p>
            <div className="feature-points">
              <span><CheckCircle2 size={14} className="text-purple" /> Admin-only User & Password Authority</span>
              <span><CheckCircle2 size={14} className="text-purple" /> Live PostgreSQL Database Log Inspector</span>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture Pipeline */}
      <section id="architecture" className="landing-section">
        <div className="section-header">
          <span className="section-pill">SYSTEM ARCHITECTURE</span>
          <h2 className="section-title">End-to-End IoT Data Flow</h2>
          <p className="section-subtitle">
            From physical AC line sensors to reactive cloud charts and administrative controls.
          </p>
        </div>

        <div className="pipeline-container glass">
          <div className="pipeline-step">
            <div className="step-badge">1</div>
            <div className="step-icon-wrap">
              <Cpu size={24} style={{ color: 'var(--cyan)' }} />
            </div>
            <h4>ESP32 Edge Node</h4>
            <p>UART communication with PZEM-004T. Computes True RMS power, energy accumulation, and serializes JSON payload.</p>
          </div>

          <div className="pipeline-arrow">
            <ArrowRight size={20} />
          </div>

          <div className="pipeline-step">
            <div className="step-badge">2</div>
            <div className="step-icon-wrap">
              <Radio size={24} style={{ color: 'var(--blue)' }} />
            </div>
            <h4>HTTPS Telemetry Ingestion</h4>
            <p>Encrypted REST POST requests authenticated via unique device API keys sent every few seconds to Node.js backend.</p>
          </div>

          <div className="pipeline-arrow">
            <ArrowRight size={20} />
          </div>

          <div className="pipeline-step">
            <div className="step-badge">3</div>
            <div className="step-icon-wrap">
              <Database size={24} style={{ color: 'var(--purple)' }} />
            </div>
            <h4>PostgreSQL Cloud DB</h4>
            <p>Persistent storage for users, meters, and timestamped telemetry logs. Foreign key relationships and indexed history.</p>
          </div>

          <div className="pipeline-arrow">
            <ArrowRight size={20} />
          </div>

          <div className="pipeline-step">
            <div className="step-badge">4</div>
            <div className="step-icon-wrap">
              <BarChart3 size={24} style={{ color: 'var(--emerald)' }} />
            </div>
            <h4>Fullstack Portal</h4>
            <p>Single-origin React frontend delivering live SVG speedometers, interactive 30-day charts, and CSV auditing.</p>
          </div>
        </div>
      </section>

      {/* Hardware Section */}
      <section id="hardware" className="landing-section">
        <div className="section-header">
          <span className="section-pill">HARDWARE SPECIFICATIONS</span>
          <h2 className="section-title">ESP32 & PZEM-004T Power Subsystem</h2>
        </div>

        <div className="hardware-grid">
          <div className="hw-card glass">
            <div className="hw-title-row">
              <Cpu size={20} style={{ color: 'var(--cyan)' }} />
              <h4>ESP32-WROOM-32 Microcontroller</h4>
            </div>
            <ul className="hw-specs-list">
              <li><strong>Core:</strong> Dual-Core Xtensa 32-bit LX6 up to 240 MHz</li>
              <li><strong>Connectivity:</strong> 802.11 b/g/n 2.4GHz Wi-Fi + BLE</li>
              <li><strong>Interface:</strong> Hardware UART2 (GPIO 16 RX, GPIO 17 TX)</li>
              <li><strong>Watchdog:</strong> Autonomous reconnect & non-blocking polling</li>
              <li><strong>Relay Control:</strong> GPIO 26 digital driver for load switching</li>
            </ul>
          </div>

          <div className="hw-card glass">
            <div className="hw-title-row">
              <Zap size={20} style={{ color: 'var(--amber)' }} />
              <h4>PZEM-004T v3.0 Power Transducer</h4>
            </div>
            <ul className="hw-specs-list">
              <li><strong>Voltage Measurement:</strong> 80 ~ 260 VAC (Resolution: 0.1V)</li>
              <li><strong>Current Measurement:</strong> 0 ~ 100A with Current Transformer (CT)</li>
              <li><strong>Active Power:</strong> 0 ~ 23 kW (Resolution: 0.1W)</li>
              <li><strong>Energy Accumulation:</strong> 0 ~ 9999 kWh non-volatile counter</li>
              <li><strong>Isolation:</strong> Optocoupler barrier rated for 2kV isolation</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Institutional Security Notice */}
      <section className="security-notice-card glass">
        <div className="notice-icon">
          <Lock size={32} />
        </div>
        <div className="notice-content">
          <h3>Protected Energy Infrastructure</h3>
          <p>
            To prevent unauthorized tampering with institutional tariff and power quotas,
            <strong> self-registration is strictly restricted</strong>.
            All user accounts for students and consumers are provisioned directly by the authorized System Administrator.
          </p>
        </div>
        <div className="notice-action">
          {isLoggedIn ? (
            <button onClick={onGoToDashboard} className="btn btn-primary">
              Launch Portal
            </button>
          ) : (
            <button onClick={onGoToLogin} className="btn btn-primary">
              Sign In
            </button>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer glass">
        <div className="footer-top">
          <div className="brand">
            <div className="brand-icon" style={{ width: '36px', height: '36px' }}>
              <Zap size={18} />
            </div>
            <div>
              <span className="brand-title" style={{ fontSize: '1.05rem' }}>GRIDSENSE IoT</span>
              <span className="brand-subtitle" style={{ fontSize: '0.7rem' }}>Next-Gen Cloud Energy Platform</span>
            </div>
          </div>

          <div className="tech-pills">
            <span className="tech-badge">ESP32</span>
            <span className="tech-badge">PZEM-004T</span>
            <span className="tech-badge">Node.js Express</span>
            <span className="tech-badge">PostgreSQL</span>
            <span className="tech-badge">React 19</span>
            <span className="tech-badge">Single-Origin Render</span>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} GridSense IoT Smart Energy Monitoring. Designed for high-reliability telemetry.</p>
          <div style={{ display: 'flex', gap: '14px' }}>
            <button onClick={onGoToLogin} className="footer-link">Portal Login</button>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="footer-link">Back to Top ↑</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
