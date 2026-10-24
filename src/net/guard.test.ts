import { describe, expect, it } from 'vitest';
import { createNetworkGuard, NetworkGuardError } from './guard';
import { tableResolver } from './testing/fixture-guard';

function refusal(run: () => unknown): { code: string; reason: string | null } | 'allowed' {
  try {
    run();
    return 'allowed';
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error;
    return { code: error.code, reason: error.reason };
  }
}

async function vetRefusal(run: () => Promise<unknown>) {
  try {
    return { ok: await run() };
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error;
    return { code: error.code, reason: error.reason };
  }
}

describe('the production network guard: URL check', () => {
  const guard = createNetworkGuard({ resolver: tableResolver({}) });

  it('allows ordinary http and https URLs on ports 80 and 443', () => {
    for (const url of [
      'http://example.com/',
      'https://example.com/a?b=c',
      'http://example.com:80/',
      'https://example.com:443/',
      'https://93.184.216.34/',
    ]) {
      expect(refusal(() => guard.checkUrl(new URL(url)))).toBe('allowed');
    }
  });

  it.each([
    // Every spelling of 127.0.0.1 that the WHATWG parser accepts becomes the dotted quad.
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f.0.0.1/',
    'http://0x7f000001/',
    'http://127.1/',
    'http://0177.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0xa9fea9fe/',
    'http://[fd00:ec2::254]/',
    'http://10.0.0.1/',
    'http://012.0.0.1/',
    'http://167772161/',
    'http://192.168.0.1/',
    'http://0.0.0.0/',
    'http://[::]/',
  ])('refuses the IP-literal URL %s', (url) => {
    expect(refusal(() => guard.checkUrl(new URL(url)))).toMatchObject({ code: 'refused_address' });
  });

  it.each(['http://example.com:8080/', 'https://example.com:22/', 'http://example.com:3000/'])(
    'refuses the port of %s',
    (url) => {
      expect(refusal(() => guard.checkUrl(new URL(url)))).toEqual({
        code: 'refused_port',
        reason: null,
      });
    },
  );

  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'gopher://example.com/',
    'http://user:pw@example.com/',
  ])('refuses %s', (url) => {
    expect(refusal(() => guard.checkUrl(new URL(url)))).toEqual({
      code: 'refused_scheme',
      reason: null,
    });
  });
});

describe('the production network guard: resolution', () => {
  const resolver = tableResolver({
    'public.example': ['93.184.216.34'],
    'two.example': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
    'internal.example': ['10.0.0.5'],
    'metadata.example': ['169.254.169.254'],
    'mixed.example': ['93.184.216.34', '127.0.0.1'],
    'v6loop.example': ['::1'],
    'mapped.example': ['::ffff:10.0.0.1'],
    'odd.example': ['0177.0.0.1'],
    'empty.example': [],
  });
  const guard = createNetworkGuard({ resolver });

  it('returns the address it checked, for the connection to use', async () => {
    expect(await vetRefusal(() => guard.vet('public.example', 443))).toEqual({
      ok: '93.184.216.34',
    });
    expect(await vetRefusal(() => guard.vet('two.example', 80))).toEqual({ ok: '93.184.216.34' });
  });

  it('checks an IP literal without resolving it', async () => {
    const before = resolver.lookups.length;
    expect(await vetRefusal(() => guard.vet('[2606:4700:4700::1111]', 443))).toEqual({
      ok: '2606:4700:4700::1111',
    });
    expect(await vetRefusal(() => guard.vet('127.0.0.1', 80))).toEqual({
      code: 'refused_address',
      reason: 'loopback',
    });
    expect(resolver.lookups.length).toBe(before);
  });

  it.each([
    ['internal.example', 'private'],
    ['metadata.example', 'link_local'],
    ['v6loop.example', 'loopback'],
    ['mapped.example', 'ipv4_embedded'],
    ['odd.example', 'invalid'],
  ])('refuses %s, which resolves to a refused address (%s)', async (host, reason) => {
    expect(await vetRefusal(() => guard.vet(host, 443))).toEqual({
      code: 'refused_address',
      reason,
    });
  });

  it('refuses a name when any one of its addresses is refused', async () => {
    expect(await vetRefusal(() => guard.vet('mixed.example', 443))).toEqual({
      code: 'refused_address',
      reason: 'loopback',
    });
  });

  it('reports a name that does not resolve, or resolves to nothing', async () => {
    expect(await vetRefusal(() => guard.vet('unknown.example', 443))).toEqual({
      code: 'dns_failed',
      reason: null,
    });
    expect(await vetRefusal(() => guard.vet('empty.example', 443))).toEqual({
      code: 'dns_failed',
      reason: null,
    });
  });

  it('refuses a port other than 80 and 443 before resolving', async () => {
    const before = resolver.lookups.length;
    expect(await vetRefusal(() => guard.vet('public.example', 8443))).toEqual({
      code: 'refused_port',
      reason: null,
    });
    expect(resolver.lookups.length).toBe(before);
  });

  it('resolves on every call, so a changed answer is checked again (DNS rebinding)', async () => {
    let answer = ['93.184.216.34'];
    const rebinding = createNetworkGuard({ resolver: () => Promise.resolve(answer) });
    expect(await vetRefusal(() => rebinding.vet('rebind.example', 443))).toEqual({
      ok: '93.184.216.34',
    });
    answer = ['169.254.169.254'];
    expect(await vetRefusal(() => rebinding.vet('rebind.example', 443))).toEqual({
      code: 'refused_address',
      reason: 'link_local',
    });
  });

  it('bounds a lookup that never answers', async () => {
    const hanging = createNetworkGuard({
      resolver: () => new Promise<readonly string[]>(() => {}),
      dnsTimeoutMs: 50,
    });
    const started = performance.now();
    expect(await vetRefusal(() => hanging.vet('slow.example', 443))).toEqual({
      code: 'dns_failed',
      reason: null,
    });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('puts no host name or address in its error message', async () => {
    try {
      await guard.vet('internal.example', 443);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('NetworkGuard: refused_address (private)');
    }
  });
});
