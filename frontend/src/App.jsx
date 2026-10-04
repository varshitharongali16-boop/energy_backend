import React, { useState, useEffect } from 'react';
import { getUser, clearAuth } from './api';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminPortal from './components/AdminPortal';

export default function App() {
  const [currentUser, setCurrentUser] = useState(getUser());
  const [currentView, setCurrentView] = useState(() => {
    const u = getUser();
    if (!u) return 'login';
    return u.role === 'admin' ? 'admin' : 'dashboard';
  });
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3000);
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    setCurrentView(user.role === 'admin' ? 'admin' : 'dashboard');
  };

  const handleLogout = () => {
    clearAuth();
    setCurrentUser(null);
    setCurrentView('login');
    showToast('Signed out successfully');
  };

  return (
    <div>
      {currentView === 'login' && (
        <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />
      )}

      {currentView === 'dashboard' && currentUser && (
        <Dashboard
          user={currentUser}
          onLogout={handleLogout}
          onSwitchToAdmin={() => setCurrentView('admin')}
          showToast={showToast}
        />
      )}

      {currentView === 'admin' && currentUser && (
        <AdminPortal
          onSwitchToDashboard={() => setCurrentView('dashboard')}
          onLogout={handleLogout}
          showToast={showToast}
        />
      )}

      {/* Floating Toast Alert */}
      {toastMessage && (
        <div className="toast-container glass">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
