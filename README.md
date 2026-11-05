# WhatsApp Clone

Real-time chat built with React (Vite), Node.js, Express, Socket.IO and MongoDB.

## Features
- Sign up / log in (JWT, bcrypt-hashed passwords)
- One-to-one chats and **group chats** (create, leave, sender names, group typing)
- **Image, video, audio and file sharing** (up to 20 MB), with inline previews
- Sent / delivered / read ticks (group messages turn blue once every member has read them)
- Online presence, last seen, typing indicator, unread badges, search
- **Persistent storage**: data survives server restarts

## Run locally
Requires Node.js 18+.

```bash
cd server && npm install && npm run dev    # http://localhost:4000
cd client && npm install && npm run dev    # http://localhost:5173
```

With no configuration, the server runs a local MongoDB that stores data in `server/data/db`
and uploaded files in `server/uploads/` (both git-ignored).
To use your own MongoDB (e.g. MongoDB Atlas), copy `server/.env.example` to `server/.env`
and set `MONGO_URI` and a strong `JWT_SECRET`.

Open two browser windows (one normal, one incognito), register accounts and chat.

## Tests
With the server running:
```bash
cd client
node e2e-test.mjs          # auth, messaging, receipts, uploads, groups, presence
node e2e-test.mjs save     # same, then restart the server and run:
node e2e-persist.mjs       # verifies data survived the restart
```
