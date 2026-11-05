import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api.js';

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const ticks = { sending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓' };

export default function Chat({ token, me, onLogout }) {
  const [users, setUsers] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({}); // userId -> message[]
  const [unread, setUnread] = useState({});
  const [typing, setTyping] = useState({});
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const socketRef = useRef(null);
  const activeRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const loaded = useRef(new Set());
  activeRef.current = activeId;

  const otherOf = (m) => (m.from === me.id ? m.to : m.from);

  const upsert = (userId, msg, tempId) =>
    setMessages((prev) => {
      const list = prev[userId] || [];
      if (list.some((m) => m.id === msg.id)) return prev;
      const idx = tempId ? list.findIndex((m) => m.id === tempId) : -1;
      const next = idx >= 0 ? list.map((m, i) => (i === idx ? msg : m)) : [...list, msg];
      return { ...prev, [userId]: next };
    });

  useEffect(() => {
    api('/users', { token }).then(({ users }) => setUsers(users));

    const socket = io({ auth: { token } });
    socketRef.current = socket;

    socket.on('connect_error', (e) => e.message === 'Unauthorized' && onLogout());

    socket.on('message:new', (m) => {
      const other = otherOf(m);
      upsert(other, m);
      if (m.from !== me.id) {
        if (activeRef.current === other && document.hasFocus()) {
          socket.emit('message:read', { from: other });
        } else {
          setUnread((u) => ({ ...u, [other]: (u[other] || 0) + 1 }));
        }
      }
      // new user registered after we loaded the list
      setUsers((list) => {
        if (!list.some((u) => u.id === other)) api('/users', { token }).then(({ users }) => setUsers(users));
        return list;
      });
    });

    socket.on('message:status', ({ ids, status }) => {
      const set = new Set(ids);
      setMessages((prev) => {
        const next = {};
        for (const [k, list] of Object.entries(prev)) {
          next[k] = list.map((m) => (set.has(m.id) ? { ...m, status } : m));
        }
        return next;
      });
    });

    socket.on('presence', ({ userId, online, lastSeen }) => {
      setUsers((list) => {
        if (!list.some((u) => u.id === userId)) {
          api('/users', { token }).then(({ users }) => setUsers(users));
          return list;
        }
        return list.map((u) => (u.id === userId ? { ...u, online, lastSeen: lastSeen || u.lastSeen } : u));
      });
    });

    socket.on('typing', ({ from, typing }) => setTyping((t) => ({ ...t, [from]: typing })));

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function openChat(id) {
    setActiveId(id);
    setUnread((u) => ({ ...u, [id]: 0 }));
    if (!loaded.current.has(id)) {
      loaded.current.add(id);
      const { messages: list } = await api(`/messages/${id}`, { token });
      setMessages((prev) => {
        const ids = new Set(list.map((m) => m.id));
        return { ...prev, [id]: [...list, ...(prev[id] || []).filter((m) => !ids.has(m.id))] };
      });
    }
    socketRef.current?.emit('message:read', { from: id });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeId]);

  function send(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;
    const tempId = `tmp-${Date.now()}`;
    upsert(activeId, { id: tempId, from: me.id, to: activeId, text, status: 'sending', createdAt: new Date() });
    setDraft('');
    socketRef.current.emit('typing', { to: activeId, typing: false });
    const to = activeId;
    socketRef.current.emit('message:send', { to, text, tempId }, (res) => {
      if (res.ok) upsert(to, res.message, tempId);
    });
  }

  function onDraft(e) {
    setDraft(e.target.value);
    if (!activeId) return;
    socketRef.current.emit('typing', { to: activeId, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socketRef.current.emit('typing', { to: activeId, typing: false }), 1500);
  }

  const visibleUsers = useMemo(() => {
    const q = search.toLowerCase();
    const last = (u) => {
      const list = messages[u.id];
      return list?.length ? new Date(list[list.length - 1].createdAt).getTime() : 0;
    };
    return users
      .filter((u) => u.name.toLowerCase().includes(q) || u.username.includes(q))
      .sort((a, b) => last(b) - last(a));
  }, [users, search, messages]);

  const active = users.find((u) => u.id === activeId);
  const thread = messages[activeId] || [];

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="side-header">
          <div className="avatar">{me.name[0].toUpperCase()}</div>
          <span className="me-name">{me.name}</span>
          <button className="link" onClick={onLogout}>Log out</button>
        </header>
        <input className="search" placeholder="Search or start new chat" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="contacts">
          {visibleUsers.length === 0 && <li className="empty">No other users yet. Register a second account to chat.</li>}
          {visibleUsers.map((u) => {
            const list = messages[u.id];
            const lastMsg = list?.[list.length - 1];
            return (
              <li key={u.id} className={u.id === activeId ? 'active' : ''} onClick={() => openChat(u.id)}>
                <div className="avatar">
                  {u.name[0].toUpperCase()}
                  {u.online && <span className="dot" />}
                </div>
                <div className="contact-info">
                  <div className="row">
                    <span className="name">{u.name}</span>
                    {lastMsg && <span className="time">{fmtTime(lastMsg.createdAt)}</span>}
                  </div>
                  <div className="row">
                    <span className="preview">{typing[u.id] ? <em>typing…</em> : lastMsg?.text || `@${u.username}`}</span>
                    {unread[u.id] > 0 && <span className="badge">{unread[u.id]}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      <main className="chat">
        {!active ? (
          <div className="placeholder">Select a chat to start messaging</div>
        ) : (
          <>
            <header className="chat-header">
              <div className="avatar">{active.name[0].toUpperCase()}</div>
              <div>
                <div className="name">{active.name}</div>
                <div className="status">
                  {typing[active.id] ? 'typing…' : active.online ? 'online' : `last seen ${new Date(active.lastSeen).toLocaleString()}`}
                </div>
              </div>
            </header>
            <div className="messages">
              {thread.map((m) => (
                <div key={m.id} className={`bubble ${m.from === me.id ? 'mine' : 'theirs'}`}>
                  <span className="text">{m.text}</span>
                  <span className="meta">
                    {fmtTime(m.createdAt)}
                    {m.from === me.id && <span className={`ticks ${m.status}`}>{ticks[m.status]}</span>}
                  </span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form className="composer" onSubmit={send}>
              <input placeholder="Type a message" value={draft} onChange={onDraft} autoFocus />
              <button disabled={!draft.trim()}>Send</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
