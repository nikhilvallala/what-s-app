// End-to-end smoke test: run with the server running on :4000
import { io } from 'socket.io-client';

const BASE = 'http://localhost:4000';
const post = (p, body) =>
  fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p, token) => fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const once = (s, ev) => new Promise((res, rej) => { s.once(ev, res); setTimeout(() => rej(new Error('timeout ' + ev)), 5000); });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

const sfx = Date.now();
const a = await post('/api/auth/register', { username: 'alice' + sfx, name: 'Alice', password: 'secret1' });
const b = await post('/api/auth/register', { username: 'bob' + sfx, name: 'Bob', password: 'secret1' });
assert(a.token && b.token, 'register two users');
const login = await post('/api/auth/login', { username: 'alice' + sfx, password: 'secret1' });
assert(login.token, 'login');
const bad = await post('/api/auth/login', { username: 'alice' + sfx, password: 'wrong' });
assert(bad.error, 'reject wrong password');

const { users } = await get('/api/users', a.token);
assert(users.some((u) => u.id === b.user.id), 'alice sees bob in users');

const sa = io(BASE, { auth: { token: a.token } });
const sb = io(BASE, { auth: { token: b.token } });
await Promise.all([once(sa, 'connect'), once(sb, 'connect')]);

const recv = once(sb, 'message:new');
const ack = await sa.emitWithAck('message:send', { to: b.user.id, text: 'hi bob', tempId: 't1' });
assert(ack.ok && ack.message.status === 'delivered', 'send acked as delivered');
const m = await recv;
assert(m.text === 'hi bob', 'bob receives message in real time');

const typing = once(sa, 'typing');
sb.emit('typing', { to: a.user.id, typing: true });
assert((await typing).typing === true, 'typing indicator');

const read = once(sa, 'message:status');
sb.emit('message:read', { from: a.user.id });
const st = await read;
assert(st.status === 'read' && st.ids.includes(m.id), 'read receipt');

const hist = await get(`/api/messages/${a.user.id}`, b.token);
assert(hist.messages.length === 1 && hist.messages[0].status === 'read', 'history persisted');

const pres = once(sa, 'presence');
sb.disconnect();
assert((await pres).online === false, 'presence offline on disconnect');

sa.disconnect();
console.log('ALL PASSED');
process.exit(0);
