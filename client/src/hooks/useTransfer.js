import { useCallback, useRef, useState } from 'react';
import { api, openEvents, uploadTransfer } from '../api.js';

const BUSY = ['uploading', 'connecting', 'sending', 'finishing'];
let logCounter = 0; // crypto.randomUUID is unavailable on plain-http LAN pages, so use a counter

export function useTransfer({ onFinished } = {}) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState('');
  const [log, setLog] = useState([]);
  const [alert, setAlert] = useState('');
  const refs = useRef({ busy: false, upload: null, id: null, es: null });
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const addLog = useCallback((message, level = 'info', ts = Date.now()) => {
    setLog((prev) => [...prev.slice(-499), { id: ++logCounter, ts, level, message }]);
  }, []);
  const clearLog = useCallback(() => setLog([]), []);

  const endWith = useCallback((nextPhase, text = '') => {
    const r = refs.current;
    r.es?.close();
    r.es = null;
    r.id = null;
    r.busy = false;
    setPhase(nextPhase);
    setDetail(text);
  }, []);

  const handleEvent = useCallback((evt) => {
    switch (evt.type) {
      case 'log':
        addLog(evt.message, evt.level, evt.ts);
        break;
      case 'phase':
        if (evt.phase !== 'connected') setPhase(evt.phase);
        break;
      case 'progress':
        setPhase((p) => (p === 'finishing' ? p : 'sending'));
        setProgress((prev) => Math.max(prev, evt.total ? evt.sent / evt.total : 0));
        break;
      case 'done': {
        const map = { sent: 'finished', cancelled: 'cancelled', timedOut: 'timedOut', failed: 'failed' };
        if (evt.outcome === 'sent') setProgress(1);
        endWith(map[evt.outcome] ?? 'failed', evt.outcome === 'cancelled' ? '' : evt.detail);
        navigator.vibrate?.(evt.outcome === 'sent' ? 40 : [60, 40, 60]);
        onFinishedRef.current?.();
        break;
      }
      default:
    }
  }, [addLog, endWith]);

  const send = useCallback(async (file, target) => {
    const r = refs.current;
    if (r.busy) return; // duplicate-send protection
    r.busy = true;
    setAlert('');
    setPhase('uploading');
    setProgress(0);
    setDetail('');
    navigator.vibrate?.(15);
    addLog(`Uploading “${file.name}” to the NetPayload server…`);

    const upload = uploadTransfer({ file, target, onProgress: setProgress });
    r.upload = upload;
    try {
      const { id } = await upload.promise;
      r.upload = null;
      r.id = id;
      setProgress(0);
      setPhase('connecting');
      r.es = openEvents(id, handleEvent, () => {
        const message = 'Lost the connection to the NetPayload server. The transfer may still be running; check the history.';
        addLog(message, 'error');
        endWith('failed', message);
      });
    } catch (e) {
      r.upload = null;
      if (e.code === 'CANCELLED') {
        addLog('Upload cancelled.', 'warning');
        endWith('cancelled');
      } else {
        addLog(e.message, 'error');
        setAlert(e.message);
        endWith('failed', e.message);
      }
    }
  }, [addLog, endWith, handleEvent]);

  const cancel = useCallback(async () => {
    const r = refs.current;
    if (r.upload) {
      r.upload.abort();
      return;
    }
    if (r.id) {
      addLog('Cancelling…', 'warning');
      try {
        await api.cancelTransfer(r.id);
      } catch (e) {
        addLog(e.message, 'error');
      }
    }
  }, [addLog]);

  return { phase, progress, detail, log, alert, setAlert, busy: BUSY.includes(phase), send, cancel, clearLog, addLog };
}
