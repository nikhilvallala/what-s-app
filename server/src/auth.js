import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models.js';

const secret = () => process.env.JWT_SECRET || 'dev-secret';

export const signToken = (userId) => jwt.sign({ sub: userId }, secret(), { expiresIn: '7d' });
export const verifyToken = (token) => jwt.verify(token, secret()).sub;

export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.userId = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { username, name, password } = req.body || {};
  if (!username || !name || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username, name and a password of 6+ characters are required' });
  }
  if (await User.exists({ username: username.toLowerCase() })) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const user = await User.create({ username, name, passwordHash: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: signToken(user.id), user: user.toPublic() });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = username && (await User.findOne({ username: username.toLowerCase() }));
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  res.json({ token: signToken(user.id), user: user.toPublic() });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ user: user.toPublic() });
});
