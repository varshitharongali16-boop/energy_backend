import React, { useState, useEffect } from 'react';

export default function Gauge({
  power = 0,
  isLoadOn = false,
  lastSeen = '--:--:--',
  overloadLimit = 2500
}) {
  const [peakPower, setPeakPower] = useState(0);

  useEffect(() => {
    if (power > peakPower) {
      setPeakPower(power);
    }
  }, [power, peakPower]);

  // Semi-circle arc length = pi * radius = 3.14159 * 80 = ~251.3
  const maxPower = Math.max(overloadLimit * 1.2, power * 1.15, 3000);
  const ratio = Math.min(Math.max(power / maxPower, 0), 1);
  const strokeOffset = 251.3 - ratio * 251.3;
  const isOverloaded = power >= overloadLimit;

  return (
    <div
      className="power-card glass"
      style={{
        borderColor: isOverloaded ? '#fca5a5' : undefined,
        boxShadow: isOverloaded ? '0 4px 20px rgba(220, 38, 38, 0.2)' : undefined
      }}
    >
      <div className="card-top">
        <span className="card-label">Active Power Demand</span>
        <div
          className={`load-pill ${isLoadOn ? (isOverloaded ? 'load-off' : 'load-on') : 'load-off'}`}
          style={isOverloaded ? { background: '#fef2f2', color: 'var(--red)', borderColor: '#fca5a5' } : {}}
        >
          <span>●</span>
          <span>{isOverloaded ? 'HIGH LOAD WARN' : (isLoadOn ? 'LOAD ACTIVE' : 'STANDBY')}</span>
        </div>
      </div>

      <div className="gauge-wrapper">
        <svg className="gauge-svg" viewBox="0 0 200 125">
          <defs>
            <linearGradient id="powerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0284c7" />
              <stop offset="45%" stopColor="#2563eb" />
              <stop offset="80%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#dc2626" />
            </linearGradient>
          </defs>
          <path className="gauge-track" d="M 25 105 A 75 75 0 0 1 175 105" />
          <path
            className="gauge-progress"
            d="M 25 105 A 75 75 0 0 1 175 105"
            style={{
              strokeDashoffset: strokeOffset,
              filter: isOverloaded ? 'drop-shadow(0 2px 8px rgba(220, 38, 38, 0.5))' : 'drop-shadow(0 2px 6px rgba(2, 132, 199, 0.35))'
            }}
          />
        </svg>
        <div className="power-readout">
          <div
            className="power-val"
            style={{ color: isOverloaded ? 'var(--red)' : 'var(--text-primary)' }}
          >
            {power.toFixed(1)}
          </div>
          <span className="power-unit" style={{ color: isOverloaded ? 'var(--red)' : 'var(--cyan)' }}>W</span>
        </div>
      </div>

      <div className="power-footer">
        <span>
          Recorded: <strong style={{ color: 'var(--text-primary)' }}>{lastSeen}</strong>
        </span>
        <span style={{ color: 'var(--cyan)' }}>
          Peak: <strong>{peakPower.toFixed(1)} W</strong>
        </span>
      </div>
    </div>
  );
}
