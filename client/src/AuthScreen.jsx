import { useState } from 'react';
import { api } from './api.js';

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', name: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: form });
      onAuth(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>WhatsApp Clone</h1>
        <input placeholder="Username" value={form.username} onChange={set('username')} autoFocus />
        {mode === 'register' && <input placeholder="Display name" value={form.name} onChange={set('name')} />}
        <input type="password" placeholder="Password" value={form.password} onChange={set('password')} />
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
        <p className="switch">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <a href="#" onClick={(e) => (e.preventDefault(), setMode(mode === 'login' ? 'register' : 'login'))}>
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </a>
        </p>
      </form>
    </div>
  );
}
