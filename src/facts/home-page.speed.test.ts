import { describe, expect, it } from 'vitest';
import { readHomePage } from './home-page';

// Timing tests: they run alone, in the gate's speed stage (`*.speed.test.*`), because under the
// parallel load of the other tests a linear reader was once measured above its limit. Each page
// is built at the 2 MiB cap of a fetched page. The fastest of three runs is taken, so a busy
// machine does not fail a linear reader; a super-linear one takes seconds to minutes on these.
// The limit is loose on purpose (the cases do real work, up to a million tags).

const MIB = 2 * 1024 * 1024;
const LIMIT_MS = 400;

const timed = (work: () => unknown): number => {
  let fastest = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    work();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
};

const fill = (unit: string, prefix = '', suffix = ''): string =>
  prefix + unit.repeat(Math.floor((MIB - prefix.length - suffix.length) / unit.length)) + suffix;

const ld = (json: string): string => `<script type="application/ld+json">${json}</script>`;

describe('hostile home pages at the 2 MiB cap', () => {
  it.each([
    ['only "<"', fill('<')],
    ['"<" and a letter', fill('<a')],
    ['tags that never end', fill('<a ')],
    ['quotes that never end', fill('<a title="')],
    ['quotes that end far away', fill('<a title="x" b=\'', '', '"')],
    ['"=" and quotes', fill('<a x= " y=\' ')],
    ['empty paragraphs', fill('<p>')],
    ['closing tags', fill('</p>')],
    ['closing tags of the tracked elements', fill('</main></nav></svg></template></header>')],
    ['deep nesting', fill('<div>')],
    ['main elements that never close', fill('<main>x ')],
    ['nested svg', fill('<svg>x ')],
    ['nested template', fill('<template>x ')],
    ['role=main on every element', fill('<div role="main">x ')],
    ['itemtype on every element', fill('<div itemscope itemtype="https://schema.org/Thing">x ')],
    ['comments', fill('<!-- -->')],
    ['comment that never ends', fill('<!--')],
    ['doctype-like tags', fill('<!x>')],
    ['processing instructions', fill('<?x?>')],
    ['unclosed script', fill('a', '<script>')],
    ['empty scripts', fill('<script></script>')],
    ['unclosed noscript', fill('<noscript>')],
    ['text in noscript made of "<"', `<noscript>${'<'.repeat(65536)}</noscript>`],
    ['text in title made of "<"', `<title>${'<'.repeat(65536)}</title>`],
    ['noscripts of "<" and "<a"', fill('<noscript><a<a<a</noscript>')],
    ['empty noscripts', fill('<noscript></noscript>')],
    ['unclosed styles', fill('<style>')],
    ['many ld+json scripts', fill('<script type="application/ld+json">{}</script>')],
    ['unclosed ld+json', fill('a', '<script type="application/ld+json">')],
    ['meta robots tags', fill('<meta name="robots" content="index">')],
    ['ids that look like roots', fill('<div id="root"></div>')],
    ['entities', fill('&amp;&#x41;&eacute;&nbsp;')],
    ['entity-like text', fill('&a;&')],
    ['ASCII words', fill('word ')],
    ['one long word', fill('a')],
    ['words with accents', fill('é ')],
    ['Chinese text', fill('我们一起去公园玩吧。')],
    ['Japanese text', fill('今日は天気がいいですね。')],
    ['underscores', fill('_ ')],
    ['text and inline tags', fill('a<b>b</b>')],
  ])('reads %s quickly', (_name, html) => {
    expect(html.length).toBeLessThanOrEqual(MIB);
    expect(timed(() => readHomePage(html, 'https://example.com/'))).toBeLessThan(LIMIT_MS);
  });

  it.each([
    [
      '5,000 small nodes',
      ld(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': Array.from({ length: 20_000 }, () => ({ '@type': 'Thing' })),
        }),
      ),
    ],
    ['a deep array', ld(`${'['.repeat(500_000)}${']'.repeat(500_000)}`)],
    ['a deep object', ld(`${'{"a":'.repeat(100_000)}1${'}'.repeat(100_000)}`)],
    [
      'a wide object',
      ld(
        `{"@context":"https://schema.org",${Array.from({ length: 30_000 }, (_, i) => `"k${i}":${i}`).join(',')}}`,
      ),
    ],
    [
      'a long string',
      ld(
        `{"@context":"https://schema.org","@type":"Organization","name":"${'x'.repeat(500_000)}"}`,
      ),
    ],
    [
      'a long sameAs list',
      ld(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          sameAs: Array.from({ length: 15_000 }, (_, i) => `https://example.org/${i}`),
        }),
      ),
    ],
    [
      '50 blocks',
      Array.from({ length: 50 }, () =>
        ld(
          JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': Array.from({ length: 200 }, () => ({ '@type': 'Thing', name: 'x' })),
          }),
        ),
      ).join(''),
    ],
    [
      'a context array',
      ld(
        JSON.stringify({
          '@context': Array.from({ length: 100_000 }, () => 'x'),
          '@type': 'Thing',
        }),
      ),
    ],
    [
      'types of 100,000 names',
      ld(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': Array.from({ length: 50_000 }, (_, i) => `T${i}`),
        }),
      ),
    ],
  ])('reads JSON-LD with %s quickly', (_name, html) => {
    expect(html.length).toBeLessThanOrEqual(MIB);
    expect(timed(() => readHomePage(html, 'https://example.com/'))).toBeLessThan(LIMIT_MS * 2);
  });
});
