import { useState } from 'react';

export default function NewGroupDialog({ users, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a group name');
    if (!selected.size) return setError('Pick at least one member');
    setBusy(true);
    try {
      await onCreate(name.trim(), [...selected]);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New group</h2>
        <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="member-list">
          {users.length === 0 && <p className="empty">No other users yet.</p>}
          {users.map((u) => (
            <label key={u.id}>
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
              {u.name} <small>@{u.username}</small>
            </label>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button disabled={busy}>Create</button>
        </div>
      </form>
    </div>
  );
}
