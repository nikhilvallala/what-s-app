// Run after a server restart: checks data from e2e-test.mjs survived
import fs from 'node:fs';
const { username, bob } = JSON.parse(fs.readFileSync('.e2e-user.json', 'utf8'));
const BASE = 'http://localhost:4000';
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: 'secret1' }),
}).then((r) => r.json());
if (!login.token) throw new Error('FAIL: user lost after restart');
const hist = await fetch(`${BASE}/api/messages/${bob}`, { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json());
if (hist.messages.length < 2) throw new Error('FAIL: messages lost after restart');
fs.unlinkSync('.e2e-user.json');
console.log('ok - data persisted across restart\nALL PASSED');
