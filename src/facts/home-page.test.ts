import { describe, expect, it } from 'vitest';
import { readHomePage, xRobotsNoindex } from './home-page';
import { MAX_LD_BLOCK_CHARS, MAX_LD_BLOCKS, MAX_LD_TOTAL_CHARS } from './html';
import { MAX_LD_DEPTH, MAX_LD_NODES } from './json-ld';

const URL_ = 'https://www.example.com/';
const words = (count: number, word = 'word'): string => `${word} `.repeat(count).trim();

function page(body: string, head = ''): string {
  return `<!doctype html><html><head><title>T</title>${head}</head><body>${body}</body></html>`;
}

function ld(data: unknown, type = 'application/ld+json'): string {
  return `<script type="${type}">${typeof data === 'string' ? data : JSON.stringify(data)}</script>`;
}

const ctx = 'https://schema.org';

describe('main text', () => {
  it('counts the text of <main> when there is one, and not the chrome around it', () => {
    const facts = readHomePage(
      page(`<header>${words(30, 'head')}</header><nav>${words(30, 'nav')}</nav>
        <main><h1>Title</h1><p>${words(160)}</p></main><footer>${words(40, 'foot')}</footer>`),
      URL_,
    );
    expect(facts.mainSource).toBe('main');
    expect(facts.mainWords).toBe(161);
    expect(facts.content).toBe('text_in_html');
  });

  it('counts the text of [role=main], with nested elements of the same name', () => {
    const facts = readHomePage(
      page(
        `<div>${words(100, 'outside')}</div><div role="main"><div><p>${words(10, 'in')}</p></div><div>${words(5, 'also')}</div></div><div>${words(100, 'after')}</div>`,
      ),
      URL_,
    );
    expect(facts.mainSource).toBe('main');
    expect(facts.mainWords).toBe(15);
  });

  it('counts the body without header, nav, footer and aside when there is no main', () => {
    const facts = readHomePage(
      page(
        `<header>${words(30, 'head')}</header><nav><ul><li>${words(30, 'nav')}</li></ul></nav><p>${words(60)}</p><aside>${words(30, 'side')}</aside><p>${words(40)}</p><footer>${words(40, 'foot')}</footer>`,
      ),
      URL_,
    );
    expect(facts.mainSource).toBe('body');
    expect(facts.mainWords).toBe(100);
    expect(facts.content).toBe('little_text');
  });

  it('never counts script, style, noscript, template, svg, textarea or the head', () => {
    const facts = readHomePage(
      page(
        `<script>var a = "${words(50, 'js')}";</script><style>.a{content:"${words(50, 'css')}"}</style>
         <noscript>${words(50, 'ns')}</noscript><template><p>${words(50, 'tpl')}</p></template>
         <svg viewBox="0 0 1 1"><text>${words(50, 'svg')}</text></svg><textarea>${words(50, 'ta')}</textarea><p>real text here</p>`,
        `<meta name="description" content="${words(50, 'meta')}">`,
      ),
      URL_,
    );
    expect(facts.mainWords).toBe(3);
  });

  it('ends an svg that closes itself, and a template that nests', () => {
    const facts = readHomePage(
      page(`<svg/><p>one two</p><template><template>x</template>y</template><p>three</p>`),
      URL_,
    );
    expect(facts.mainWords).toBe(3);
  });

  it('keeps a word whole across inline tags and splits it at block tags', () => {
    expect(readHomePage(page('<p>Hel<b>lo</b> wor<span>ld</span></p>'), URL_).mainWords).toBe(2);
    expect(readHomePage(page('<p>Hel</p><p>lo</p>'), URL_).mainWords).toBe(2);
    expect(readHomePage(page('a<br>b'), URL_).mainWords).toBe(2);
  });

  it('decodes entities, so an entity does not split or add a word', () => {
    const facts = readHomePage(
      page('<p>caf&eacute; &amp; cr&egrave;me&nbsp;br&#251;l&#xE9;e &copy; 2026</p>'),
      URL_,
    );
    // café, crème, brûlée, 2026; "&" and the copyright sign are not words.
    expect(facts.mainWords).toBe(4);
  });

  it('counts text of a page whose head is never closed and that has no body tag', () => {
    expect(
      readHomePage('<html><head><title>T</title><meta charset="utf-8"><p>one two three</p>', URL_)
        .mainWords,
    ).toBe(3);
    expect(readHomePage('<head><title>T</title>plain text here', URL_).mainWords).toBe(3);
    // Still not counted: the head's own content.
    expect(
      readHomePage(
        '<html><head><title>a b c</title><meta name="description" content="d e f"></head>',
        URL_,
      ).mainWords,
    ).toBe(0);
  });

  it('counts Chinese and Japanese text', () => {
    const chinese = readHomePage(
      page(`<main><p>${'我们一起去公园玩吧，今天天气很好。'.repeat(20)}</p></main>`),
      URL_,
    );
    expect(chinese.mainWords).toBeGreaterThan(150);
    expect(chinese.content).toBe('text_in_html');
    const japanese = readHomePage(
      page(`<p>${'今日は天気がいいですね。散歩に行きましょう。'.repeat(20)}</p>`),
      URL_,
    );
    expect(japanese.mainWords).toBeGreaterThan(150);
  });

  it('ignores a comment, a doctype and a CDATA section', () => {
    const facts = readHomePage(
      page(`<!-- ${words(50, 'c')} --><p>one</p><![CDATA[ ${words(50, 'cd')} ]]><p>two</p>`),
      URL_,
    );
    expect(facts.mainWords).toBe(2);
  });

  it('reads a page that is cut anywhere without throwing', () => {
    const whole = page(
      `<main><p>${words(200)}</p></main>${ld({ '@context': ctx, '@type': 'Organization', name: 'A' })}<p title="x>y">tail</p>`,
    );
    for (let at = 0; at < whole.length; at += 7) {
      expect(() => readHomePage(whole.slice(0, at), URL_)).not.toThrow();
    }
    expect(readHomePage(whole.slice(0, whole.indexOf('</main>')), URL_).mainWords).toBe(200);
  });

  it('takes a ">" inside a quoted attribute as part of the attribute', () => {
    const facts = readHomePage(page('<p title="a > b">visible text</p>'), URL_);
    expect(facts.mainWords).toBe(2);
  });

  it('reads a stray "<" as text', () => {
    expect(readHomePage(page('<p>1 < 2 and 3 << 4</p>'), URL_).mainWords).toBe(5);
  });
});

describe('the empty app shell', () => {
  const padding = `<script>${'x'.repeat(6000)}</script>`;

  it.each(['root', 'app', '__next', '__nuxt', 'app-root'])('finds #%s with no text', (id) => {
    const facts = readHomePage(page(`<div id="${id}"></div>${padding}`), URL_);
    expect(facts.appRoot).toBe(true);
    expect(facts.content).toBe('app_shell');
  });

  it.each([
    '<app-root></app-root>',
    '<div ng-version="17.0.0"></div>',
    '<div data-reactroot></div>',
    '<div data-server-rendered="true"></div>',
    '<body ng-app="x">',
  ])('finds the root mark %s', (mark) => {
    const facts = readHomePage(`<html><body>${mark}${padding}</body></html>`, URL_);
    expect(facts.appRoot).toBe(true);
    expect(facts.content).toBe('app_shell');
  });

  it('finds an enable-JavaScript notice without a root element', () => {
    const facts = readHomePage(
      page(`<noscript>You need to enable JavaScript to run this app.</noscript>${padding}`),
      URL_,
    );
    expect(facts.appRoot).toBe(false);
    expect(facts.jsNotice).toBe(true);
    expect(facts.content).toBe('app_shell');
  });

  it('does not call a small page a shell, or a page with text', () => {
    expect(readHomePage(page('<div id="root"></div>'), URL_).content).toBe('little_text');
    expect(
      readHomePage(page(`<div id="root"><p>${words(200)}</p></div>${padding}`), URL_).content,
    ).toBe('text_in_html');
    expect(
      readHomePage(page(`<div id="root"><p>${words(80)}</p></div>${padding}`), URL_).content,
    ).toBe('little_text');
  });

  it('does not take an id inside a script for a root', () => {
    const facts = readHomePage(
      page(`<script>document.write('<div id="root"></div>')</script>${padding}`),
      URL_,
    );
    expect(facts.appRoot).toBe(false);
  });
});

describe('noindex', () => {
  it('reads the robots meta tag', () => {
    const facts = readHomePage(
      page('<p>x</p>', '<meta name="robots" content="NoIndex, nofollow">'),
      URL_,
    );
    expect(facts).toMatchObject({ noindex: true, noindexSource: 'meta' });
  });

  it('ignores a meta tag for one crawler and a plain index', () => {
    expect(readHomePage(page('', '<meta name="googlebot" content="noindex">'), URL_).noindex).toBe(
      false,
    );
    expect(
      readHomePage(page('', '<meta name="robots" content="index, follow">'), URL_).noindex,
    ).toBe(false);
  });

  it('reads the X-Robots-Tag header, with and without an agent', () => {
    expect(readHomePage(page(''), URL_, { xRobotsTag: 'noindex' })).toMatchObject({
      noindex: true,
      noindexSource: 'header',
    });
    expect(
      readHomePage(page('', '<meta name="robots" content="noindex">'), URL_, {
        xRobotsTag: ['none'],
      }),
    ).toMatchObject({ noindex: true, noindexSource: 'both' });
    expect(xRobotsNoindex('googlebot: noindex')).toBe(false);
    expect(xRobotsNoindex(['googlebot: noindex, nofollow', 'nofollow'])).toBe(false);
    expect(xRobotsNoindex('bingbot: noindex, noindex')).toBe(false);
    expect(xRobotsNoindex('nofollow, noindex')).toBe(true);
    expect(xRobotsNoindex(['otherbot: noindex', 'noindex'])).toBe(true);
    expect(xRobotsNoindex('unavailable_after: 25 Jun 2030 15:00:00 PST')).toBe(false);
    expect(xRobotsNoindex(null)).toBe(false);
    expect(xRobotsNoindex(undefined)).toBe(false);
  });
});

describe('JSON-LD', () => {
  it('finds an Organization with name, url, logo and sameAs', () => {
    const facts = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@type': 'Organization',
          name: 'Example Co',
          url: 'https://www.example.com/',
          logo: 'https://www.example.com/logo.png',
          sameAs: [
            'https://www.wikidata.org/wiki/Q1',
            'https://en.wikipedia.org/wiki/Example',
            'https://www.linkedin.com/company/example',
            'https://twitter.com/example',
            'https://x.com/example',
            'https://www.facebook.com/example',
            'https://example.com/about',
            'https://blog.example.com/',
            'https://www.linkedin.com/company/example/',
            'https://example.org/profile',
            'not a url',
          ],
        }),
      ),
      URL_,
    );
    expect(facts.organization).toBe('json_ld');
    expect(facts.organizationType).toBe('Organization');
    expect(facts.primary).toMatchObject({
      type: 'Organization',
      name: 'Example Co',
      url: 'https://www.example.com/',
      nameAndUrl: true,
      logo: true,
    });
    // The two links on the site's own domain and the repeated LinkedIn page are left out.
    expect(facts.primary!.sameAs).toHaveLength(7);
    expect(facts.primary!.sameAsKinds).toEqual([
      'wikidata',
      'wikipedia',
      'linkedin',
      'x',
      'facebook',
      'other',
    ]);
    expect(facts.jsonLd).toMatchObject({
      scripts: 1,
      parsed: 1,
      schemaOrgBlocks: 1,
      errors: 0,
      bounds: [],
    });
  });

  it('finds an Organization in a nested @graph', () => {
    const facts = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@graph': [
            { '@type': 'WebPage', '@id': '#page' },
            {
              '@type': ['Thing', 'Corporation'],
              name: 'Deep',
              url: 'https://example.com/',
              sameAs: 'https://github.com/deep',
            },
          ],
        }),
      ),
      URL_,
    );
    expect(facts.primary).toMatchObject({ type: 'Corporation', name: 'Deep' });
    expect(facts.primary!.sameAsKinds).toEqual(['github']);
  });

  it('finds an Organization nested as a publisher, and a top-level array', () => {
    const nested = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@type': 'Article',
          publisher: { '@type': 'Organization', name: 'Pub' },
        }),
      ),
      URL_,
    );
    expect(nested.primary?.name).toBe('Pub');
    expect(nested.primary?.nameAndUrl).toBe(false);
    const array = readHomePage(
      page(
        ld([
          { '@context': ctx, '@type': 'WebSite', url: 'https://example.com/' },
          { '@context': ctx, '@type': 'Organization', name: 'B' },
        ]),
      ),
      URL_,
    );
    expect(array.organization).toBe('json_ld');
    expect(array.website).toBe(true);
  });

  it.each([
    'LocalBusiness',
    'Restaurant',
    'NewsMediaOrganization',
    'OnlineStore',
    'Corporation',
    'NGO',
    'EducationalOrganization',
    'MedicalClinic',
    'Airline',
  ])('counts the subtype %s as an Organization', (type) => {
    const facts = readHomePage(page(ld({ '@context': ctx, '@type': type, name: 'N' })), URL_);
    expect(facts.organization).toBe('json_ld');
    expect(facts.organizationType).toBe(type);
  });

  it.each(['Person', 'Product', 'WebSite', 'organization', 'Organisation', 'Thing'])(
    'does not count %s as an Organization',
    (type) => {
      const facts = readHomePage(page(ld({ '@context': ctx, '@type': type, name: 'N' })), URL_);
      expect(facts.organization).toBe('none');
    },
  );

  it('removes the schema: and http(s)://schema.org/ prefixes', () => {
    for (const type of [
      'schema:Organization',
      'http://schema.org/Organization',
      'https://schema.org/Organization',
    ]) {
      expect(
        readHomePage(page(ld({ '@context': ctx, '@type': type, name: 'N' })), URL_).organization,
      ).toBe('json_ld');
    }
  });

  it('accepts http and https schema.org contexts, an array, and @vocab; refuses others', () => {
    const body = { '@type': 'Organization', name: 'N' };
    for (const context of [
      'http://schema.org',
      'https://schema.org/',
      'https://schema.org/version/latest/context',
      ['https://schema.org', { x: 'y' }],
      { '@vocab': 'https://schema.org/' },
    ]) {
      expect(
        readHomePage(page(ld({ '@context': context, ...body })), URL_).organization,
        JSON.stringify(context),
      ).toBe('json_ld');
    }
    for (const context of [undefined, 'https://example.org/ctx', 'https://notschema.org/', 42]) {
      const facts = readHomePage(page(ld({ '@context': context, ...body })), URL_);
      expect(facts.organization, JSON.stringify(context)).toBe('none');
      expect(facts.jsonLd).toMatchObject({ parsed: 1, schemaOrgBlocks: 0 });
    }
  });

  it('compares the script type without case and parameters', () => {
    for (const type of [
      'APPLICATION/LD+JSON',
      'application/ld+json; charset=utf-8',
      ' application/ld+json ',
    ]) {
      expect(
        readHomePage(page(ld({ '@context': ctx, '@type': 'Organization', name: 'N' }, type)), URL_)
          .organization,
      ).toBe('json_ld');
    }
    expect(
      readHomePage(page(ld({ '@context': ctx, '@type': 'Organization' }, 'application/json')), URL_)
        .jsonLd.scripts,
    ).toBe(0);
  });

  it('removes a wrapping comment or CDATA marker', () => {
    const data = JSON.stringify({ '@context': ctx, '@type': 'Organization', name: 'N' });
    for (const wrapped of [`<!-- ${data} -->`, `<![CDATA[ ${data} ]]>`, `\ufeff${data}`]) {
      expect(readHomePage(page(ld(wrapped)), URL_).organization, wrapped.slice(0, 12)).toBe(
        'json_ld',
      );
    }
  });

  it('counts a block that does not parse, and still reads the others', () => {
    const facts = readHomePage(
      page(
        `${ld('{"@context": "https://schema.org", "@type": "Organization", name: }')}${ld({ '@context': ctx, '@type': 'WebSite' })}${ld('')}`,
      ),
      URL_,
    );
    expect(facts.jsonLd).toMatchObject({ scripts: 3, parsed: 1, schemaOrgBlocks: 1, errors: 2 });
    expect(facts.website).toBe(true);
    expect(facts.organization).toBe('none');
  });

  it('chooses as primary the first node whose url is on the site, else the first', () => {
    const facts = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@graph': [
            { '@type': 'Organization', name: 'Partner', url: 'https://partner.example.org/' },
            { '@type': 'Organization', name: 'Us', url: 'https://shop.example.com/' },
          ],
        }),
      ),
      URL_,
    );
    expect(facts.primary?.name).toBe('Us');
    const first = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@graph': [
            { '@type': 'Organization', name: 'A', url: 'https://a.example.org/' },
            { '@type': 'Organization', name: 'B' },
          ],
        }),
      ),
      URL_,
    );
    expect(first.primary?.name).toBe('A');
  });

  it('knows the common two-label suffixes when choosing the site, and takes a function for the rest', () => {
    const data = ld({
      '@context': ctx,
      '@graph': [
        { '@type': 'Organization', name: 'Other', url: 'https://other.co.uk/' },
        {
          '@type': 'Organization',
          name: 'Us',
          url: 'https://www.shop.co.uk/',
          sameAs: ['https://other.co.uk/x', 'https://shop.co.uk/y'],
        },
      ],
    });
    const facts = readHomePage(page(data), 'https://shop.co.uk/');
    expect(facts.primary?.name).toBe('Us');
    expect(facts.primary?.sameAs).toEqual(['https://other.co.uk/x']);
    const custom = readHomePage(page(data), 'https://shop.co.uk/', {
      registrableDomain: (host) => host.replace(/^www\./, ''),
    });
    expect(custom.primary?.name).toBe('Us');
  });

  it('judges name, url, logo and sameAs of the primary node', () => {
    const bare = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@type': 'Organization',
          name: '  ',
          url: 'ftp://example.com/',
          logo: '',
          sameAs: ['https://example.com/a'],
        }),
      ),
      URL_,
    );
    expect(bare.primary).toMatchObject({
      name: null,
      url: null,
      nameAndUrl: false,
      logo: false,
      sameAs: [],
      sameAsKinds: [],
    });
    const logo = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@type': 'Organization',
          name: 'N',
          logo: { '@type': 'ImageObject', url: '/img/logo.svg' },
        }),
      ),
      URL_,
    );
    expect(logo.primary?.logo).toBe(true);
    const noLogo = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@type': 'Organization',
          name: 'N',
          logo: { '@type': 'ImageObject', width: 10 },
        }),
      ),
      URL_,
    );
    expect(noLogo.primary?.logo).toBe(false);
    const single = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@type': 'Organization',
          name: { '@value': 'Val' },
          url: ['https://example.com/'],
          sameAs: 'https://www.youtube.com/@x',
        }),
      ),
      URL_,
    );
    expect(single.primary).toMatchObject({
      name: 'Val',
      nameAndUrl: true,
      sameAsKinds: ['youtube'],
    });
  });

  it('classifies sameAs hosts', () => {
    const urls = {
      wikidata: 'https://www.wikidata.org/wiki/Q42',
      wikipedia: 'https://vi.wikipedia.org/wiki/X',
      linkedin: 'https://www.linkedin.com/company/x',
      x: 'https://x.com/x',
      facebook: 'https://m.facebook.com/x',
      instagram: 'https://www.instagram.com/x/',
      youtube: 'https://youtu.be/abc',
      tiktok: 'https://www.tiktok.com/@x',
      github: 'https://github.com/x',
      crunchbase: 'https://www.crunchbase.com/organization/x',
      pinterest: 'https://www.pinterest.com/x/',
      other: 'https://mastodon.social/@x',
    };
    const facts = readHomePage(
      page(
        ld({ '@context': ctx, '@type': 'Organization', name: 'N', sameAs: Object.values(urls) }),
      ),
      URL_,
    );
    expect(facts.primary!.sameAsKinds).toEqual(Object.keys(urls));
    expect(facts.primary!.sameAs).toHaveLength(12);
    // A look-alike host is not the profile.
    const fake = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@type': 'Organization',
          name: 'N',
          sameAs: ['https://notlinkedin.com/x', 'https://linkedin.com.evil.example/x'],
        }),
      ),
      URL_,
    );
    expect(fake.primary!.sameAsKinds).toEqual(['other']);
  });

  it('finds WebSite with a SearchAction, and FAQPage', () => {
    const facts = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@graph': [
            {
              '@type': 'WebSite',
              url: 'https://example.com/',
              potentialAction: [
                { '@type': 'ReadAction' },
                { '@type': 'SearchAction', target: 'https://example.com/?q={q}' },
              ],
            },
            { '@type': 'FAQPage', mainEntity: [] },
          ],
        }),
      ),
      URL_,
    );
    expect(facts).toMatchObject({ website: true, searchAction: true, faqPage: true });
    const plain = readHomePage(
      page(ld({ '@context': ctx, '@type': 'WebSite', potentialAction: { '@type': 'ReadAction' } })),
      URL_,
    );
    expect(plain).toMatchObject({ website: true, searchAction: false, faqPage: false });
  });

  it('lists the types in use, each once', () => {
    const facts = readHomePage(
      page(
        ld({
          '@context': ctx,
          '@graph': [
            { '@type': 'WebSite' },
            { '@type': 'WebPage' },
            { '@type': 'WebSite' },
            { '@type': 'ImageObject' },
          ],
        }),
      ),
      URL_,
    );
    expect(facts.types).toEqual(['WebSite', 'WebPage', 'ImageObject']);
  });
});

describe('microdata', () => {
  it('finds an Organization that is in microdata only', () => {
    const facts = readHomePage(
      page(
        '<div itemscope itemtype="https://schema.org/LocalBusiness"><span itemprop="name">N</span></div>',
      ),
      URL_,
    );
    expect(facts.organization).toBe('microdata');
    expect(facts.organizationType).toBe('LocalBusiness');
    expect(facts.primary).toBeNull();
    expect(facts.microdataTypes).toEqual(['LocalBusiness']);
    expect(facts.types).toEqual(['LocalBusiness']);
  });

  it('prefers JSON-LD, and reads several types in one itemtype, FAQPage and WebSite', () => {
    const facts = readHomePage(
      page(
        `<div itemscope itemtype="http://schema.org/FAQPage http://schema.org/WebSite"></div><section ITEMTYPE='https://schema.org/Organization'></section>${ld({ '@context': ctx, '@type': 'Organization', name: 'J' })}`,
      ),
      URL_,
    );
    expect(facts.organization).toBe('json_ld');
    expect(facts.faqPage).toBe(true);
    expect(facts.website).toBe(true);
    expect(facts.microdataTypes).toEqual(['FAQPage', 'WebSite', 'Organization']);
  });

  it('ignores itemtypes outside schema.org', () => {
    const facts = readHomePage(
      page('<div itemscope itemtype="https://example.org/Organization"></div>'),
      URL_,
    );
    expect(facts.organization).toBe('none');
    expect(facts.microdataTypes).toEqual([]);
  });
});

describe('the JSON-LD bounds', () => {
  const org = { '@context': ctx, '@type': 'Organization', name: 'N' };

  it('reads at most 50 blocks and says so', () => {
    const blocks = Array.from({ length: MAX_LD_BLOCKS + 5 }, () => ld(org)).join('');
    const facts = readHomePage(page(blocks), URL_);
    expect(facts.jsonLd.parsed).toBe(MAX_LD_BLOCKS);
    expect(facts.jsonLd.bounds).toEqual(['blocks']);
    expect(facts.jsonLd.scripts).toBe(MAX_LD_BLOCKS + 5);
  });

  it('leaves out a block over 512 KiB and keeps reading the next', () => {
    const big = ld({ ...org, note: 'x'.repeat(MAX_LD_BLOCK_CHARS) });
    const facts = readHomePage(page(`${big}${ld({ '@context': ctx, '@type': 'WebSite' })}`), URL_);
    expect(facts.jsonLd.bounds).toEqual(['block_size']);
    expect(facts.jsonLd.parsed).toBe(1);
    expect(facts.website).toBe(true);
    expect(facts.organization).toBe('none');
  });

  it('stops at 1 MiB of blocks in all', () => {
    const chunk = ld({ ...org, note: 'x'.repeat(Math.floor(MAX_LD_TOTAL_CHARS * 0.4)) });
    const facts = readHomePage(page(chunk + chunk + chunk + chunk), URL_);
    expect(facts.jsonLd.bounds).toEqual(['total_size']);
    expect(facts.jsonLd.parsed).toBe(2);
  });

  it('does not read past depth 16', () => {
    let deep: unknown = { '@type': 'Organization', name: 'Deep' };
    for (let level = 0; level < MAX_LD_DEPTH + 2; level += 1) deep = { child: deep };
    const facts = readHomePage(page(ld({ '@context': ctx, ...(deep as object) })), URL_);
    expect(facts.jsonLd.bounds).toEqual(['depth']);
    expect(facts.organization).toBe('none');
    let shallow: unknown = { '@type': 'Organization', name: 'Ok' };
    for (let level = 0; level < MAX_LD_DEPTH - 2; level += 1) shallow = { child: shallow };
    expect(
      readHomePage(page(ld({ '@context': ctx, ...(shallow as object) })), URL_).organization,
    ).toBe('json_ld');
  });

  it('reads at most 5,000 nodes', () => {
    const nodes = Array.from({ length: MAX_LD_NODES + 10 }, (_, index) => ({
      '@type': 'Thing',
      name: `n${index}`,
    }));
    const facts = readHomePage(
      page(
        ld({ '@context': ctx, '@graph': [...nodes, { '@type': 'Organization', name: 'Late' }] }),
      ),
      URL_,
    );
    expect(facts.jsonLd.bounds).toEqual(['nodes']);
    expect(facts.organization).toBe('none');
  });

  it('survives a deeply nested array', () => {
    const facts = readHomePage(page(ld(`${'['.repeat(100_000)}${']'.repeat(100_000)}`)), URL_);
    expect(facts.jsonLd.errors + facts.jsonLd.parsed).toBe(1);
  });

  it('survives hostile keys', () => {
    const text =
      '{"@context":"https://schema.org","__proto__":{"@type":"Organization","name":"P"},"constructor":{"@type":"Organization"},"@type":"WebSite"}';
    const facts = readHomePage(page(ld(text)), URL_);
    expect(facts.website).toBe(true);
    expect(({} as Record<string, unknown>)['name']).toBeUndefined();
  });
});

describe('the page as a whole', () => {
  it('reports the size and the address', () => {
    const facts = readHomePage('<p>héllo</p>', 'https://WWW.Example.com./x');
    expect(facts).toMatchObject({
      bytes: 13,
      host: 'www.example.com',
      url: 'https://WWW.Example.com./x',
    });
  });

  it('reads an unusable address and an empty page without throwing', () => {
    expect(readHomePage('', 'not a url')).toMatchObject({
      host: '',
      mainWords: 0,
      content: 'little_text',
      organization: 'none',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(readHomePage('x', URL_))).toBe(true);
  });
});
