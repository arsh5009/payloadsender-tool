import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHost, parsePort, parseTransport, classifyAddress, assertTargetAllowed, validateSize, isValidIPv4,
} from '../src/validation.js';

test('valid IPv4 and IPv6 hosts', () => {
  assert.equal(validateHost('192.168.1.100'), '192.168.1.100');
  assert.equal(validateHost('  10.0.0.5 \n'), '10.0.0.5');
  assert.equal(validateHost('::1'), '::1');
  assert.equal(validateHost('[fe80::1]'), 'fe80::1');
});

test('invalid hosts are rejected', () => {
  for (const bad of ['', '   ', '256.1.1.1', '1.2.3', '1.2.3.4.5', 'a.b.c.d', '192.168.01.1', '192.168.1.', '-1.2.3.4',
    '1..2.3', '0.0.0.0', '255.255.255.255', 'host.local', 'fe80::zz', null, undefined]) {
    assert.throws(() => validateHost(bad), (e) => e.code === 'INVALID_HOST', `${bad} should be rejected`);
  }
  assert.equal(isValidIPv4('1.2.3.4'), true);
});

test('ports', () => {
  assert.equal(parsePort('9020'), 9020);
  assert.equal(parsePort(' 1 '), 1);
  assert.equal(parsePort(65535), 65535);
  for (const bad of ['', '0', '65536', '-1', '12a', '1.5', '999999', null]) {
    assert.throws(() => parsePort(bad), (e) => e.code === 'INVALID_PORT', `${bad} should be rejected`);
  }
});

test('transport', () => {
  assert.equal(parseTransport('tcp'), 'TCP');
  assert.equal(parseTransport('UDP'), 'UDP');
  assert.throws(() => parseTransport('icmp'), (e) => e.code === 'INVALID_TRANSPORT');
});

test('address classification', () => {
  assert.equal(classifyAddress('192.168.0.2'), 'private');
  assert.equal(classifyAddress('10.1.2.3'), 'private');
  assert.equal(classifyAddress('172.16.0.1'), 'private');
  assert.equal(classifyAddress('172.32.0.1'), 'public');
  assert.equal(classifyAddress('8.8.8.8'), 'public');
  assert.equal(classifyAddress('127.0.0.1'), 'loopback');
  assert.equal(classifyAddress('169.254.169.254'), 'link-local');
  assert.equal(classifyAddress('fe80::1'), 'private');
  assert.equal(classifyAddress('fd12::1'), 'private');
  assert.equal(classifyAddress('::ffff:169.254.169.254'), 'link-local');
  assert.equal(classifyAddress('2001:db8::1'), 'public');
});

test('server only targets private addresses by default', () => {
  assertTargetAllowed('192.168.1.5');
  for (const blocked of ['8.8.8.8', '169.254.169.254', '127.0.0.1', '::ffff:169.254.169.254']) {
    assert.throws(() => assertTargetAllowed(blocked), (e) => e.code === 'TARGET_NOT_ALLOWED' && e.status === 403, blocked);
  }
  assertTargetAllowed('127.0.0.1', { allowLoopbackTargets: true });
  assertTargetAllowed('8.8.8.8', { allowPublicTargets: true });
});

test('size limits', () => {
  const limits = { maxTcpBytes: 1000, maxUdpBytes: 100 };
  validateSize(1, 'TCP', limits);
  assert.throws(() => validateSize(0, 'TCP', limits), (e) => e.code === 'FILE_EMPTY');
  assert.throws(() => validateSize(101, 'UDP', limits), (e) => e.code === 'FILE_TOO_LARGE');
  validateSize(101, 'TCP', limits);
  assert.throws(() => validateSize(1001, 'TCP', limits), (e) => e.code === 'FILE_TOO_LARGE');
});
