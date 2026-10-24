import { describe, expect, it } from 'vitest';
import { isOnDomain, registrableDomain } from './domain';

describe('registrableDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['a.b.example.com.', 'example.com'],
    ['WWW.Example.COM', 'example.com'],
    ['www.example.co.uk', 'example.co.uk'],
    ['shop.example.com.au', 'example.com.au'],
    ['localhost', 'localhost'],
    ['co.uk', 'co.uk'],
  ])('%s is %s', (host, domain) => {
    expect(registrableDomain(host)).toBe(domain);
  });

  it('returns an IP literal unchanged', () => {
    expect(registrableDomain('192.168.1.10')).toBe('192.168.1.10');
    expect(registrableDomain('::1')).toBe('::1');
    expect(registrableDomain('2001:db8::1')).toBe('2001:db8::1');
  });

  it('knows a name under a domain', () => {
    expect(isOnDomain('www.example.com', 'example.com')).toBe(true);
    expect(isOnDomain('example.com', 'example.com')).toBe(true);
    expect(isOnDomain('badexample.com', 'example.com')).toBe(false);
  });
});
