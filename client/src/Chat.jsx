import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api.js';
import NewGroupDialog from './NewGroupDialog.jsx';

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const ticks = { sending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠' };
const initial = (s) => (s || '?')[0].toUpperCase();

function Attachment({ a }) {
  if (a.mime?.startsWith('image/')) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer">
        <img className="att-img" src={a.url} alt={a.name} />
      </a>
    );
  }
  if (a.mime?.startsWith('video/')) return <video className="att-img" src={a.url} controls />;
  if (a.mime?.startsWith('audio/')) return <audio src={a.url} controls />;
  return (
    <a className="att-file" href={a.url} target="_blank" rel="noreferrer" download={a.name}>
      📄 <span>{a.name}</span> <small>{fmtSize(a.size)}</small>
    </a>
  );
}

export default function Chat({ token, me, onLogout }) {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({}); // chatId -> message[]
  const [unread, setUnread] = useState({});
  const [typing, setTyping] = useState({}); // chatId -> userId typing (or null)
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef(null);
  const activeRef = useRef(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const loaded = useRef(new Set());
  activeRef.current = activeId;

  const chatKey = (m) => m.group || (m.from === me.id ? m.to : m.from);

  const upsert = (key, msg, tempId) =>
    setMessages((prev) => {
      const list = prev[key] || [];
      if (list.some((m) => m.id === msg.id)) return prev;
      const idx = tempId ? list.findIndex((m) => m.id === tempId) : -1;
      const next = idx >= 0 ? list.map((m, i) => (i === idx ? msg : m)) : [...list, msg];
      return { ...prev, [key]: next };
    });

  const refreshUsers = () => api('/users', { token }).then(({ users }) => setUsers(users));

  useEffect(() => {
    refreshUsers();
    api('/groups', { token }).then(({ groups }) => setGroups(groups));

    const socket = io({ auth: { token } });
    socketRef.current = socket;

    socket.on('connect_error', (e) => e.message === 'Unauthorized' && onLogout());

    socket.on('message:new', (m) => {
      const key = chatKey(m);
      upsert(key, m);
      if (m.from !== me.id) {
        if (activeRef.current === key && document.hasFocus()) {
          socket.emit('message:read', m.group ? { group: key } : { from: key });
        } else {
          setUnread((u) => ({ ...u, [key]: (u[key] || 0) + 1 }));
        }
        setTyping((t) => ({ ...t, [key]: null }));
      }
      if (!m.group) {
        setUsers((list) => {
          if (!list.some((u) => u.id === key)) refreshUsers();
          return list;
        });
      }
    });

    socket.on('message:status', ({ ids, status }) => {
      const set = new Set(ids);
      setMessages((prev) => {
        const next = {};
        for (const [k, list] of Object.entries(prev)) next[k] = list.map((m) => (set.has(m.id) ? { ...m, status } : m));
        return next;
      });
    });

    socket.on('presence', ({ userId, online, lastSeen }) => {
      setUsers((list) => {
        if (!list.some((u) => u.id === userId)) {
          refreshUsers();
          return list;
        }
        return list.map((u) => (u.id === userId ? { ...u, online, lastSeen: lastSeen || u.lastSeen } : u));
      });
    });

    socket.on('typing', ({ from, group, typing }) => {
      const key = group || from;
      setTyping((t) => ({ ...t, [key]: typing ? from : null }));
    });

    socket.on('group:new', (g) => setGroups((list) => (list.some((x) => x.id === g.id) ? list : [...list, g])));
    socket.on('group:update', (g) => setGroups((list) => list.map((x) => (x.id === g.id ? g : x))));

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const chats = useMemo(() => [...groups, ...users.map((u) => ({ ...u, isGroup: false }))], [users, groups]);
  const active = chats.find((c) => c.id === activeId);
  const nameOf = (id) => (id === me.id ? 'You' : users.find((u) => u.id === id)?.name || 'Unknown');

  async function openChat(id) {
    setActiveId(id);
    setError('');
    setUnread((u) => ({ ...u, [id]: 0 }));
    const isGroup = groups.some((g) => g.id === id);
    if (!loaded.current.has(id)) {
      loaded.current.add(id);
      const { messages: list } = await api(`/messages/${id}`, { token });
      setMessages((prev) => {
        const ids = new Set(list.map((m) => m.id));
        return { ...prev, [id]: [...list, ...(prev[id] || []).filter((m) => !ids.has(m.id))] };
      });
    }
    socketRef.current?.emit('message:read', isGroup ? { group: id } : { from: id });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeId]);

  function emitSend({ text = '', attachment }) {
    const chat = active;
    if (!chat) return;
    const tempId = `tmp-${Date.now()}-${Math.random()}`;
    const target = chat.isGroup ? { group: chat.id } : { to: chat.id };
    upsert(chat.id, { id: tempId, from: me.id, ...target, text, attachment, status: 'sending', createdAt: new Date() });
    socketRef.current.emit('message:send', { ...target, text, attachment, tempId }, (res) => {
      if (res.ok) upsert(chat.id, res.message, tempId);
      else {
        setError(res.error);
        setMessages((prev) => ({
          ...prev,
          [chat.id]: (prev[chat.id] || []).map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)),
        }));
      }
    });
  }

  function typingTarget() {
    return active?.isGroup ? { group: active.id } : { to: active?.id };
  }

  function send(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active) return;
    setDraft('');
    socketRef.current.emit('typing', { ...typingTarget(), typing: false });
    emitSend({ text });
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !active) return;
    if (file.size > 20 * 1024 * 1024) return setError('File is larger than 20 MB');
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      emitSend({ text: draft.trim(), attachment: data.attachment });
      setDraft('');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function onDraft(e) {
    setDraft(e.target.value);
    if (!active) return;
    const target = typingTarget();
    socketRef.current.emit('typing', { ...target, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socketRef.current.emit('typing', { ...target, typing: false }), 1500);
  }

  async function createGroup(name, members) {
    const { group } = await api('/groups', { token, method: 'POST', body: { name, members } });
    setGroups((list) => (list.some((g) => g.id === group.id) ? list : [...list, group]));
    setShowNewGroup(false);
    openChat(group.id);
  }

  async function leaveGroup() {
    if (!active?.isGroup || !confirm(`Leave "${active.name}"?`)) return;
    await api(`/groups/${active.id}/leave`, { token, method: 'POST' });
    setGroups((list) => list.filter((g) => g.id !== active.id));
    setActiveId(null);
  }

  const visibleChats = useMemo(() => {
    const q = search.toLowerCase();
    const last = (c) => {
      const list = messages[c.id];
      return list?.length ? new Date(list[list.length - 1].createdAt).getTime() : 0;
    };
    return chats
      .filter((c) => c.name.toLowerCase().includes(q) || c.username?.includes(q))
      .sort((a, b) => last(b) - last(a));
  }, [chats, search, messages]);

  const preview = (c) => {
    const t = typing[c.id];
    if (t) return <em>{c.isGroup ? `${nameOf(t)} is typing…` : 'typing…'}</em>;
    const list = messages[c.id];
    const m = list?.[list.length - 1];
    if (!m) return c.isGroup ? `${c.members.length} members` : `@${c.username}`;
    const body = m.text || (m.attachment ? `📎 ${m.attachment.name}` : '');
    return c.isGroup ? `${nameOf(m.from)}: ${body}` : body;
  };

  const headerStatus = () => {
    if (!active) return '';
    const t = typing[active.id];
    if (active.isGroup) {
      if (t) return `${nameOf(t)} is typing…`;
      return active.members.map(nameOf).join(', ');
    }
    if (t) return 'typing…';
    return active.online ? 'online' : `last seen ${new Date(active.lastSeen).toLocaleString()}`;
  };

  const thread = messages[activeId] || [];

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="side-header">
          <div className="avatar">{initial(me.name)}</div>
          <span className="me-name">{me.name}</span>
          <button className="link" onClick={() => setShowNewGroup(true)} title="New group">+ Group</button>
          <button className="link" onClick={onLogout}>Log out</button>
        </header>
        <input className="search" placeholder="Search or start new chat" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="contacts">
          {visibleChats.length === 0 && <li className="empty">No other users yet. Register a second account to chat.</li>}
          {visibleChats.map((c) => {
            const list = messages[c.id];
            const lastMsg = list?.[list.length - 1];
            return (
              <li key={c.id} className={c.id === activeId ? 'active' : ''} onClick={() => openChat(c.id)}>
                <div className={`avatar ${c.isGroup ? 'group' : ''}`}>
                  {c.isGroup ? '👥' : initial(c.name)}
                  {c.online && <span className="dot" />}
                </div>
                <div className="contact-info">
                  <div className="row">
                    <span className="name">{c.name}</span>
                    {lastMsg && <span className="time">{fmtTime(lastMsg.createdAt)}</span>}
                  </div>
                  <div className="row">
                    <span className="preview">{preview(c)}</span>
                    {unread[c.id] > 0 && <span className="badge">{unread[c.id]}</span>}
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
              <button className="back link" onClick={() => setActiveId(null)}>←</button>
              <div className={`avatar ${active.isGroup ? 'group' : ''}`}>{active.isGroup ? '👥' : initial(active.name)}</div>
              <div className="header-info">
                <div className="name">{active.name}</div>
                <div className="status">{headerStatus()}</div>
              </div>
              {active.isGroup && <button className="link" onClick={leaveGroup}>Leave</button>}
            </header>
            <div className="messages">
              {thread.map((m) => (
                <div key={m.id} className={`bubble ${m.from === me.id ? 'mine' : 'theirs'}`}>
                  {active.isGroup && m.from !== me.id && <div className="sender">{nameOf(m.from)}</div>}
                  {m.attachment && <Attachment a={m.attachment} />}
                  <div className="bubble-body">
                    {m.text && <span className="text">{m.text}</span>}
                    <span className="meta">
                      {fmtTime(m.createdAt)}
                      {m.from === me.id && <span className={`ticks ${m.status}`}>{ticks[m.status]}</span>}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            {error && <div className="chat-error" onClick={() => setError('')}>{error}</div>}
            <form className="composer" onSubmit={send}>
              <input type="file" ref={fileRef} hidden onChange={onFile} />
              <button type="button" className="attach" onClick={() => fileRef.current.click()} disabled={uploading} title="Attach file">
                {uploading ? '⏳' : '📎'}
              </button>
              <input placeholder="Type a message" value={draft} onChange={onDraft} autoFocus />
              <button disabled={!draft.trim()}>Send</button>
            </form>
          </>
        )}
      </main>

      {showNewGroup && <NewGroupDialog users={users} onCreate={createGroup} onClose={() => setShowNewGroup(false)} />}
    </div>
  );
}
