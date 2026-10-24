import { describe, expect, it } from 'vitest';
import { parseRobots } from './index';

// A timing test: it runs alone, in the gate's speed stage (`*.speed.test.*`), because under the
// parallel load of the other tests its 5 s limit was reached on a busy machine.

describe('adversarial robots.txt at the cap', () => {
  it('reads every covered crawler’s access for a long path in well under a second', async () => {
    const { crawlerAccess, CRAWLERS } = await import('../index');
    const K = 500 * 1024;
    const agents = `${CRAWLERS.map((crawler) => `User-agent: ${crawler.token}`).join('\n')}\nUser-agent: *\n`;
    const path = `/${'a'.repeat(2040)}`;
    const files = [
      agents + 'Disallow: /*b\n'.repeat(K / 14),
      agents + `Disallow: /${'*a'.repeat(1000)}b\n`.repeat(K / 2010),
      'User-agent: x\nDisallow: /a\n'.repeat(K / 28),
      CRAWLERS.map(
        (crawler) => `User-agent: ${crawler.token}\n${'Disallow: /*b\n'.repeat(K / 11 / 14)}`,
      ).join('\n'),
    ];
    for (const body of files) {
      let fastest = Infinity;
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        crawlerAccess(parseRobots(body), { path });
        fastest = Math.min(fastest, performance.now() - started);
      }
      expect(fastest).toBeLessThan(1000);
    }
  });
});
