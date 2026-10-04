import React, { useState } from 'react';
import { getUser, clearAuth } from './api';
import LandingPage from './components/LandingPage';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminPortal from './components/AdminPortal';

export default function App() {
  const [currentUser, setCurrentUser] = useState(getUser());
  const [currentView, setCurrentView] = useState(() => {
    const u = getUser();
    if (!u) return 'landing';
    return u.role === 'admin' ? 'admin' : 'dashboard';
  });
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3200);
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    setCurrentView(user.role === 'admin' ? 'admin' : 'dashboard');
  };

  const handleLogout = () => {
    clearAuth();
    setCurrentUser(null);
    setCurrentView('landing');
    showToast('Signed out successfully');
  };

  return (
    <div>
      {/* Landing Page (Introduction, System Architecture & Specs) */}
      {currentView === 'landing' && (
        <LandingPage
          isLoggedIn={Boolean(currentUser)}
          user={currentUser}
          onGoToLogin={() => setCurrentView('login')}
          onGoToDashboard={() => setCurrentView(currentUser?.role === 'admin' ? 'admin' : 'dashboard')}
        />
      )}

      {/* Login Portal (Animated, No Seed Creds, No Render URL, Strict Admin Notice) */}
      {currentView === 'login' && (
        <Login
          onLoginSuccess={handleLoginSuccess}
          onGoBackToLanding={() => setCurrentView('landing')}
          showToast={showToast}
        />
      )}

      {/* Consumer / Student Live Meter Dashboard */}
      {currentView === 'dashboard' && currentUser && (
        <Dashboard
          user={currentUser}
          onLogout={handleLogout}
          onSwitchToAdmin={() => setCurrentView('admin')}
          onSwitchToLanding={() => setCurrentView('landing')}
          showToast={showToast}
        />
      )}

      {/* Admin Control Master Hub */}
      {currentView === 'admin' && currentUser && (
        <AdminPortal
          onSwitchToDashboard={() => setCurrentView('dashboard')}
          onSwitchToLanding={() => setCurrentView('landing')}
          onLogout={handleLogout}
          showToast={showToast}
        />
      )}

      {/* Floating System Toast Alert */}
      {toastMessage && (
        <div className="toast-container glass">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
