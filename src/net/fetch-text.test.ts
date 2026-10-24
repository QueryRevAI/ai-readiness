import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AI_READINESS_USER_AGENT,
  checkTextUrl,
  CONNECT_TIMEOUT_MS,
  createTextFetcher,
  FETCH_LIMITS,
  HostPacing,
  hostKey,
  MAX_TRACKED_HOSTS,
  MAX_CRAWL_DELAY_SECONDS,
  MAX_REDIRECTS,
  REQUEST_TIMEOUT_MS,
  type TextFetcher,
} from './fetch-text';
import * as mainEntry from '../index';
import {
  classifyPrivateNetworkAddress,
  createCliTextFetcher,
  createPrivateNetworkGuard,
} from './cli';
import { createFixtureTextFetcher } from './testing/fixture-fetcher';
import { tableResolver } from './testing/fixture-guard';

// A local fixture site on 127.0.0.1. One server answers for several names (by `Host`); the
// fixture resolver maps them to 127.0.0.1, and a few names to addresses the guard must refuse.

interface Seen {
  readonly host: string;
  readonly path: string;
  readonly method: string;
  readonly headers: IncomingMessage['headers'];
  readonly at: number;
}

const MIB = 1024 * 1024;
const big = Buffer.alloc(6 * MIB, 'a');
const gzipBomb = gzipSync(Buffer.alloc(64 * MIB, 0));
const brotliBomb = brotliCompressSync(Buffer.alloc(64 * MIB, 0));
const held: ServerResponse[] = [];

/** A gzip stream whose header carries a comment of `size` bytes: on the wire, never decoded. */
function gzipWithComment(size: number, payload: string): Buffer {
  const plain = gzipSync(Buffer.from(payload));
  const header = Buffer.from(plain.subarray(0, 10));
  header[3] = header[3]! | 0x10; // FCOMMENT
  return Buffer.concat([header, Buffer.alloc(size, 0x61), Buffer.from([0]), plain.subarray(10)]);
}
const commentBomb = gzipWithComment(MIB, 'ok');
const commentSmall = gzipWithComment(16, 'ok');

let server: Server;
let port = 0;
const seen: Seen[] = [];

function url(path: string, host = 'site.test'): string {
  return `http://${host}:${port}${path}`;
}

function requestsTo(host: string, path?: string): Seen[] {
  return seen.filter((s) => s.host === host && (path === undefined || s.path === path));
}

function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { location });
  res.end();
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const host = (req.headers.host ?? '').split(':')[0]!;
  const path = req.url ?? '/';
  seen.push({ host, path, method: req.method ?? '', headers: req.headers, at: performance.now() });
  const text = (body: string | Buffer, type = 'text/plain; charset=utf-8', extra = {}): void => {
    res.writeHead(200, { 'content-type': type, ...extra });
    res.end(body);
  };
  if (host.startsWith('busy')) {
    res.writeHead(path === '/429' ? 429 : 503, { 'retry-after': '1' });
    res.end('slow down');
    return;
  }
  const slow = /^\/slowchain\/(\d+)$/.exec(path);
  if (slow) {
    const left = Number(slow[1]);
    setTimeout(() => {
      if (left === 0) text('end of slow chain');
      else redirect(res, `/slowchain/${left - 1}`);
    }, 200);
    return;
  }
  const chain = /^\/chain\/(\d+)$/.exec(path);
  if (chain) {
    const left = Number(chain[1]);
    if (left === 0) text('end of chain');
    else redirect(res, `/chain/${left - 1}`);
    return;
  }
  switch (path) {
    case '/gzip-comment-bomb':
      text(commentBomb, 'text/plain', { 'content-encoding': 'gzip' });
      return;
    case '/gzip-comment-small':
      text(commentSmall, 'text/plain', { 'content-encoding': 'gzip' });
      return;
    case '/hello':
      text(`hello from ${host}`);
      return;
    case '/echo':
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=secret' });
      res.end(JSON.stringify(req.headers));
      return;
    case '/loop-a':
      redirect(res, '/loop-b');
      return;
    case '/loop-b':
      redirect(res, '/loop-a');
      return;
    case '/to-other-host':
      redirect(res, url('/hello', 'other.test'), 301);
      return;
    case '/to-private-name':
      redirect(res, url('/hello', 'internal.test'));
      return;
    case '/to-metadata-name':
      redirect(res, url('/latest/meta-data/', 'metadata.test'));
      return;
    case '/to-metadata-ip':
      redirect(res, 'http://169.254.169.254/latest/meta-data/');
      return;
    case '/to-decimal-ip':
      redirect(res, `http://2130706433:${port}/hello`);
      return;
    case '/to-ipv6-literal':
      redirect(res, `http://[::1]:${port}/hello`);
      return;
    case '/to-port':
      redirect(res, 'http://site.test:8080/hello');
      return;
    case '/to-file':
      redirect(res, 'file:///etc/passwd');
      return;
    case '/to-userinfo':
      redirect(res, `http://user:pass@site.test:${port}/hello`);
      return;
    case '/no-location':
      res.writeHead(302);
      res.end();
      return;
    case '/bad-location':
      res.writeHead(302, { location: 'http://[nope/' });
      res.end();
      return;
    case '/big':
      text(big);
      return;
    case '/gzip-bomb':
      text(gzipBomb, 'application/xml', { 'content-encoding': 'gzip' });
      return;
    case '/brotli-bomb':
      text(brotliBomb, 'text/plain', { 'content-encoding': 'br' });
      return;
    case '/gzip-small':
      text(gzipSync(Buffer.from('# Small\n\n> compressed\n')), 'text/markdown', {
        'content-encoding': 'gzip',
      });
      return;
    case '/corrupt-gzip':
      text(Buffer.from('this is not gzip at all'), 'text/plain', { 'content-encoding': 'gzip' });
      return;
    case '/double-encoding':
      text(gzipSync(gzipSync(Buffer.from('x'))), 'text/plain', {
        'content-encoding': 'gzip, gzip',
      });
      return;
    case '/utf8':
      text(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('café ✓')]));
      return;
    case '/noindex':
      text('<html></html>', 'text/html', { 'x-robots-tag': 'noindex' });
      return;
    case '/never':
      held.push(res);
      return;
    case '/trickle': {
      res.writeHead(200, { 'content-type': 'text/plain' });
      const timer = setInterval(() => res.write('.'), 50);
      res.on('close', () => clearInterval(timer));
      return;
    }
    default:
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html>not found</html>');
  }
}

const resolver = tableResolver({
  'site.test': ['127.0.0.1'],
  'other.test': ['127.0.0.1'],
  'busy.test': ['127.0.0.1'],
  'busy2.test': ['127.0.0.1'],
  'busy3.test': ['127.0.0.1'],
  'busy3.test.': ['127.0.0.1'],
  'dot.test.': ['127.0.0.1'],
  'budget.test': ['127.0.0.1'],
  'internal.test': ['10.0.0.5'],
  'metadata.test': ['169.254.169.254'],
  'mixed.test': ['127.0.0.1', '10.0.0.6'],
  'v6loop.test': ['::1'],
  'mapped.test': ['::ffff:127.0.0.1'],
});

let fetcher: TextFetcher;

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  // No pacing between requests here, so the tests stay fast; politeness has its own tests.
  fetcher = createFixtureTextFetcher({ port, resolver, hostIntervalMs: 0 });
});

afterAll(async () => {
  for (const res of held) res.destroy();
  await fetcher.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('the decoded bytes', () => {
  it('are a copy that owns its memory', async () => {
    const result = await fetcher.fetchText(url('/hello'), { kind: 'page' });
    const raw = result.rawBody!;
    expect(Buffer.from(raw).toString('utf8')).toBe(result.text);
    expect(raw.byteOffset).toBe(0);
    expect(raw.buffer.byteLength).toBe(raw.length);
  });
});

describe('URL rules before any connection', () => {
  it.each([
    ['not a url', 'invalid_url'],
    ['ftp://example.com/', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['http://user@example.com/', 'credentials'],
    ['http://user:pass@example.com/', 'credentials'],
    ['https://:pass@example.com/', 'credentials'],
    // Every IP-literal host is refused, public or not, in every spelling the parser accepts.
    ['http://93.184.216.34/', 'ip_literal'],
    ['http://127.0.0.1/', 'ip_literal'],
    ['http://2130706433/', 'ip_literal'],
    ['http://0x7f.1/', 'ip_literal'],
    ['http://0177.0.0.1/', 'ip_literal'],
    ['http://169.254.169.254/latest/meta-data/', 'ip_literal'],
    ['http://[::1]/', 'ip_literal'],
    ['http://[2606:4700:4700::1111]/', 'ip_literal'],
    ['http://[::ffff:127.0.0.1]/', 'ip_literal'],
    ['http://[fd00:ec2::254]/', 'ip_literal'],
    [
      `http://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}/`,
      'host_too_long',
    ],
  ])('refuses %s as %s', (input, refusal) => {
    expect(checkTextUrl(input)).toEqual({ refusal });
  });

  it('accepts a host of exactly 253 characters', () => {
    const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    expect(host.length).toBe(253);
    expect('url' in checkTextUrl(`https://${host}/`)).toBe(true);
  });

  it('counts an international name in its punycode form', () => {
    const result = checkTextUrl('https://bücher.example/');
    expect('url' in result && result.url.hostname).toBe('xn--bcher-kva.example');
  });

  it('refuses ports other than 80 and 443 in the production fetcher, without a connection', async () => {
    const production = createTextFetcher({
      resolver: tableResolver({ 'site.test': ['127.0.0.1'] }),
    });
    try {
      for (const target of ['http://example.com:8080/', 'https://example.com:22/', url('/hello')]) {
        const result = await production.fetchText(target, { kind: 'page' });
        expect(result).toMatchObject({ outcome: 'refused_url', refusal: 'port', requests: 0 });
      }
    } finally {
      await production.close();
    }
  });

  it('refuses an IP literal pointing at the fixture itself, and sends nothing', async () => {
    const before = seen.length;
    for (const target of [`http://127.0.0.1:${port}/hello`, `http://[::1]:${port}/hello`]) {
      const result = await fetcher.fetchText(target, { kind: 'page' });
      expect(result).toMatchObject({ outcome: 'refused_url', refusal: 'ip_literal', requests: 0 });
    }
    expect(seen.length).toBe(before);
  });
});

describe('the network guard on every connection', () => {
  it.each([
    ['internal.test', 'private'],
    ['metadata.test', 'link_local'],
    ['mixed.test', 'private'],
    ['v6loop.test', 'loopback'],
    ['mapped.test', 'ipv4_embedded'],
  ])('refuses %s, which resolves to a refused address (%s)', async (host, reason) => {
    const result = await fetcher.fetchText(url('/hello', host), { kind: 'page' });
    expect(result).toMatchObject({ outcome: 'refused_address', refusal: reason, status: null });
    expect(requestsTo(host)).toEqual([]);
  });

  it('reports a name that does not resolve', async () => {
    const result = await fetcher.fetchText(url('/hello', 'unknown.test'), { kind: 'page' });
    expect(result.outcome).toBe('dns_failed');
  });

  it('resolves a name once per connection and connects to the checked address', async () => {
    const counting = tableResolver({ 'site.test': ['127.0.0.1'] });
    const own = createFixtureTextFetcher({ port, resolver: counting, hostIntervalMs: 0 });
    try {
      const result = await own.fetchText(url('/hello'), { kind: 'page' });
      expect(result).toMatchObject({
        outcome: 'response',
        status: 200,
        text: 'hello from site.test',
      });
      expect(counting.lookups).toEqual(['site.test']);
    } finally {
      await own.close();
    }
  });

  it('refuses the private-network rule by default: loopback is refused in production', async () => {
    const production = createTextFetcher({
      resolver: tableResolver({ 'staging.test': ['127.0.0.1'] }),
    });
    try {
      const result = await production.fetchText('http://staging.test/', { kind: 'page' });
      expect(result).toMatchObject({
        outcome: 'refused_address',
        refusal: 'loopback',
        requests: 1,
      });
    } finally {
      await production.close();
    }
  });
});

describe('redirects', () => {
  it(`follows up to ${MAX_REDIRECTS} redirects and reports each hop`, async () => {
    const result = await fetcher.fetchText(url('/chain/3'), { kind: 'page' });
    expect(result).toMatchObject({
      outcome: 'response',
      status: 200,
      text: 'end of chain',
      finalUrl: url('/chain/0'),
      finalHost: 'site.test',
      requests: 4,
    });
    expect(result.redirects.map((hop) => hop.location)).toEqual([
      url('/chain/2'),
      url('/chain/1'),
      url('/chain/0'),
    ]);
  });

  it('stops at the fourth redirect without requesting its target', async () => {
    const before = seen.length;
    const result = await fetcher.fetchText(url('/chain/9'), { kind: 'page' });
    expect(result).toMatchObject({ outcome: 'too_many_redirects', status: 302, requests: 4 });
    expect(result.redirects.at(-1)?.location).toBe(url('/chain/5'));
    expect(seen.slice(before).map((s) => s.path)).toEqual([
      '/chain/9',
      '/chain/8',
      '/chain/7',
      '/chain/6',
    ]);
  });

  it('reports the final host after a redirect to another site', async () => {
    const result = await fetcher.fetchText(url('/to-other-host'), { kind: 'page' });
    expect(result).toMatchObject({
      outcome: 'response',
      finalHost: 'other.test',
      finalUrl: url('/hello', 'other.test'),
      text: 'hello from other.test',
    });
  });

  it('asks redirectAllowed before each hop, and never contacts a refused target', async () => {
    const before = seen.length;
    const asked: string[] = [];
    const result = await fetcher.fetchText(url('/to-other-host'), {
      kind: 'page',
      redirectAllowed: (target) => {
        asked.push(target.hostname);
        return target.hostname === 'site.test';
      },
    });
    expect(result).toMatchObject({ outcome: 'redirect_refused', status: 301, requests: 1 });
    expect(result.redirects.map((hop) => hop.location)).toEqual([url('/hello', 'other.test')]);
    expect(asked).toEqual(['other.test']);
    expect(seen.slice(before).map((s) => s.host)).toEqual(['site.test']);
    const allowed = await fetcher.fetchText(url('/chain/2'), {
      kind: 'page',
      redirectAllowed: (target) => target.hostname === 'site.test',
    });
    expect(allowed).toMatchObject({ outcome: 'response', text: 'end of chain' });
  });

  it('detects a loop', async () => {
    const result = await fetcher.fetchText(url('/loop-a'), { kind: 'page' });
    expect(result).toMatchObject({ outcome: 'redirect_loop', requests: 2 });
  });

  it.each([
    ['/to-private-name', 'refused_address', 'private'],
    ['/to-metadata-name', 'refused_address', 'link_local'],
    ['/to-metadata-ip', 'refused_url', 'ip_literal'],
    ['/to-decimal-ip', 'refused_url', 'ip_literal'],
    ['/to-ipv6-literal', 'refused_url', 'ip_literal'],
    ['/to-port', 'refused_url', 'port'],
    ['/to-file', 'refused_url', 'scheme'],
    ['/to-userinfo', 'refused_url', 'credentials'],
  ])('checks the target of %s again and refuses it (%s, %s)', async (path, outcome, refusal) => {
    const before = seen.length;
    const result = await fetcher.fetchText(url(path), { kind: 'page' });
    expect(result).toMatchObject({ outcome, refusal });
    expect(result.redirects).toHaveLength(1);
    // Only the redirecting page reached the fixture; the refused target was never requested.
    expect(seen.length).toBe(before + 1);
  });

  it('treats a redirect without Location as the answer, and an unusable Location as invalid', async () => {
    expect(await fetcher.fetchText(url('/no-location'), { kind: 'page' })).toMatchObject({
      outcome: 'response',
      status: 302,
    });
    expect(await fetcher.fetchText(url('/bad-location'), { kind: 'page' })).toMatchObject({
      outcome: 'invalid_redirect',
    });
  });
});

describe('size caps, counted after decompression', () => {
  it.each([
    ['robots', 500 * 1024],
    ['llms', MIB],
    ['page', 2 * MIB],
    ['sitemap', 5 * MIB],
  ] as const)('cuts a %s file at %d bytes and says so', async (kind, cap) => {
    expect(FETCH_LIMITS[kind]).toBe(cap);
    const result = await fetcher.fetchText(url('/big'), { kind });
    expect(result).toMatchObject({
      outcome: 'response',
      truncated: true,
      bytes: cap,
      limitBytes: cap,
    });
    expect(result.text).toHaveLength(cap);
  });

  it('applies a lower cap a caller asks for, never a higher one', async () => {
    const low = await fetcher.fetchText(url('/big'), { kind: 'page', maxBytes: 64 * 1024 });
    expect(low).toMatchObject({ truncated: true, bytes: 64 * 1024 });
    const high = await fetcher.fetchText(url('/big'), { kind: 'robots', maxBytes: 10 * MIB });
    expect(high).toMatchObject({ truncated: true, bytes: 500 * 1024 });
  });

  it('stops decoding a gzip bomb at the cap', async () => {
    expect(gzipBomb.length).toBeLessThan(FETCH_LIMITS.sitemap);
    const result = await fetcher.fetchText(url('/gzip-bomb'), { kind: 'sitemap' });
    expect(result).toMatchObject({ outcome: 'response', truncated: true, bytes: 5 * MIB });
  });

  it('stops decoding a brotli bomb at the cap', async () => {
    const result = await fetcher.fetchText(url('/brotli-bomb'), { kind: 'llms' });
    expect(result).toMatchObject({ outcome: 'response', truncated: true, bytes: MIB });
  });

  it('decodes a small compressed file in full', async () => {
    const result = await fetcher.fetchText(url('/gzip-small'), { kind: 'llms' });
    expect(result).toMatchObject({
      truncated: false,
      decodeFailed: false,
      contentType: 'text/markdown',
      text: '# Small\n\n> compressed\n',
    });
  });

  it('reports a corrupt or stacked encoding as not decoded', async () => {
    for (const path of ['/corrupt-gzip', '/double-encoding']) {
      const result = await fetcher.fetchText(url(path), { kind: 'llms' });
      expect(result).toMatchObject({ outcome: 'response', decodeFailed: true, text: null });
    }
  });
});

describe('text and headers', () => {
  it('reads the body as UTF-8 and drops the byte-order mark', async () => {
    const result = await fetcher.fetchText(url('/utf8'), { kind: 'llms' });
    expect(result.text).toBe('café ✓');
  });

  it('does not end a cut body in half a character', async () => {
    // 'café' is 5 bytes; a cap of 4 bytes splits the é.
    const result = await fetcher.fetchText(url('/utf8'), { kind: 'llms', maxBytes: 3 + 4 });
    expect(result).toMatchObject({ truncated: true, text: 'caf' });
  });

  it('sends GET with its user agent, no cookie and no credentials, and keeps no cookie', async () => {
    const first = await fetcher.fetchText(url('/echo'), { kind: 'page' });
    expect(first.headers).not.toHaveProperty('set-cookie');
    const second = await fetcher.fetchText(url('/echo'), { kind: 'page' });
    const sent = JSON.parse(second.text!) as Record<string, string>;
    expect(sent['user-agent']).toBe(AI_READINESS_USER_AGENT);
    expect(AI_READINESS_USER_AGENT).toBe(
      'Mozilla/5.0 (compatible; QueryRev-AIReadiness/1.0; +https://queryrev.com/bot)',
    );
    expect(sent).not.toHaveProperty('cookie');
    expect(sent).not.toHaveProperty('authorization');
    expect(sent).not.toHaveProperty('proxy-authorization');
    expect(requestsTo('site.test', '/echo').every((s) => s.method === 'GET')).toBe(true);
  });

  it('passes on X-Robots-Tag and the media type', async () => {
    const result = await fetcher.fetchText(url('/noindex'), { kind: 'page' });
    expect(result).toMatchObject({
      contentType: 'text/html',
      headers: { 'x-robots-tag': ['noindex'] },
    });
  });
});

describe('time limits', () => {
  it(`uses ${CONNECT_TIMEOUT_MS} ms to connect and ${REQUEST_TIMEOUT_MS} ms a request by default`, () => {
    expect(CONNECT_TIMEOUT_MS).toBe(5_000);
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('times out a server that never answers', async () => {
    const quick = createFixtureTextFetcher({
      port,
      resolver,
      requestTimeoutMs: 300,
      hostIntervalMs: 0,
    });
    try {
      const started = performance.now();
      const result = await quick.fetchText(url('/never'), { kind: 'page' });
      expect(result.outcome).toBe('timeout');
      expect(performance.now() - started).toBeLessThan(3_000);
    } finally {
      await quick.close();
    }
  });

  it('times out a body that trickles in under the size cap', async () => {
    const quick = createFixtureTextFetcher({
      port,
      resolver,
      requestTimeoutMs: 400,
      hostIntervalMs: 0,
    });
    try {
      const result = await quick.fetchText(url('/trickle'), { kind: 'page' });
      expect(result.outcome).toBe('timeout');
    } finally {
      await quick.close();
    }
  });

  it('ends with budget_exceeded when the caller budget runs out', async () => {
    const result = await fetcher.fetchText(url('/trickle'), {
      kind: 'page',
      signal: AbortSignal.timeout(300),
    });
    expect(result.outcome).toBe('budget_exceeded');
  });

  it('times out a TLS handshake that never completes, at the default connect limit', async () => {
    const sockets: Socket[] = [];
    const silent = createNetServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const silentPort = (silent.address() as AddressInfo).port;
    const own = createFixtureTextFetcher({ port: silentPort, resolver, hostIntervalMs: 0 });
    try {
      const started = performance.now();
      const result = await own.fetchText(`https://site.test:${silentPort}/`, { kind: 'page' });
      const took = performance.now() - started;
      expect(result.outcome).toBe('timeout');
      expect(took).toBeGreaterThanOrEqual(CONNECT_TIMEOUT_MS - 100);
      expect(took).toBeLessThan(REQUEST_TIMEOUT_MS);
    } finally {
      await own.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  }, 20_000);
});

describe('TLS', () => {
  let dir: string;
  let httpsServer: ReturnType<typeof createHttpsServer>;
  let tlsPort = 0;
  let cert = '';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ai-readiness-tls-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '2',
        '-subj',
        '/CN=site.test',
        '-addext',
        'subjectAltName=DNS:site.test',
      ],
      { stdio: 'ignore' },
    );
    cert = readFileSync(certPath, 'utf8');
    httpsServer = createHttpsServer({ key: readFileSync(keyPath), cert }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('secure hello');
    });
    await new Promise<void>((resolve) => httpsServer.listen(0, '127.0.0.1', resolve));
    tlsPort = (httpsServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    httpsServer.closeAllConnections();
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('verifies the certificate: a self-signed one is refused unless trusted', async () => {
    const untrusting = createFixtureTextFetcher({ port: tlsPort, resolver, hostIntervalMs: 0 });
    const trusting = createFixtureTextFetcher({
      port: tlsPort,
      resolver,
      hostIntervalMs: 0,
      ca: cert,
    });
    try {
      const target = `https://site.test:${tlsPort}/`;
      expect((await untrusting.fetchText(target, { kind: 'page' })).outcome).toBe('network_error');
      expect(await trusting.fetchText(target, { kind: 'page' })).toMatchObject({
        outcome: 'response',
        text: 'secure hello',
      });
      // The name is checked against the certificate even though the socket goes to an address.
      const wrongName = `https://other.test:${tlsPort}/`;
      expect((await trusting.fetchText(wrongName, { kind: 'page' })).outcome).toBe('network_error');
    } finally {
      await untrusting.close();
      await trusting.close();
    }
  });
});

describe('politeness', () => {
  // The two tests that measure the wait itself are timing tests: `fetch-text.speed.test.ts`.

  it(`caps Crawl-delay at ${MAX_CRAWL_DELAY_SECONDS} seconds and only ever slows down`, () => {
    const pacing = new HostPacing(1_000);
    pacing.setCrawlDelay('a.test', 3_600);
    expect(pacing.intervalFor('a.test')).toBe(10_000);
    pacing.setCrawlDelay('a.test', 2);
    expect(pacing.intervalFor('a.test')).toBe(10_000);
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      pacing.setCrawlDelay('b.test', value);
    }
    expect(pacing.intervalFor('b.test')).toBe(1_000);
  });

  it.each([
    ['busy.test', '/429'],
    ['busy2.test', '/503'],
  ])('sends nothing more to %s after %s', async (host, path) => {
    const first = await fetcher.fetchText(url(path, host), { kind: 'page' });
    expect(first).toMatchObject({ outcome: 'response' });
    expect(fetcher.isStopped(host)).toBe(true);
    const second = await fetcher.fetchText(url('/hello', host), { kind: 'page' });
    expect(second).toMatchObject({ outcome: 'host_stopped', requests: 0 });
    expect(requestsTo(host)).toHaveLength(1);
  });

  it('ends with budget_exceeded while waiting for its turn on a host', async () => {
    const polite = createFixtureTextFetcher({ port, resolver });
    try {
      polite.setCrawlDelay('budget.test', 10);
      await polite.fetchText(url('/hello', 'budget.test'), { kind: 'page' });
      const result = await polite.fetchText(url('/hello', 'budget.test'), {
        kind: 'page',
        signal: AbortSignal.timeout(200),
      });
      expect(result).toMatchObject({ outcome: 'budget_exceeded', requests: 0 });
    } finally {
      await polite.close();
    }
  });
});

describe('caller errors and odd caps', () => {
  it('throws on an unknown kind, which would have no cap', async () => {
    await expect(fetcher.fetchText(url('/big'), { kind: 'everything' as never })).rejects.toThrow(
      TypeError,
    );
    await expect(fetcher.fetchText(url('/big'), { kind: 'toString' as never })).rejects.toThrow(
      TypeError,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, '64' as unknown as number])(
    'ignores maxBytes %s and keeps the kind cap, for plain and compressed bodies',
    async (maxBytes) => {
      const plain = await fetcher.fetchText(url('/big'), { kind: 'robots', maxBytes });
      expect(plain).toMatchObject({ truncated: true, bytes: 500 * 1024, limitBytes: 500 * 1024 });
      const bomb = await fetcher.fetchText(url('/gzip-bomb'), { kind: 'robots', maxBytes });
      expect(bomb).toMatchObject({ truncated: true, bytes: 500 * 1024 });
    },
  );

  it('accepts a cap of zero bytes', async () => {
    const result = await fetcher.fetchText(url('/hello'), { kind: 'page', maxBytes: 0 });
    expect(result).toMatchObject({ truncated: true, bytes: 0, text: '' });
  });

  it('bounds the compressed bytes of a stream that never decodes to the cap', async () => {
    // The control: the same construction with a short comment decodes.
    const small = await fetcher.fetchText(url('/gzip-comment-small'), { kind: 'robots' });
    expect(small).toMatchObject({ truncated: false, decodeFailed: false, text: 'ok' });
    // A 1 MiB header comment yields no decoded byte; only the wire counter can stop it.
    const result = await fetcher.fetchText(url('/gzip-comment-bomb'), { kind: 'robots' });
    expect(result).toMatchObject({ outcome: 'response', truncated: true, bytes: 0 });
  });

  it('counts the request limit over the whole redirect chain', async () => {
    const quick = createFixtureTextFetcher({
      port,
      resolver,
      requestTimeoutMs: 500,
      hostIntervalMs: 0,
    });
    try {
      // One slow hop (200 ms) fits; four of them (800 ms) do not.
      expect(await quick.fetchText(url('/slowchain/0'), { kind: 'page' })).toMatchObject({
        outcome: 'response',
        text: 'end of slow chain',
      });
      const result = await quick.fetchText(url('/slowchain/3'), { kind: 'page' });
      expect(result.outcome).toBe('timeout');
      expect(result.redirects.length).toBeGreaterThanOrEqual(2);
    } finally {
      await quick.close();
    }
  });
});

describe('host keys', () => {
  it('drops one trailing dot', () => {
    expect(hostKey('Site.Test.')).toBe('site.test');
    expect(hostKey('site.test')).toBe('site.test');
  });

  it('reports the final host without the trailing dot', async () => {
    const result = await fetcher.fetchText(url('/hello', 'dot.test.'), { kind: 'page' });
    expect(result).toMatchObject({ outcome: 'response', finalHost: 'dot.test' });
  });

  it('keeps a host stopped whether or not it is written with a trailing dot', async () => {
    await fetcher.fetchText(url('/429', 'busy3.test.'), { kind: 'page' });
    expect(fetcher.isStopped('busy3.test')).toBe(true);
    const again = await fetcher.fetchText(url('/hello', 'busy3.test'), { kind: 'page' });
    expect(again).toMatchObject({ outcome: 'host_stopped', requests: 0 });
  });
});

describe('bounded politeness state', () => {
  it('drops start slots once they are in the past', async () => {
    let now = 1_000_000;
    const pacing = new HostPacing(1_000, () => now);
    for (let i = 0; i < 50; i += 1) await pacing.acquire(`h${i}.test`, undefined);
    expect(pacing.sizes.nextAt).toBe(50);
    now += 2_000;
    await pacing.acquire('fresh.test', undefined);
    expect(pacing.sizes.nextAt).toBe(1);
  });

  it(`keeps at most ${MAX_TRACKED_HOSTS} hosts per table, dropping the oldest`, async () => {
    const pacing = new HostPacing(1_000, () => 5_000_000);
    const extra = MAX_TRACKED_HOSTS + 500;
    for (let i = 0; i < extra; i += 1) {
      await pacing.acquire(`a${i}.test`, undefined);
      pacing.stop(`s${i}.test`);
      pacing.setCrawlDelay(`c${i}.test`, 5);
    }
    expect(pacing.sizes).toEqual({
      nextAt: MAX_TRACKED_HOSTS,
      interval: MAX_TRACKED_HOSTS,
      stopped: MAX_TRACKED_HOSTS,
    });
    expect(pacing.isStopped(`s${extra - 1}.test`)).toBe(true);
    expect(pacing.isStopped('s0.test')).toBe(false);
  });
});

describe('the main entry has no way to loosen the guard', () => {
  it('exports no private-network fetcher or guard', () => {
    for (const name of [
      'createCliTextFetcher',
      'createPrivateNetworkGuard',
      'classifyPrivateNetworkAddress',
      'buildTextFetcher',
      'guardWithRules',
    ]) {
      expect(Object.keys(mainEntry)).not.toContain(name);
    }
  });

  it('ignores allowPrivateNetwork passed to its factory', async () => {
    const production = createTextFetcher({
      allowPrivateNetwork: true,
      resolver: tableResolver({ 'staging.test': ['127.0.0.1'] }),
    } as never);
    try {
      const result = await production.fetchText('http://staging.test/', { kind: 'page' });
      expect(result).toMatchObject({ outcome: 'refused_address', refusal: 'loopback' });
    } finally {
      await production.close();
    }
  });
});

describe('the private-network opt-in (CLI entry)', () => {
  it.each([
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.10',
    '127.0.0.1',
    '100.64.1.1',
    '::1',
    'fd12:3456::1',
  ])('allows %s', (address) => {
    expect(classifyPrivateNetworkAddress(address).allowed).toBe(true);
  });

  it.each([
    ['169.254.169.254', 'link_local'],
    ['100.100.100.200', 'cloud_metadata'],
    ['fd00:ec2::254', 'cloud_metadata'],
    ['fd00:0ec2:0000::0254', 'cloud_metadata'],
    ['168.63.129.16', 'cloud_metadata'],
    ['192.0.0.192', 'reserved'],
    ['0.0.0.0', 'unspecified'],
    ['::ffff:10.0.0.1', 'ipv4_embedded'],
    ['fe80::1', 'link_local'],
    ['224.0.0.1', 'multicast'],
  ])('still refuses %s (%s)', (address, reason) => {
    expect(classifyPrivateNetworkAddress(address)).toEqual({ allowed: false, reason });
  });

  it('its guard passes a name on a private address, without any connection', async () => {
    const guard = createPrivateNetworkGuard(tableResolver({ 'staging.test': ['127.0.0.1'] }));
    await expect(guard.vet('staging.test', 80)).resolves.toBe('127.0.0.1');
    await expect(guard.vet('staging.test', 8080)).rejects.toMatchObject({ code: 'refused_port' });
  });

  it('the CLI fetcher uses that guard only when asked, and never for IP literals or other ports', async () => {
    const table = { 'staging.test': ['127.0.0.1'], 'meta.test': ['100.100.100.200'] };
    const strict = createCliTextFetcher({ resolver: tableResolver(table) });
    const opted = createCliTextFetcher({
      allowPrivateNetwork: true,
      resolver: tableResolver(table),
    });
    try {
      expect(await strict.fetchText('http://staging.test/', { kind: 'page' })).toMatchObject({
        outcome: 'refused_address',
        refusal: 'loopback',
      });
      // 'shared' under the strict rule; the opt-in names it as metadata, so its guard is in use.
      expect(await strict.fetchText('http://meta.test/', { kind: 'page' })).toMatchObject({
        refusal: 'shared',
      });
      expect(await opted.fetchText('http://meta.test/', { kind: 'page' })).toMatchObject({
        outcome: 'refused_address',
        refusal: 'cloud_metadata',
      });
      expect(await opted.fetchText('http://192.168.1.10/', { kind: 'page' })).toMatchObject({
        outcome: 'refused_url',
        refusal: 'ip_literal',
      });
      expect(await opted.fetchText('http://staging.test:8080/', { kind: 'page' })).toMatchObject({
        outcome: 'refused_url',
        refusal: 'port',
      });
    } finally {
      await strict.close();
      await opted.close();
    }
  });
});
