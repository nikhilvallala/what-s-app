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

// ---- uploads ----
const fd = new FormData();
fd.append('file', new Blob(['hello file'], { type: 'text/plain' }), 'note.txt');
const up = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${a.token}` }, body: fd }).then((r) => r.json());
assert(up.attachment?.url?.startsWith('/uploads/'), 'file upload');
const dl = await fetch(BASE + up.attachment.url).then((r) => r.text());
assert(dl === 'hello file', 'uploaded file is downloadable');
const recvAtt = once(sb, 'message:new');
await sa.emitWithAck('message:send', { to: b.user.id, attachment: up.attachment });
assert((await recvAtt).attachment?.name === 'note.txt', 'attachment message delivered');
const badAtt = await sa.emitWithAck('message:send', { to: b.user.id, attachment: { url: 'http://evil/x' } });
assert(!badAtt.ok, 'reject foreign attachment url');

// ---- groups ----
const c = await post('/api/auth/register', { username: 'carol' + sfx, name: 'Carol', password: 'secret1' });
const sc = io(BASE, { auth: { token: c.token } });
await once(sc, 'connect');
const gNotify = once(sb, 'group:new');
const gres = await fetch(BASE + '/api/groups', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
  body: JSON.stringify({ name: 'Team', members: [b.user.id, c.user.id] }),
}).then((r) => r.json());
assert(gres.group?.members.length === 3, 'create group');
assert((await gNotify).id === gres.group.id, 'members notified of new group');
const gid = gres.group.id;
const gb = once(sb, 'message:new');
const gc = once(sc, 'message:new');
await sa.emitWithAck('message:send', { group: gid, text: 'hello team' });
const [mb, mc] = await Promise.all([gb, gc]);
assert(mb.group === gid && mc.text === 'hello team', 'group message fan-out');
const rd = once(sa, 'message:status');
sb.emit('message:read', { group: gid });
await new Promise((r) => setTimeout(r, 300));
sc.emit('message:read', { group: gid });
assert((await rd).status === 'read', 'group read when all members read');
const outsider = await sc.emitWithAck('message:send', { group: '0123456789abcdef01234567', text: 'x' });
assert(!outsider.ok, 'reject send to non-member group');
const gh = await get(`/api/messages/${gid}`, c.token);
assert(gh.messages.length === 1, 'group history');
sc.disconnect();

const pres = once(sa, 'presence');
sb.disconnect();
assert((await pres).online === false, 'presence offline on disconnect');

sa.disconnect();
if (process.argv[2] === 'save') {
  (await import('node:fs')).writeFileSync('.e2e-user.json', JSON.stringify({ username: 'alice' + sfx, bob: b.user.id }));
}
console.log('ALL PASSED');
process.exit(0);
