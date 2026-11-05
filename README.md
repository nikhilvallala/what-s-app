# WhatsApp Clone

Real-time one-to-one chat built with React (Vite), Node.js, Express, Socket.IO and MongoDB.

## Features
- Sign up / log in (JWT, bcrypt-hashed passwords)
- Contact list with search, unread badges, last-message preview
- Real-time messaging with sent / delivered / read ticks
- Online presence, last seen, typing indicator
- Persisted message history

## Run locally
Requires Node.js 18+.

```bash
cd server && npm install && npm run dev    # http://localhost:4000
cd client && npm install && npm run dev    # http://localhost:5173
```

The server uses an in-memory MongoDB by default (data resets on restart).
To persist data, copy `server/.env.example` to `server/.env` and set `MONGO_URI`
(e.g. a MongoDB Atlas connection string) and a strong `JWT_SECRET`.

Open two browser windows (one normal, one incognito), register two accounts and chat.
