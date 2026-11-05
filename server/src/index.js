import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { authRouter, requireAuth, verifyToken } from './auth.js';
import { User, Group, Message } from './models.js';

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data', 'db');
const MAX_UPLOAD = 20 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

async function connectDb() {
  let uri = process.env.MONGO_URI;
  if (!uri) {
    // No external DB configured: run a local MongoDB that stores data on disk in server/data/db
    const LOCAL = 'mongodb://127.0.0.1:27027/whatsapp';
    try {
      // reuse a local mongod left running (e.g. after a crash or hard kill)
      await mongoose.connect(LOCAL, { serverSelectionTimeoutMS: 1500 });
      console.log(`Reusing running local MongoDB, data stored in ${DATA_DIR}`);
      return;
    } catch {
      await mongoose.disconnect().catch(() => {});
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mem = await MongoMemoryServer.create({
      instance: { dbPath: DATA_DIR, storageEngine: 'wiredTiger', port: 27027 },
    });
    uri = mem.getUri('whatsapp');
    console.log(`Using local MongoDB, data stored in ${DATA_DIR}`);
    const stop = async () => {
      await mongoose.disconnect();
      await mem.stop({ doCleanup: false });
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
  await mongoose.connect(uri);
}

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// online users: userId -> Set of socket ids
const online = new Map();
const oid = (v) => mongoose.isValidObjectId(v);

app.get('/api/users', requireAuth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.userId } }).sort({ name: 1 });
  res.json({ users: users.map((u) => ({ ...u.toPublic(), online: online.has(u.id) })) });
});

// ---------- groups ----------
app.get('/api/groups', requireAuth, async (req, res) => {
  const groups = await Group.find({ members: req.userId }).sort({ name: 1 });
  res.json({ groups: groups.map((g) => g.toPublic()) });
});

app.post('/api/groups', requireAuth, async (req, res) => {
  const { name, members = [] } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });
  const ids = [...new Set([req.userId, ...members.filter(oid)])];
  const count = await User.countDocuments({ _id: { $in: ids } });
  if (count !== ids.length) return res.status(400).json({ error: 'Unknown member' });
  if (ids.length < 2) return res.status(400).json({ error: 'Add at least one other member' });
  const group = await Group.create({ name: name.trim(), members: ids, admin: req.userId });
  const pub = group.toPublic();
  for (const m of ids) {
    io.in(m).socketsJoin(`g:${pub.id}`);
    io.to(m).emit('group:new', pub);
  }
  res.status(201).json({ group: pub });
});

app.post('/api/groups/:id/leave', requireAuth, async (req, res) => {
  const group = oid(req.params.id) && (await Group.findOne({ _id: req.params.id, members: req.userId }));
  if (!group) return res.status(404).json({ error: 'Not found' });
  group.members = group.members.filter((m) => m.toString() !== req.userId);
  if (group.admin.toString() === req.userId && group.members.length) group.admin = group.members[0];
  await group.save();
  io.in(req.userId).socketsLeave(`g:${group.id}`);
  io.to(`g:${group.id}`).emit('group:update', group.toPublic());
  res.json({ ok: true });
});

// ---------- messages ----------
app.get('/api/messages/:chatId', requireAuth, async (req, res) => {
  const me = req.userId;
  const id = req.params.chatId;
  if (!oid(id)) return res.status(400).json({ error: 'Bad id' });
  let filter;
  if (await Group.exists({ _id: id, members: me })) filter = { group: id };
  else filter = { $or: [{ from: me, to: id }, { from: id, to: me }] };
  const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({ messages: messages.reverse().map((m) => m.toPublic()) });
});

// ---------- uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 10)}`),
  }),
  limits: { fileSize: MAX_UPLOAD },
});

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({
    attachment: {
      url: `/uploads/${req.file.filename}`,
      name: req.file.originalname,
      mime: req.file.mimetype,
      size: req.file.size,
    },
  });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });

io.use((socket, next) => {
  try {
    socket.userId = verifyToken(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

const validAttachment = (a) =>
  a && typeof a.url === 'string' && /^\/uploads\/[\w.-]+$/.test(a.url)
    ? { url: a.url, name: String(a.name || 'file').slice(0, 200), mime: String(a.mime || ''), size: Number(a.size) || 0 }
    : undefined;

io.on('connection', async (socket) => {
  const me = socket.userId;
  socket.join(me);
  const groups = await Group.find({ members: me }, '_id');
  for (const g of groups) socket.join(`g:${g.id}`);

  if (!online.has(me)) {
    online.set(me, new Set());
    socket.broadcast.emit('presence', { userId: me, online: true });
  }
  online.get(me).add(socket.id);

  // mark pending direct messages to me as delivered
  const pending = await Message.find({ to: me, status: 'sent' });
  if (pending.length) {
    await Message.updateMany({ _id: { $in: pending.map((m) => m._id) } }, { status: 'delivered' });
    for (const m of pending) io.to(m.from.toString()).emit('message:status', { ids: [m.id], status: 'delivered' });
  }

  socket.on('message:send', async ({ to, group, text = '', attachment, tempId } = {}, ack) => {
    try {
      const att = validAttachment(attachment);
      text = String(text).trim().slice(0, 4000);
      if (!text && !att) throw new Error('Empty message');
      let msg;
      if (group) {
        const g = oid(group) && (await Group.findOne({ _id: group, members: me }));
        if (!g) throw new Error('Not a member of this group');
        const anyOnline = g.members.some((m) => m.toString() !== me && online.has(m.toString()));
        msg = await Message.create({ from: me, group, text, attachment: att, status: anyOnline ? 'delivered' : 'sent', readBy: [me] });
        socket.to(`g:${group}`).emit('message:new', msg.toPublic());
      } else {
        if (!oid(to) || !(await User.exists({ _id: to }))) throw new Error('Unknown recipient');
        msg = await Message.create({ from: me, to, text, attachment: att, status: online.has(to) ? 'delivered' : 'sent' });
        io.to(to).emit('message:new', msg.toPublic());
        socket.to(me).emit('message:new', msg.toPublic()); // my other tabs
      }
      ack?.({ ok: true, message: msg.toPublic(), tempId });
    } catch (e) {
      ack?.({ ok: false, error: e.message, tempId });
    }
  });

  // chatId = other user id (direct) or group id
  socket.on('message:read', async ({ from, group } = {}) => {
    if (group && oid(group)) {
      const g = await Group.findOne({ _id: group, members: me });
      if (!g) return;
      const unread = await Message.find({ group, readBy: { $ne: me } });
      if (!unread.length) return;
      await Message.updateMany({ _id: { $in: unread.map((m) => m._id) } }, { $addToSet: { readBy: me } });
      // a group message becomes "read" once every current member has read it
      const done = await Message.find({ _id: { $in: unread.map((m) => m._id) }, readBy: { $all: g.members }, status: { $ne: 'read' } });
      if (done.length) {
        await Message.updateMany({ _id: { $in: done.map((m) => m._id) } }, { status: 'read' });
        io.to(`g:${group}`).emit('message:status', { ids: done.map((m) => m.id), status: 'read' });
      }
      return;
    }
    if (!oid(from)) return;
    const unread = await Message.find({ from, to: me, status: { $ne: 'read' } }, '_id');
    if (!unread.length) return;
    await Message.updateMany({ _id: { $in: unread } }, { status: 'read' });
    io.to(from).emit('message:status', { ids: unread.map((m) => m.id), status: 'read' });
  });

  socket.on('typing', ({ to, group, typing } = {}) => {
    if (group && oid(group) && socket.rooms.has(`g:${group}`)) {
      socket.to(`g:${group}`).emit('typing', { from: me, group, typing: !!typing });
    } else if (oid(to)) {
      io.to(to).emit('typing', { from: me, typing: !!typing });
    }
  });

  socket.on('disconnect', async () => {
    const set = online.get(me);
    set?.delete(socket.id);
    if (set && set.size === 0) {
      online.delete(me);
      const lastSeen = new Date();
      await User.updateOne({ _id: me }, { lastSeen });
      io.emit('presence', { userId: me, online: false, lastSeen });
    }
  });
});

connectDb()
  .then(() => server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`)))
  .catch((e) => {
    console.error('Failed to start', e);
    process.exit(1);
  });
