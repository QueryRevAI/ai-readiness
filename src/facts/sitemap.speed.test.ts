import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readSitemap, SITEMAP_MAX_BYTES } from './sitemap';

// Timing tests, in the gate's speed stage (see home-page.speed.test.ts). Each file is built at
// the 5 MiB cap of a sitemap.

const SITE = 'https://www.example.com/';
const LIMIT_MS = 600;

const fill = (unit: string, prefix = '', suffix = ''): string =>
  prefix +
  unit.repeat(Math.floor((SITEMAP_MAX_BYTES - prefix.length - suffix.length) / unit.length)) +
  suffix;
const urlset = (body: string): string =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;

async function timed(work: () => Promise<unknown>): Promise<number> {
  let fastest = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    await work();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

describe('hostile sitemaps at the 5 MiB cap', () => {
  it.each([
    ['empty loc tags', urlset(fill('<loc></loc>'))],
    ['loc tags that never end', urlset(fill('<loc>', '', ''))],
    ['loc tags without a closing bracket', urlset(fill('<loc '))],
    ['a million addresses', urlset(fill('<url><loc>https://www.example.com/a</loc></url>'))],
    ['addresses off the site', urlset(fill('<loc>https://other.example.org/a</loc>'))],
    ['CDATA that never ends', urlset(fill('<loc><![CDATA[', '', ''))],
    [
      'comments before the root',
      fill('<!-- -->', '', urlset('<loc>https://www.example.com/</loc>')),
    ],
    ['processing instructions before the root', fill('<?a?>', '', urlset(''))],
    ['a comment that never ends', fill('<!--', '', '')],
    ['a processing instruction that never ends', fill('<?', '', '')],
    ['"<" only', fill('<')],
    ['text lines', fill('https://www.example.com/page\n')],
    ['one long text line', fill('a')],
    ['blank lines', fill('\n')],
    ['spaces', fill(' ')],
    ['entities', urlset(fill('<loc>https://www.example.com/&amp;&#38;</loc>'))],
  ])('reads %s quickly', async (_name, text) => {
    const bytes = Buffer.from(text);
    expect(bytes.length).toBeLessThanOrEqual(SITEMAP_MAX_BYTES + 200);
    expect(await timed(() => readSitemap(bytes, 'application/xml', SITE))).toBeLessThan(LIMIT_MS);
  });

  it('inflates a gzip bomb to the cap and no further, quickly', async () => {
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x20));
    expect(await timed(() => readSitemap(bomb, 'application/gzip', SITE))).toBeLessThan(
      LIMIT_MS * 5,
    );
  });
});
