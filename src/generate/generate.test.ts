import { describe, expect, it } from 'vitest';
import {
  MAIN_SECTION,
  pageMeta,
  renderLlmsTxt,
  sitemapLocations,
  stripUnsafeCharacters,
} from './index';

describe('what a page says about itself', () => {
  it('reads the title, the first H1 and the meta description as written', () => {
    const meta = pageMeta(`<!doctype html><html><head>
      <title> Pricing &amp; plans | Example </title>
      <meta content="Plans for &quot;teams&quot; of every size." name="Description">
      <meta name="robots" content="index, follow">
      <script>document.title = "<h1>not this</h1>"</script>
    </head><body><!-- <h1>nor this</h1> --><h1 class="x">Plans <em>for</em> teams</h1><h1>Second</h1></body></html>`);
    expect(meta).toEqual({
      title: 'Pricing & plans | Example',
      h1: 'Plans for teams',
      description: 'Plans for "teams" of every size.',
      noindex: false,
    });
  });

  it('reads noindex, and gives null for what a page lacks', () => {
    expect(pageMeta('<meta name="robots" content="NOINDEX">')).toEqual({
      title: null,
      h1: null,
      description: null,
      noindex: true,
    });
  });

  it('removes control and reordering characters, and cuts long fields', () => {
    const meta = pageMeta(
      `<title>A\u0007B${String.fromCharCode(0x202e)}C</title><meta name="description" content="${'x'.repeat(600)}">`,
    );
    expect(meta.title).toBe('ABC');
    expect(meta.description!.length).toBe(500);
    expect(stripUnsafeCharacters('a\u0000b\u009bc\u2066d\ne')).toBe('abcd\ne');
    // The Arabic letter mark and the deprecated format controls reorder or hide text too.
    expect(stripUnsafeCharacters('a\u061cb\u206ac\u206fd\u2069e')).toBe('abcde');
    // Zero-width joiners and the line separator are not touched here.
    expect(stripUnsafeCharacters('a\u200db\u2028c')).toBe('a\u200db\u2028c');
  });
});

describe('the addresses a sitemap lists', () => {
  it('reads a urlset up to the limit, CDATA and entities included', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://site.test/a?x=1&amp;y=2</loc></url>
      <url><loc><![CDATA[https://site.test/b]]></loc></url>
      <url><loc>https://site.test/c</loc></url></urlset>`;
    expect(sitemapLocations(xml, 2)).toEqual({
      kind: 'urlset',
      locations: ['https://site.test/a?x=1&y=2', 'https://site.test/b'],
    });
  });

  it('tells an index of sitemaps, and something else, apart', () => {
    expect(
      sitemapLocations(
        '<sitemapindex><sitemap><loc>https://site.test/s1.xml</loc></sitemap></sitemapindex>',
        5,
      ).kind,
    ).toBe('index');
    expect(sitemapLocations('<html><loc>https://x.test</loc></html>', 5)).toEqual({
      kind: 'unknown',
      locations: [],
    });
  });
});

describe('the llms.txt built from pages', () => {
  it('groups pages by first path segment, main pages first, as written', () => {
    const text = renderLlmsTxt({ name: 'Example', summary: 'Tools for teams.' }, [
      { url: 'https://site.test/blog/one', title: 'First post', description: 'The first one.' },
      { url: 'https://site.test/pricing', title: 'Pricing', description: null },
      { url: 'https://site.test/blog/two', title: 'Second [draft]', description: 'Two\nlines' },
      { url: 'https://site.test/getting-started/', title: 'Start (here)', description: null },
      { url: 'https://site.test/getting-started/install', title: 'Install', description: null },
      { url: 'https://site.test/blog', title: 'Blog', description: null },
    ]);
    expect(text).toBe(
      [
        '# Example',
        '',
        '> Tools for teams.',
        '',
        `## ${MAIN_SECTION}`,
        '',
        '- [Pricing](https://site.test/pricing)',
        '',
        '## Blog',
        '',
        '- [First post](https://site.test/blog/one): The first one.',
        '- [Second \\[draft\\]](https://site.test/blog/two): Two lines',
        '- [Blog](https://site.test/blog)',
        '',
        '## Getting started',
        '',
        '- [Start (here)](https://site.test/getting-started/)',
        '- [Install](https://site.test/getting-started/install)',
        '',
      ].join('\n'),
    );
  });

  it('encodes what would end a link, and leaves out an empty summary', () => {
    const text = renderLlmsTxt({ name: 'Site', summary: null }, [
      { url: 'https://site.test/a(b)', title: '', description: null },
    ]);
    expect(text).toBe(
      '# Site\n\n## Main pages\n\n- [https://site.test/a%28b%29](https://site.test/a%28b%29)\n',
    );
  });
});

describe('adversarial text at the caps', () => {
  // Each parser reads remote text in one pass: these inputs made the earlier regular
  // expressions take seconds to minutes. Each must finish well under 100 ms at the full cap.
  const PAGE = 2 * 1024 * 1024;
  const SITEMAP = 5 * 1024 * 1024;
  // The fastest of three runs, so a busy machine does not fail a linear parser; a
  // super-linear one takes seconds to minutes on these inputs.
  const timed = (work: () => unknown) => {
    let fastest = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      work();
      fastest = Math.min(fastest, performance.now() - started);
    }
    return fastest;
  };

  it.each([
    ['an unclosed comment', '<!--'.repeat(PAGE / 4)],
    ['comment openers before one close', `${'<!--'.repeat(PAGE / 8)}-->`],
    ['unclosed scripts', '<script>'.repeat(PAGE / 8)],
    ['unclosed styles with attributes', '<style a="'.repeat(PAGE / 10)],
    ['tags without an end', '<a'.repeat(PAGE / 2)],
    ['a meta tag of names', `<meta ${'a'.repeat(PAGE)}`],
    ['a meta tag of unclosed quotes', `<meta ${'a="'.repeat(PAGE / 3)}>`],
    ['an unclosed title full of tags', `<title>${'<b'.repeat(PAGE / 4)}`],
    ['a title full of <', `<title>${'<'.repeat(PAGE / 2)}</title>`],
  ])('reads a page of %s quickly', (_name, html) => {
    expect(timed(() => pageMeta(html))).toBeLessThan(100);
  });

  it.each([
    ['an unclosed CDATA', `<urlset>${'<loc><![CDATA['.repeat(SITEMAP / 15)}`],
    ['locs without an end', `<urlset>${'<loc'.repeat(SITEMAP / 4)}`],
    ['locs without a closing tag', `<urlset>${'<loc>x'.repeat(SITEMAP / 6)}`],
    ['empty locs', `<urlset>${'<loc></loc>'.repeat(SITEMAP / 11)}`],
    [
      'an index of empty locs',
      `<sitemapindex>${'<sitemap><loc> </loc></sitemap>'.repeat(SITEMAP / 31)}`,
    ],
  ])('reads a sitemap of %s quickly', (_name, xml) => {
    expect(timed(() => sitemapLocations(xml, 120))).toBeLessThan(100);
  });

  it('stops after 10,000 <loc> tags, usable or not', () => {
    const xml = `<urlset>${'<loc></loc>'.repeat(10_000)}<loc>https://site.test/late</loc></urlset>`;
    expect(sitemapLocations(xml, 5).locations).toEqual([]);
    const early = `<urlset>${'<loc></loc>'.repeat(9_999)}<loc>https://site.test/in</loc></urlset>`;
    expect(sitemapLocations(early, 5).locations).toEqual(['https://site.test/in']);
  });

  it('leaves out a sitemap address over 2,048 characters', () => {
    const long = `https://site.test/${'a'.repeat(2100)}`;
    expect(
      sitemapLocations(`<urlset><loc>${long}</loc><loc>https://site.test/b</loc></urlset>`, 5)
        .locations,
    ).toEqual(['https://site.test/b']);
  });
});
