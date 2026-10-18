import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { formatBytes, formatDateTime } from '../format.js';
import { hostError, normalizeHost, portError } from '../validation.js';

export function Drawer({ title, onClose, children, actions }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <div className="row">
            {actions}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function ProfilesPanel({ profiles, dbReady, busy, onApply, onEdit, onAdd, onDelete, onClose, error }) {
  return (
    <Drawer title="Saved profiles" onClose={onClose}
      actions={<button type="button" className="icon-btn" onClick={onAdd} aria-label="Add profile" disabled={!dbReady}><Icon name="plus" /></button>}>
      {!dbReady && <p className="banner warn">{error || 'MongoDB is not connected, so profiles are unavailable. Sending still works.'}</p>}
      {dbReady && profiles.length === 0 && <p className="muted center">No saved profiles yet. Save an IP address, port and protocol to reuse it.</p>}
      <ul className="list">
        {profiles.map((p) => (
          <li key={p.id} className="list-item">
            <button type="button" className="list-main" disabled={busy} onClick={() => onApply(p)}>
              <strong>{p.name}</strong>
              <span className="muted">{p.transport} · {p.host}:{p.port}</span>
            </button>
            <button type="button" className="icon-btn" onClick={() => onEdit(p)} aria-label={`Edit ${p.name}`}><Icon name="edit" size={18} /></button>
            <button type="button" className="icon-btn danger" onClick={() => onDelete(p)} aria-label={`Delete ${p.name}`}><Icon name="trash" size={18} /></button>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

export function ProfileEditor({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial.name ?? '');
  const [host, setHost] = useState(initial.host ?? '');
  const [port, setPort] = useState(String(initial.port ?? 9020));
  const [transport, setTransport] = useState(initial.transport ?? 'TCP');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const problem = !host.trim() ? 'Enter the device’s IP address.' : hostError(host) || (!port.trim() ? 'Enter a port number (1–65535).' : portError(port));
    if (problem) return setError(problem);
    setSaving(true);
    try {
      await onSave({ id: initial.id, name: name.trim(), host: normalizeHost(host), port: Number(port), transport });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Drawer title={initial.id ? 'Edit profile' : 'New profile'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living room console" maxLength={60} /></label>
        <label className="field"><span>IP address</span><input value={host} onChange={(e) => setHost(e.target.value)} inputMode="decimal" autoCapitalize="none" spellCheck={false} /></label>
        <label className="field"><span>Port</span><input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" /></label>
        <div className="segmented" role="radiogroup" aria-label="Protocol">
          {['TCP', 'UDP'].map((t) => (
            <button key={t} type="button" role="radio" aria-checked={transport === t} className={transport === t ? 'active' : ''} onClick={() => setTransport(t)}>{t}</button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary small" disabled={saving}>Save</button>
        </div>
      </form>
    </Drawer>
  );
}

const OUTCOME = {
  sent: { label: 'Sent', icon: 'check', cls: 'ok' },
  cancelled: { label: 'Cancelled', icon: 'x', cls: 'warn' },
  timedOut: { label: 'Timed out', icon: 'clock', cls: 'warn' },
  failed: { label: 'Failed', icon: 'alert', cls: 'bad' },
};

export function HistoryPanel({ records, dbReady, onClear, onClose, error }) {
  return (
    <Drawer title="Transfer history" onClose={onClose}
      actions={<button type="button" className="icon-btn danger" onClick={onClear} aria-label="Clear history" disabled={!records.length}><Icon name="trash" /></button>}>
      {!dbReady && <p className="banner warn">{error || 'MongoDB is not connected, so history is unavailable. Sending still works.'}</p>}
      {dbReady && records.length === 0 && <p className="muted center">No transfers yet. Payload contents are never stored.</p>}
      <ul className="list">
        {records.map((r) => {
          const o = OUTCOME[r.outcome] ?? OUTCOME.failed;
          return (
            <li key={r.id} className="list-item history">
              <span className={`pill ${o.cls}`}><Icon name={o.icon} size={16} /></span>
              <div className="grow">
                <strong className="filename">{r.filename}</strong>
                <div className="muted small">{o.label} · {r.transport} · {r.host}:{r.port} · {formatBytes(r.byteCount)}</div>
                <div className="muted tiny">{formatDateTime(r.time)}</div>
                {r.outcome !== 'sent' && r.detail && <div className="muted small">{r.detail}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}
