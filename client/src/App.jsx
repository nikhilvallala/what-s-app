import { useEffect, useState } from 'react';
import { api } from './api.js';
import AuthScreen from './AuthScreen.jsx';
import Chat from './Chat.jsx';

export default function App() {
  const [session, setSession] = useState(() => {
    const token = localStorage.getItem('token');
    return token ? { token, user: null } : null;
  });

  useEffect(() => {
    if (session?.token && !session.user) {
      api('/auth/me', { token: session.token })
        .then(({ user }) => setSession({ token: session.token, user }))
        .catch(() => logout());
    }
  }, [session]);

  function onAuth({ token, user }) {
    localStorage.setItem('token', token);
    setSession({ token, user });
  }

  function logout() {
    localStorage.removeItem('token');
    setSession(null);
  }

  if (!session) return <AuthScreen onAuth={onAuth} />;
  if (!session.user) return <div className="loading">Loading…</div>;
  return <Chat token={session.token} me={session.user} onLogout={logout} />;
}
