import test from 'node:test';
import assert from 'node:assert/strict';
import { guardRequests, createPinGuard } from '../src/security.js';

const run = (mw, req) => { let err = null; mw(req, {}, (e) => { err = e ?? null; }); return err; };

test('same-origin and non-browser requests are allowed', () => {
  const g = guardRequests();
  assert.equal(run(g, { headers: { host: 'localhost:5000' } }), null);
  assert.equal(run(g, { headers: { host: '192.168.1.20:5000', origin: 'http://192.168.1.20:5000' } }), null);
  assert.equal(run(g, { headers: { host: '[::1]:5000' } }), null);
});

test('CSRF: a page on another site cannot call the API', () => {
  const g = guardRequests();
  for (const origin of ['https://evil.example', 'http://localhost:9999', 'null']) {
    const err = run(g, { headers: { host: 'localhost:5000', origin } });
    assert.equal(err?.code, 'FORBIDDEN', origin);
  }
  assert.equal(run(g, { headers: { host: 'localhost:5000', 'sec-fetch-site': 'cross-site' } })?.code, 'FORBIDDEN');
});

test('DNS rebinding: unknown hostnames are rejected unless listed', () => {
  assert.equal(run(guardRequests(), { headers: { host: 'attacker.example:5000' } })?.code, 'FORBIDDEN');
  assert.equal(run(guardRequests({ allowedHosts: ['my-mac.local'] }), { headers: { host: 'my-mac.local:5000' } }), null);
});

test('PIN: correct PIN passes, wrong PIN fails, repeated guessing locks out', () => {
  let t = 0;
  const g = createPinGuard('1234', { maxFailures: 3, windowMs: 1000, now: () => t });
  const req = (pin) => ({ ip: '10.0.0.9', headers: pin === undefined ? {} : { 'x-access-pin': pin }, query: {} });
  assert.equal(run(g, req('1234')), null);
  assert.equal(run(g, req())?.code, 'UNAUTHORIZED'); // missing PIN is not counted as a guess
  for (let i = 0; i < 3; i++) assert.equal(run(g, req('0000'))?.code, 'UNAUTHORIZED');
  assert.equal(run(g, req('1234'))?.code, 'TOO_MANY_ATTEMPTS'); // locked out even with the right PIN
  t = 2000; // window expires
  assert.equal(run(g, req('1234')), null);
});

test('no PIN configured means no PIN check', () => {
  assert.equal(run(createPinGuard(''), { headers: {}, query: {} }), null);
});
