import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureTextFetcher } from './testing/fixture-fetcher';
import { tableResolver } from './testing/fixture-guard';

// The waits between two requests to one host, measured on the clock (the rest of the fetcher's
// politeness is in `fetch-text.test.ts`). Timing tests run alone, in the gate's speed stage:
// under the parallel load of the other tests a wait of 0.4 s was once seen as 0.375 s at the
// fixture server, which is the server's view of the gap, not the fetcher's.

let server: Server;
let port = 0;
/** When each request reached the fixture server, by host. */
const arrivals = new Map<string, number[]>();

const resolver = tableResolver({
  'paced.test': ['127.0.0.1'],
  'delayed.test': ['127.0.0.1'],
});

const url = (host: string) => `http://${host}:${port}/hello`;

/** The gap between the first two requests that reached a host, in milliseconds. */
function gapOf(host: string): number {
  const [a, b] = arrivals.get(host) ?? [];
  if (a === undefined || b === undefined) throw new Error(`Two requests to ${host} expected.`);
  return b - a;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0]!;
    arrivals.set(host, [...(arrivals.get(host) ?? []), performance.now()]);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('hello');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('politeness, on the clock', () => {
  it('waits one second between two requests to one host by default', async () => {
    const polite = createFixtureTextFetcher({ port, resolver });
    try {
      await polite.fetchText(url('paced.test'), { kind: 'page' });
      await polite.fetchText(url('paced.test'), { kind: 'page' });
      expect(gapOf('paced.test')).toBeGreaterThanOrEqual(950);
    } finally {
      await polite.close();
    }
  });

  it('honours Crawl-delay', async () => {
    const polite = createFixtureTextFetcher({ port, resolver, hostIntervalMs: 0 });
    try {
      polite.setCrawlDelay('delayed.test', 0.4);
      await polite.fetchText(url('delayed.test'), { kind: 'page' });
      await polite.fetchText(url('delayed.test'), { kind: 'page' });
      expect(gapOf('delayed.test')).toBeGreaterThanOrEqual(380);
    } finally {
      await polite.close();
    }
  });
});
