import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { formatBytes, formatClock } from '../format.js';

export function Card({ title, icon, action, children, className = '' }) {
  return (
    <section className={`card ${className}`.trim()}>
      <header className="card-head">
        <h2><Icon name={icon} /> {title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function TargetCard({ host, port, transport, setHost, setPort, setTransport, disabled, hostError, portError, onSaveProfile, canSaveProfile, config }) {
  return (
    <Card title="Target" icon="server" className="target-card">
      <label className="field">
        <span>IP address</span>
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="192.168.1.100"
          inputMode="decimal"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={Boolean(hostError)}
          className={hostError ? 'invalid' : ''}
        />
        {hostError && <small className="error">{hostError}</small>}
      </label>
      <label className="field">
        <span>Port</span>
        <input
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
          placeholder="9020"
          inputMode="numeric"
          disabled={disabled}
          aria-invalid={Boolean(portError)}
          className={portError ? 'invalid' : ''}
        />
        {portError && <small className="error">{portError}</small>}
      </label>
      <div className="segmented" role="radiogroup" aria-label="Protocol">
        {['TCP', 'UDP'].map((t) => (
          <button key={t} type="button" role="radio" aria-checked={transport === t}
            className={transport === t ? 'active' : ''} disabled={disabled} onClick={() => setTransport(t)}>
            {t}
          </button>
        ))}
      </div>
      <p className={`hint ${transport === 'UDP' ? 'warn' : ''}`}>
        {transport === 'TCP'
          ? 'Reliable, ordered byte stream. Most payload listeners use TCP.'
          : 'Best-effort datagrams. UDP does not guarantee delivery, order or integrity, and no receipt is confirmed.'}
      </p>
      {config && !config.allowPublicTargets && (
        <p className="hint">The server only sends to private network addresses (10.x, 172.16–31.x, 192.168.x).</p>
      )}
      <div className="row">
        <button type="button" className="btn-link" onClick={onSaveProfile} disabled={!canSaveProfile}>
          <Icon name="bookmark" size={16} /> Save as profile
        </button>
      </div>
    </Card>
  );
}

export function PayloadCard({ file, problem, onPick, disabled }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const pick = (f) => f && onPick(f);
  return (
    <Card title="Payload" icon="file" className="payload-card">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) pick(e.dataTransfer.files?.[0]); }}
      >
        {file ? (
          <div className="file-row">
            <Icon name="file" size={28} />
            <div>
              <strong className="filename">{file.name}</strong>
              <div className="muted">{formatBytes(file.size)}</div>
            </div>
          </div>
        ) : (
          <p className="muted">Drop a file here, or choose one. Any file type works (.bin, .elf, .payload…).</p>
        )}
        {problem && <p className="error"><Icon name="alert" size={16} /> {problem}</p>}
        <input ref={input} type="file" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="btn-secondary" disabled={disabled} onClick={() => input.current?.click()}>
          {file ? 'Choose another file' : 'Choose file'}
        </button>
      </div>
    </Card>
  );
}

const PHASE_TITLES = {
  idle: 'Ready',
  uploading: 'Uploading to server…',
  connecting: 'Connecting to device…',
  sending: 'Sending to device…',
  finishing: 'Finishing…',
  finished: 'Payload sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timedOut: 'Timed out',
};
const PHASE_ICON = { idle: 'clock', uploading: 'upload', connecting: 'server', sending: 'send', finishing: 'clock', finished: 'check', failed: 'alert', cancelled: 'x', timedOut: 'clock' };

export function StatusCard({ phase, progress, detail, busy, onCancel }) {
  const determinate = phase === 'uploading' || phase === 'sending';
  return (
    <section className={`card status ${phase}`} aria-live="polite">
      <div className="status-row">
        <span className="status-icon"><Icon name={PHASE_ICON[phase]} size={26} /></span>
        <div className="grow">
          <h2>{PHASE_TITLES[phase]}</h2>
          {detail && <p className="muted">{detail}</p>}
        </div>
        {busy && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
      {busy && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={determinate ? Math.round(progress * 100) : undefined}>
          <div className={determinate ? 'bar' : 'bar indeterminate'} style={determinate ? { width: `${Math.round(progress * 100)}%` } : undefined} />
        </div>
      )}
      {busy && determinate && <small className="muted">{Math.round(progress * 100)}%</small>}
    </section>
  );
}

export function LogCard({ log, onClear }) {
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [log.length]);
  return (
    <Card
      title="Transfer Log"
      icon="list"
      className="log-card"
      action={<button type="button" className="btn-link danger" onClick={onClear} disabled={!log.length}><Icon name="trash" size={16} /> Clear Log</button>}
    >
      {log.length === 0 ? (
        <p className="muted">No activity yet.</p>
      ) : (
        <div className="log" ref={box}>
          {log.map((l) => (
            <div key={l.id} className={`log-line ${l.level}`}>
              <time>{formatClock(l.ts)}</time>
              <span>{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function NotesCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="card notes-card">
      <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2><Icon name="info" /> How it works &amp; delivery guarantees</h2>
        <span className={open ? 'chev open' : 'chev'}><Icon name="chevron" /></span>
      </button>
      {open && (
        <div className="notes">
          <p>Browsers cannot open raw TCP/UDP sockets, so your file is uploaded to the NetPayload server, which sends it to the device. The server must be on the same local network as the device.</p>
          <p>The target device must already be running a listener that accepts your file on the chosen port and protocol. A successful connection does not mean the payload was accepted: some receivers expect a specific handshake or header. NetPayload sends the file bytes exactly as they are.</p>
          <p>TCP is a reliable stream, but NetPayload can only report that the bytes were written and how the receiver closed the connection. UDP never confirms delivery.</p>
        </div>
      )}
    </section>
  );
}
