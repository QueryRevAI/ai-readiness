import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readSitemap, readSitemapText, SITEMAP_MAX_BYTES } from './sitemap';

const SITE = 'https://www.example.com/';
const urlset = (locs: string[], extra = ''): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${extra}>${locs
    .map((loc) => `<url><loc>${loc}</loc></url>`)
    .join('')}</urlset>`;
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('an XML sitemap', () => {
  it('is a valid urlset with addresses on the site', async () => {
    const facts = await readSitemap(
      bytes(urlset(['https://www.example.com/a', 'https://example.com/b'])),
      'application/xml',
      SITE,
    );
    expect(facts).toMatchObject({
      outcome: 'valid',
      kind: 'urlset',
      locs: 2,
      gzip: false,
      truncated: false,
      reason: null,
    });
  });

  it('is a valid sitemap index', async () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://www.example.com/s1.xml</loc></sitemap></sitemapindex>`;
    expect(await readSitemap(bytes(xml), 'text/xml', SITE)).toMatchObject({
      outcome: 'valid',
      kind: 'index',
      locs: 1,
    });
  });

  it('reads an address in CDATA, with entities, and a byte order mark', async () => {
    const xml = `\ufeff${urlset(['<![CDATA[https://www.example.com/a?x=1&y=2]]>', 'https://www.example.com/b?x=1&amp;y=2'])}`;
    expect(await readSitemap(bytes(xml), 'application/xml', SITE)).toMatchObject({
      outcome: 'valid',
      locs: 2,
    });
  });

  it('reads UTF-16 text', async () => {
    const text = urlset(['https://www.example.com/a']);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(await readSitemap(utf16, 'application/xml', SITE)).toMatchObject({
      outcome: 'valid',
      kind: 'urlset',
    });
  });

  it('is not a sitemap when it is an HTML page, whatever the status said', async () => {
    const html =
      '<!DOCTYPE html><html><head><title>Not found</title></head><body><a href="https://www.example.com/">Home</a></body></html>';
    expect(await readSitemap(bytes(html), 'text/html', SITE)).toMatchObject({
      outcome: 'not_a_sitemap',
      reason: 'html',
    });
    expect(await readSitemap(bytes(html), null, SITE)).toMatchObject({
      outcome: 'not_a_sitemap',
      reason: 'html',
    });
    expect(
      await readSitemap(bytes('<html><body>x</body></html>'), 'application/xml', SITE),
    ).toMatchObject({ reason: 'html' });
    expect(
      await readSitemap(bytes('<body>a missing sitemap</body>'), 'text/html', SITE),
    ).toMatchObject({ outcome: 'not_a_sitemap', reason: 'html' });
    expect(await readSitemap(bytes('Not found'), 'text/html', SITE)).toMatchObject({
      reason: 'html',
    });
    expect(
      await readSitemap(bytes(urlset(['https://www.example.com/a'])), 'text/html', SITE),
    ).toMatchObject({
      outcome: 'valid',
    });
  });

  it('is not a sitemap when the root is something else', async () => {
    for (const xml of [
      '<rss version="2.0"><channel><link>https://www.example.com/</link></channel></rss>',
      '<feed xmlns="http://www.w3.org/2005/Atom"><loc>https://www.example.com/</loc></feed>',
      '<?xml version="1.0"?><error>nope</error>',
    ]) {
      expect(await readSitemap(bytes(xml), 'application/xml', SITE), xml).toMatchObject({
        outcome: 'not_a_sitemap',
        reason: 'bad_root',
      });
    }
  });

  it('refuses XML with a DOCTYPE or an ENTITY, unread', async () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>${urlset(['https://www.example.com/&b;'])}`;
    expect(await readSitemap(bytes(bomb), 'application/xml', SITE)).toMatchObject({
      outcome: 'malformed',
      reason: 'doctype',
    });
    const entity = `<!entity x "y">${urlset(['https://www.example.com/'])}`;
    expect(await readSitemap(bytes(entity), 'application/xml', SITE)).toMatchObject({
      reason: 'doctype',
    });
  });

  it('is malformed with no address, only off-site addresses, or no closing tag', async () => {
    expect(await readSitemap(bytes(urlset([])), 'application/xml', SITE)).toMatchObject({
      outcome: 'malformed',
      reason: 'no_loc',
      kind: 'urlset',
    });
    expect(await readSitemap(bytes(urlset(['', '  '])), 'application/xml', SITE)).toMatchObject({
      reason: 'no_loc',
    });
    expect(
      await readSitemap(
        bytes(urlset(['https://other.example.org/a', '/relative'])),
        'application/xml',
        SITE,
      ),
    ).toMatchObject({ outcome: 'malformed', reason: 'off_site', locs: 2 });
    expect(
      await readSitemap(bytes(urlset(['ftp://www.example.com/a'])), 'application/xml', SITE),
    ).toMatchObject({ reason: 'off_site' });
    const open = urlset(['https://www.example.com/a']).replace('</urlset>', '');
    expect(await readSitemap(bytes(open), 'application/xml', SITE)).toMatchObject({
      outcome: 'malformed',
      reason: 'not_closed',
    });
  });

  it('is valid with a comment or a processing instruction after the closing tag', async () => {
    const closed = urlset(['https://www.example.com/a']);
    for (const tail of [
      '\n<!-- generated by a plugin, 12 queries in 0.2 seconds -->',
      '<!-- one --><!-- two -->\n',
      '\n<?xml-stylesheet href="x.xsl"?>\n',
      '  \n<!-- a -->\n<?pi?>\n<!-- b -->  ',
    ]) {
      expect(await readSitemap(bytes(closed + tail), 'application/xml', SITE), tail).toMatchObject({
        outcome: 'valid',
      });
    }
    expect(
      await readSitemap(
        bytes(closed.replace('</urlset>', '') + '<!-- x -->'),
        'application/xml',
        SITE,
      ),
    ).toMatchObject({ reason: 'not_closed' });
  });

  it('reads a root with a prefix bound to the sitemaps.org namespace', async () => {
    const ns = 'http://www.sitemaps.org/schemas/sitemap/0.9';
    const xml = `<?xml version="1.0"?><ns0:urlset xmlns:ns0="${ns}"><ns0:url><ns0:loc>https://www.example.com/a</ns0:loc></ns0:url><ns0:url><ns0:loc>https://www.example.com/b</ns0:loc></ns0:url></ns0:urlset>`;
    expect(await readSitemap(bytes(xml), 'application/xml', SITE)).toMatchObject({
      outcome: 'valid',
      kind: 'urlset',
      locs: 2,
    });
    const index = `<sm:sitemapindex xmlns:sm='${ns}'><sm:sitemap><sm:loc>https://www.example.com/s.xml</sm:loc></sm:sitemap></sm:sitemapindex>`;
    expect(await readSitemap(bytes(index), 'application/xml', SITE)).toMatchObject({
      outcome: 'valid',
      kind: 'index',
    });
    const other = xml.replace(ns, 'http://example.org/ns');
    expect(await readSitemap(bytes(other), 'application/xml', SITE)).toMatchObject({
      reason: 'bad_root',
    });
  });

  it('is valid as far as it was read when the file is cut', async () => {
    const cut = urlset(['https://www.example.com/a', 'https://www.example.com/b']).slice(0, -30);
    expect(
      await readSitemap(bytes(cut), 'application/xml', SITE, { truncated: true }),
    ).toMatchObject({ outcome: 'valid', truncated: true });
  });

  it('knows the site by registrable domain, and takes a function for the rest', async () => {
    const xml = urlset(['https://shop.example.co.uk/a']);
    expect(
      await readSitemap(bytes(xml), 'application/xml', 'https://www.example.co.uk/'),
    ).toMatchObject({ outcome: 'valid' });
    expect(await readSitemap(bytes(xml), 'application/xml', 'https://other.co.uk/')).toMatchObject({
      reason: 'off_site',
    });
    expect(
      await readSitemap(bytes(xml), 'application/xml', 'https://other.co.uk/', {
        registrableDomain: () => 'example.co.uk',
      }),
    ).toMatchObject({ outcome: 'valid' });
  });
});

describe('a text sitemap', () => {
  it('is a list of addresses, one per line', async () => {
    const text =
      'https://www.example.com/a\r\nhttps://www.example.com/b\n\nhttps://example.com/c\n';
    expect(await readSitemap(bytes(text), 'text/plain', SITE)).toMatchObject({
      outcome: 'valid',
      kind: 'text',
      locs: 3,
    });
  });

  it('is not one when a line is not an address, or none is on the site', async () => {
    expect(await readSitemap(bytes('Not found'), 'text/plain', SITE)).toMatchObject({
      outcome: 'not_a_sitemap',
      reason: 'text_lines',
    });
    expect(
      await readSitemap(bytes('https://www.example.com/a\nhello there'), 'text/plain', SITE),
    ).toMatchObject({ reason: 'text_lines' });
    expect(
      await readSitemap(bytes('https://other.example.org/a\n'), 'text/plain', SITE),
    ).toMatchObject({ outcome: 'malformed', reason: 'off_site' });
  });

  it('leaves out the last line of a cut file', () => {
    const facts = readSitemapText(
      'https://www.example.com/a\nhttps://www.exa',
      'text/plain',
      SITE,
      { truncated: true },
    );
    expect(facts).toMatchObject({ outcome: 'valid', locs: 1, truncated: true });
  });

  it('is not a sitemap when empty', async () => {
    expect(await readSitemap(bytes(''), 'text/plain', SITE)).toMatchObject({
      outcome: 'not_a_sitemap',
      reason: 'empty',
    });
    expect(await readSitemap(bytes('  \n '), null, SITE)).toMatchObject({ reason: 'empty' });
  });
});

describe('a gzip sitemap', () => {
  it('is inflated and read', async () => {
    const packed = gzipSync(Buffer.from(urlset(['https://www.example.com/a'])));
    expect(await readSitemap(packed, 'application/gzip', SITE)).toMatchObject({
      outcome: 'valid',
      gzip: true,
      truncated: false,
    });
  });

  it('is found by its first bytes, whatever the content type', async () => {
    const packed = gzipSync(Buffer.from(urlset(['https://www.example.com/a'])));
    expect(await readSitemap(packed, 'text/html', SITE)).toMatchObject({
      outcome: 'valid',
      gzip: true,
    });
  });

  it('is malformed when the stream is corrupt', async () => {
    const packed = gzipSync(Buffer.from(urlset(['https://www.example.com/a'])));
    const broken = Buffer.concat([packed.subarray(0, 12), Buffer.alloc(20, 7)]);
    expect(await readSitemap(broken, 'application/gzip', SITE)).toMatchObject({
      outcome: 'malformed',
      reason: 'gzip_failed',
      gzip: true,
    });
  });

  it('is cut at the cap when it inflates past it (a gzip bomb), and is read as far as it goes', async () => {
    const head = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.example.com/a</loc></url>`;
    const bomb = gzipSync(Buffer.concat([Buffer.from(head), Buffer.alloc(64 * 1024 * 1024, 0x20)]));
    expect(bomb.length).toBeLessThan(200 * 1024);
    const started = performance.now();
    const facts = await readSitemap(bomb, 'application/gzip', SITE);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(facts).toMatchObject({
      outcome: 'valid',
      gzip: true,
      truncated: true,
      bytes: SITEMAP_MAX_BYTES,
    });
  });

  it('cuts plain bytes over the cap too', async () => {
    const head = `<urlset><url><loc>https://www.example.com/a</loc></url>`;
    const big = Buffer.concat([Buffer.from(head), Buffer.alloc(SITEMAP_MAX_BYTES + 100, 0x20)]);
    expect(await readSitemap(big, 'application/xml', SITE)).toMatchObject({
      outcome: 'valid',
      truncated: true,
      bytes: SITEMAP_MAX_BYTES,
    });
  });
});
