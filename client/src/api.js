const PIN_KEY = 'netpayload.pin';
export const getPin = () => sessionStorage.getItem(PIN_KEY) || '';
export const setPin = (pin) => sessionStorage.setItem(PIN_KEY, pin);

export class ApiError extends Error {
  constructor(message, code = 'ERROR', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const authHeaders = (extra = {}) => (getPin() ? { 'x-access-pin': getPin(), ...extra } : extra);

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the NetPayload server.', 'NETWORK');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.message || `Request failed (${res.status}).`, data?.error?.code, res.status);
  return data;
}

export const api = {
  config: () => request('/config'),
  profiles: {
    list: () => request('/profiles'),
    create: (p) => request('/profiles', { method: 'POST', body: p }),
    update: (id, p) => request(`/profiles/${id}`, { method: 'PUT', body: p }),
    remove: (id) => request(`/profiles/${id}`, { method: 'DELETE' }),
  },
  history: {
    list: () => request('/history'),
    clear: () => request('/history', { method: 'DELETE' }),
  },
  cancelTransfer: (id) => request(`/transfers/${id}`, { method: 'DELETE' }),
};

/** Uploads the file to the server (XHR gives real upload progress). The server then sends it to the device. */
export function uploadTransfer({ file, target, onProgress }) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', '/api/transfers');
    if (getPin()) xhr.setRequestHeader('x-access-pin', getPin());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.id) resolve(data);
      else reject(new ApiError(data?.error?.message || `Upload failed (${xhr.status}).`, data?.error?.code, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Could not reach the NetPayload server.', 'NETWORK'));
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 'CANCELLED'));
    const form = new FormData();
    form.append('host', target.host);
    form.append('port', String(target.port));
    form.append('transport', target.transport);
    form.append('filename', file.name);
    form.append('file', file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Server-Sent Events for live progress. EventSource cannot set headers, so the PIN goes in the query string. */
export function openEvents(id, onEvent, onFail) {
  const pin = getPin();
  const es = new EventSource(`/api/transfers/${id}/events${pin ? `?pin=${encodeURIComponent(pin)}` : ''}`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) onFail();
  };
  return es;
}
