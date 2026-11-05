import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { authRouter, requireAuth, verifyToken } from './auth.js';
import { User, Message } from './models.js';

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

async function connectDb() {
  let uri = process.env.MONGO_URI;
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mem = await MongoMemoryServer.create();
    uri = mem.getUri();
    console.log('Using in-memory MongoDB (data resets on restart)');
  }
  await mongoose.connect(uri);
}

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);

// online users: userId -> Set of socket ids
const online = new Map();

app.get('/api/users', requireAuth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.userId } }).sort({ name: 1 });
  res.json({
    users: users.map((u) => ({ ...u.toPublic(), online: online.has(u.id) })),
  });
});

app.get('/api/messages/:otherId', requireAuth, async (req, res) => {
  const me = req.userId;
  const other = req.params.otherId;
  if (!mongoose.isValidObjectId(other)) return res.status(400).json({ error: 'Bad id' });
  const messages = await Message.find({
    $or: [
      { from: me, to: other },
      { from: other, to: me },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ messages: messages.reverse().map((m) => m.toPublic()) });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

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

io.on('connection', async (socket) => {
  const me = socket.userId;
  socket.join(me);
  if (!online.has(me)) {
    online.set(me, new Set());
    socket.broadcast.emit('presence', { userId: me, online: true });
  }
  online.get(me).add(socket.id);

  // mark pending messages to me as delivered
  const pending = await Message.find({ to: me, status: 'sent' });
  if (pending.length) {
    await Message.updateMany({ _id: { $in: pending.map((m) => m._id) } }, { status: 'delivered' });
    for (const m of pending) io.to(m.from.toString()).emit('message:status', { ids: [m.id], status: 'delivered' });
  }

  socket.on('message:send', async ({ to, text, tempId } = {}, ack) => {
    try {
      if (!mongoose.isValidObjectId(to) || !text?.trim()) throw new Error('Invalid message');
      const msg = await Message.create({
        from: me,
        to,
        text: text.trim().slice(0, 4000),
        status: online.has(to) ? 'delivered' : 'sent',
      });
      const pub = msg.toPublic();
      io.to(to).emit('message:new', pub);
      socket.to(me).emit('message:new', pub); // my other tabs
      ack?.({ ok: true, message: pub, tempId });
    } catch (e) {
      ack?.({ ok: false, error: e.message, tempId });
    }
  });

  socket.on('message:read', async ({ from } = {}) => {
    if (!mongoose.isValidObjectId(from)) return;
    const unread = await Message.find({ from, to: me, status: { $ne: 'read' } }, '_id');
    if (!unread.length) return;
    await Message.updateMany({ _id: { $in: unread } }, { status: 'read' });
    io.to(from).emit('message:status', { ids: unread.map((m) => m.id), status: 'read' });
  });

  socket.on('typing', ({ to, typing } = {}) => {
    if (mongoose.isValidObjectId(to)) io.to(to).emit('typing', { from: me, typing: !!typing });
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
