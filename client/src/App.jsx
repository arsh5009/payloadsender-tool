import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './components/Icon.jsx';
import { LogCard, NotesCard, PayloadCard, StatusCard, TargetCard } from './components/Cards.jsx';
import { HistoryPanel, ProfileEditor, ProfilesPanel } from './components/Panels.jsx';
import { api, getPin, setPin } from './api.js';
import { useTransfer } from './hooks/useTransfer.js';
import { fileProblem, hostError, isPrivateAddress, normalizeHost, portError } from './validation.js';

const LAST_KEY = 'netpayload.lastTarget';

function loadLast() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
    return { host: v.host || '', port: v.port || '9020', transport: v.transport === 'UDP' ? 'UDP' : 'TCP' };
  } catch {
    return { host: '', port: '9020', transport: 'TCP' };
  }
}

export default function App() {
  const last = useMemo(loadLast, []);
  const [host, setHost] = useState(last.host);
  const [port, setPort] = useState(last.port);
  const [transport, setTransport] = useState(last.transport);
  const [file, setFile] = useState(null);

  const [config, setConfig] = useState(null);
  const [needPin, setNeedPin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [serverDown, setServerDown] = useState(false);

  const [panel, setPanel] = useState(null); // 'profiles' | 'history' | null
  const [profiles, setProfiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [dbError, setDbError] = useState('');
  const [editing, setEditing] = useState(null);

  const dbReady = Boolean(config?.db) && !dbError;

  const refreshProfiles = useCallback(async () => {
    try { setProfiles(await api.profiles.list()); setDbError(''); } catch (e) { setDbError(e.message); }
  }, []);
  const refreshHistory = useCallback(async () => {
    try { setHistory(await api.history.list()); setDbError(''); } catch (e) { setDbError(e.message); }
  }, []);

  const transfer = useTransfer({ onFinished: refreshHistory });

  const loadConfig = useCallback(async () => {
    try {
      const c = await api.config();
      setConfig(c);
      setServerDown(false);
      setNeedPin(c.pinRequired && !getPin());
      if (c.db && (!c.pinRequired || getPin())) { refreshProfiles(); refreshHistory(); }
    } catch {
      setServerDown(true);
    }
  }, [refreshProfiles, refreshHistory]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const hErr = hostError(host);
  const pErr = portError(port);
  const fProblem = fileProblem(file, transport, config);
  const hasTarget = host.trim() && port.trim() && !hErr && !pErr;
  const canSend = !transfer.busy && file && !fProblem && hasTarget && !serverDown && !needPin;

  const onSend = () => {
    const target = { host: normalizeHost(host), port: Number(port), transport };
    localStorage.setItem(LAST_KEY, JSON.stringify({ host: target.host, port: String(target.port), transport }));
    if (!isPrivateAddress(target.host)) {
      transfer.addLog(`${target.host} is not a private/local address. NetPayload is intended for devices on your local network.`, 'warning');
    }
    transfer.send(file, target);
  };

  const applyProfile = (p) => {
    setHost(p.host); setPort(String(p.port)); setTransport(p.transport);
    transfer.addLog(`Loaded profile “${p.name}”.`);
    setPanel(null);
  };

  const saveProfile = async (p) => {
    const body = { name: p.name, host: p.host, port: p.port, transport: p.transport };
    if (p.id) await api.profiles.update(p.id, body); else await api.profiles.create(body);
    setEditing(null);
    await refreshProfiles();
  };

  const deleteProfile = async (p) => {
    if (!window.confirm(`Delete “${p.name}”?`)) return;
    try { await api.profiles.remove(p.id); await refreshProfiles(); } catch (e) { transfer.setAlert(e.message); }
  };

  const clearHistory = async () => {
    if (!window.confirm('Clear all transfer history?')) return;
    try { await api.history.clear(); await refreshHistory(); } catch (e) { transfer.setAlert(e.message); }
  };

  const submitPin = async (e) => {
    e.preventDefault();
    setPin(pinInput.trim());
    setPinInput('');
    try {
      await api.history.list();
      setNeedPin(false);
      loadConfig();
    } catch (err) {
      if (err.status === 401) { setPin(''); transfer.setAlert('That PIN is not correct.'); setNeedPin(true); }
      else { setNeedPin(false); loadConfig(); } // PIN accepted; DB just isn't available
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setPanel('profiles')} aria-label="Saved profiles"><Icon name="bookmark" /></button>
        <h1>NetPayload</h1>
        <button type="button" className="icon-btn" onClick={() => { setPanel('history'); refreshHistory(); }} aria-label="Transfer history"><Icon name="clock" /></button>
      </header>

      <main className="column">
        {serverDown && <p className="banner bad dashboard-alert">Cannot reach the NetPayload server. Start it with <code>npm run dev</code> and reload.</p>}
        {transfer.alert && (
          <p className="banner bad dashboard-alert" role="alert">{transfer.alert} <button type="button" className="btn-link" onClick={() => transfer.setAlert('')}>Dismiss</button></p>
        )}

        {needPin && (
          <form className="card pin" onSubmit={submitPin}>
            <h2>Enter access PIN</h2>
            <p className="muted">This server is protected by a PIN.</p>
            <div className="row">
              <input type="password" inputMode="numeric" autoComplete="off" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="PIN" />
              <button type="submit" className="btn-primary small">Unlock</button>
            </div>
          </form>
        )}

        <div className="dashboard-grid">
          <div className="dashboard-stack">
            <TargetCard
              host={host} port={port} transport={transport}
              setHost={setHost} setPort={setPort} setTransport={setTransport}
              disabled={transfer.busy} hostError={hErr} portError={pErr} config={config}
              canSaveProfile={Boolean(hasTarget) && dbReady}
              onSaveProfile={() => setEditing({ name: '', host: normalizeHost(host), port: Number(port) || 9020, transport })}
            />
            <LogCard log={transfer.log} onClear={transfer.clearLog} />
            <NotesCard />
          </div>

          <div className="dashboard-stack">
            <PayloadCard file={file} problem={fProblem} disabled={transfer.busy} onPick={setFile} />
            <button type="button" className="btn-primary send-action" disabled={!canSend} onClick={onSend}>
              <Icon name="send" /> {transfer.busy ? 'Sending…' : 'Send Payload'}
            </button>
            <StatusCard phase={transfer.phase} progress={transfer.progress} detail={transfer.detail} busy={transfer.busy} onCancel={transfer.cancel} />
          </div>
        </div>
      </main>

      <footer className="app-footer">Build by Arsh Grewal</footer>

      {panel === 'profiles' && (
        <ProfilesPanel profiles={profiles} dbReady={dbReady} error={dbError} busy={transfer.busy}
          onClose={() => setPanel(null)} onApply={applyProfile} onEdit={setEditing}
          onAdd={() => setEditing({ name: '', host: '', port: 9020, transport: 'TCP' })} onDelete={deleteProfile} />
      )}
      {panel === 'history' && (
        <HistoryPanel records={history} dbReady={dbReady} error={dbError} onClear={clearHistory} onClose={() => setPanel(null)} />
      )}
      {editing && <ProfileEditor initial={editing} onSave={saveProfile} onClose={() => setEditing(null)} />}
    </div>
  );
}
