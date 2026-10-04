import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { fetchApi } from '../api';
import { Download } from 'lucide-react';

export default function HistoryChart({ meterId }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [range, setRange] = useState('24h');
  const [loading, setLoading] = useState(false);
  const [rawPoints, setRawPoints] = useState([]);

  useEffect(() => {
    if (!meterId) return;

    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetchApi(`/api/meters/${meterId}/history?range=${range}`);
        const data = await res.json();
        if (!isMounted || !res.ok) return;

        const points = data.points || [];
        setRawPoints(points);

        const labels = points.map((p) => {
          const d = new Date(p.recorded_at);
          return range === '24h'
            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        });

        const powerData = points.map((p) => parseFloat(p.power));
        const energyData = points.map((p) => parseFloat(p.energy));

        if (chartInstance.current) {
          chartInstance.current.destroy();
        }

        if (chartRef.current) {
          const ctx = chartRef.current.getContext('2d');
          chartInstance.current = new Chart(ctx, {
            type: 'line',
            data: {
              labels,
              datasets: [
                {
                  label: 'Power (Watts)',
                  data: powerData,
                  borderColor: '#00f0ff',
                  backgroundColor: 'rgba(0, 240, 255, 0.08)',
                  fill: true,
                  tension: 0.35,
                  borderWidth: 2,
                  pointRadius: range === '24h' ? 2 : 0,
                  pointHoverRadius: 5
                },
                {
                  label: 'Energy (kWh)',
                  data: energyData,
                  borderColor: '#10b981',
                  backgroundColor: 'transparent',
                  borderWidth: 2,
                  borderDash: [4, 4],
                  pointRadius: 0,
                  yAxisID: 'y1'
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: {
                x: {
                  grid: { color: 'rgba(255, 255, 255, 0.04)' },
                  ticks: { color: '#64748b', maxTicksLimit: 8 }
                },
                y: {
                  grid: { color: 'rgba(255, 255, 255, 0.06)' },
                  ticks: { color: '#94a3b8' }
                },
                y1: {
                  position: 'right',
                  grid: { drawOnChartArea: false },
                  ticks: { color: '#10b981' }
                }
              },
              plugins: {
                legend: { labels: { color: '#cbd5e1', font: { size: 12 } } }
              }
            }
          });
        }
      } catch (err) {
        console.error('Failed to load history chart:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [meterId, range]);

  const handleExportCSV = () => {
    if (!rawPoints || rawPoints.length === 0) {
      alert('No data points available to export.');
      return;
    }

    const headers = ['Timestamp', 'Power (W)', 'Voltage (V)', 'Current (A)', 'Energy (kWh)', 'Cost'];
    const rows = rawPoints.map((p) => [
      `"${new Date(p.recorded_at).toISOString()}"`,
      p.power,
      p.voltage || 0,
      p.current || 0,
      p.energy || 0,
      p.cost || 0
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `meter_${meterId}_telemetry_${range}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <section className="chart-card glass">
      <div className="chart-header">
        <div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Consumption & Power Trends</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Real-time time-series telemetry stored in PostgreSQL
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="time-tabs">
            <button
              className={`tab-btn ${range === '24h' ? 'active' : ''}`}
              onClick={() => setRange('24h')}
            >
              24 Hours
            </button>
            <button
              className={`tab-btn ${range === '7d' ? 'active' : ''}`}
              onClick={() => setRange('7d')}
            >
              7 Days
            </button>
            <button
              className={`tab-btn ${range === '30d' ? 'active' : ''}`}
              onClick={() => setRange('30d')}
            >
              30 Days
            </button>
          </div>

          <button
            onClick={handleExportCSV}
            className="btn btn-outline"
            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
            title="Download CSV for Excel"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="chart-wrapper">
        <canvas ref={chartRef}></canvas>
        {loading && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'var(--cyan)',
              fontSize: '0.85rem'
            }}
          >
            Loading telemetry...
          </div>
        )}
      </div>
    </section>
  );
}
