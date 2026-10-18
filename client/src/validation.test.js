import { describe, expect, it } from 'vitest';
import { fileProblem, hostError, isPrivateAddress, portError } from './validation.js';
import { formatBytes } from './format.js';

describe('validation', () => {
  it('accepts valid hosts and ignores empty input', () => {
    for (const ok of ['', '192.168.1.100', ' 10.0.0.5 ', '::1', '[fe80::1]']) expect(hostError(ok)).toBe('');
  });
  it('rejects invalid hosts', () => {
    for (const bad of ['256.1.1.1', '1.2.3', 'a.b.c.d', '192.168.01.1', '0.0.0.0', '255.255.255.255', 'host.local', 'fe80::zz']) {
      expect(hostError(bad), bad).not.toBe('');
    }
  });
  it('validates ports', () => {
    for (const ok of ['', '1', '9020', '65535']) expect(portError(ok)).toBe('');
    for (const bad of ['0', '65536', '-1', '12a', '1.5', '999999']) expect(portError(bad), bad).not.toBe('');
  });
  it('detects private addresses', () => {
    expect(isPrivateAddress('192.168.0.2')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
  it('checks file limits per protocol', () => {
    const config = { maxTcpBytes: 1000, maxUdpBytes: 100 };
    expect(fileProblem({ size: 0 }, 'TCP', config)).toMatch(/empty/);
    expect(fileProblem({ size: 500 }, 'TCP', config)).toBe('');
    expect(fileProblem({ size: 500 }, 'UDP', config)).toMatch(/UDP limit/);
  });
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});
