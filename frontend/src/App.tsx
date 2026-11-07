import React, { useEffect, useState } from 'react';

export const App: React.FC = () => {
  const [healthStatus, setHealthStatus] = useState<string>('Checking backend...');

  useEffect(() => {
    const apiUrl = importMeta.env.VITE_API_URL || 'http://localhost:8000';
    fetch(`${apiUrl}/api/health`)
      .then((res) => res.json())
      .then((data) => {
        setHealthStatus(`Connected: ${data.service} (${data.environment})`);
      })
      .catch(() => {
        setHealthStatus('Backend not reachable (run FastAPI server on port 8000)');
      });
  }, []);

  return (
    <div style={{ maxWidth: '800px', margin: '60px auto', padding: '24px' }}>
      <header style={{ marginBottom: '32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>
          Role-Based Expense Reimbursement Portal
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Secure, Audit-Compliant Enterprise Reimbursement System
        </p>
      </header>

      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '24px',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', marginBottom: '12px' }}>System Status</h2>
        <p style={{ color: 'var(--accent)', fontWeight: 500 }}>{healthStatus}</p>
      </div>
    </div>
  );
};

export default App;
