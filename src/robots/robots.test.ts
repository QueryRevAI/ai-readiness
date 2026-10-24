import { describe, expect, it } from 'vitest';
import { crawlDelayFor, isAllowedByRobots, matchRobots, parseRobots } from './index';

const allows = (body: string, path: string, agent = 'QueryRevBot') =>
  isAllowedByRobots(parseRobots(body), agent, path);

describe('robots.txt matching (RFC 9309)', () => {
  it('allows everything without a matching group or rule', () => {
    expect(allows('', '/anything')).toBe(true);
    expect(allows('User-agent: OtherBot\nDisallow: /', '/anything')).toBe(true);
    expect(allows('Disallow: /\n', '/x')).toBe(true); // a rule before any group belongs to none
  });

  it('uses the group for our token, else *, and not both', () => {
    const body = 'User-agent: *\nDisallow: /\n\nUser-agent: queryrevbot\nDisallow: /private\n';
    expect(allows(body, '/public')).toBe(true);
    expect(allows(body, '/private/x')).toBe(false);
    expect(allows(body, '/public', 'Googlebot')).toBe(false);
  });

  it('matches the product token case-insensitively and ignores a version suffix', () => {
    expect(allows('User-agent: QUERYREVBOT/2.0\nDisallow: /\n', '/x')).toBe(false);
  });

  it('merges every group that names the token, and groups with several user-agent lines', () => {
    const body = [
      'User-agent: QueryRevBot',
      'Disallow: /a',
      '',
      'User-agent: Other',
      'User-agent: QueryRevBot',
      'Disallow: /b',
    ].join('\n');
    expect(allows(body, '/a')).toBe(false);
    expect(allows(body, '/b')).toBe(false);
    expect(allows(body, '/c')).toBe(true);
    expect(allows(body, '/b', 'Other')).toBe(false);
  });

  it('starts a new group at a user-agent line that follows rules', () => {
    const body = 'User-agent: a\nDisallow: /x\nUser-agent: b\nDisallow: /y\n';
    expect(allows(body, '/x', 'a')).toBe(false);
    expect(allows(body, '/y', 'a')).toBe(true);
    expect(allows(body, '/x', 'b')).toBe(true);
  });

  it('lets the longest match win and allow win a tie', () => {
    const body =
      'User-agent: *\nDisallow: /folder\nAllow: /folder/page\nDisallow: /folder/page.html\n';
    expect(allows(body, '/folder/x')).toBe(false);
    expect(allows(body, '/folder/page')).toBe(true);
    expect(allows(body, '/folder/page.html')).toBe(false);
    const tie = 'User-agent: *\nDisallow: /same\nAllow: /same\n';
    expect(allows(tie, '/same')).toBe(true);
  });

  it('supports * and the end anchor $', () => {
    const body = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /search*q=\nAllow: /$\nDisallow: /\n';
    expect(allows(body, '/')).toBe(true);
    expect(allows(body, '/doc.pdf')).toBe(false);
    expect(allows(body, '/doc.pdf?x=1')).toBe(false); // Disallow: / still matches
    const pdf = 'User-agent: *\nDisallow: /*.pdf$\n';
    expect(allows(pdf, '/doc.pdf')).toBe(false);
    expect(allows(pdf, '/doc.pdf?x=1')).toBe(true);
    expect(allows(pdf, '/a.pdf/b')).toBe(true);
    const search = 'User-agent: *\nDisallow: /search*q=\n';
    expect(allows(search, '/search?lang=en&q=bed')).toBe(false);
    expect(allows(search, '/search?lang=en')).toBe(true);
  });

  it('matches the path and query, case-sensitively', () => {
    const body = 'User-agent: *\nDisallow: /Private\nDisallow: /*?sessionid\n';
    expect(allows(body, '/Private')).toBe(false);
    expect(allows(body, '/private')).toBe(true);
    expect(allows(body, '/page?sessionid=1')).toBe(false);
  });

  it('compares percent-encoded and raw forms alike (RFC 9309 2.2.2)', () => {
    const body = 'User-agent: *\nDisallow: /foo/bar/ツ\nDisallow: /%7Ejoe\nDisallow: /a%2fb\n';
    expect(allows(body, '/foo/bar/%E3%83%84')).toBe(false);
    expect(allows(body, '/foo/bar/%e3%83%84')).toBe(false);
    expect(allows(body, '/~joe/x')).toBe(false);
    expect(allows(body, '/a%2Fb')).toBe(false);
    expect(allows(body, '/a/b')).toBe(true); // an encoded slash is not a slash
  });

  it('ignores an empty Disallow, comments, unknown lines, a BOM and odd line endings', () => {
    const body = '﻿User-agent: * # everyone\r\nDisallow:\rFoo: bar\nAllow /x\nDisallow: /y # no\n';
    expect(allows(body, '/x')).toBe(true);
    expect(allows(body, '/y')).toBe(false);
  });

  it('always allows /robots.txt', () => {
    expect(allows('User-agent: *\nDisallow: /\n', '/robots.txt')).toBe(true);
  });

  it('reads Sitemap lines anywhere, resolved, without duplicates', () => {
    const robots = parseRobots(
      'Sitemap: https://site.test/a.xml\nUser-agent: *\nSitemap: /b.xml\nDisallow: /x\nSitemap: https://site.test/a.xml\n',
      'https://site.test/robots.txt',
    );
    expect(robots.sitemaps).toEqual(['https://site.test/a.xml', 'https://site.test/b.xml']);
    // A Sitemap line does not end the group.
    expect(isAllowedByRobots(robots, 'QueryRevBot', '/x')).toBe(false);
  });

  it('keeps a group whole across Sitemap, Crawl-delay and unknown lines between user-agents', () => {
    // Google ignores lines it does not know; only a rule ends a run of user-agent lines.
    const body = [
      'User-agent: GPTBot',
      'Content-Signal: search=yes, ai-train=no',
      'User-agent: CCBot',
      'Sitemap: https://site.test/sitemap.xml',
      'User-agent: Bytespider',
      'Crawl-delay: 10',
      'User-agent: QueryRevBot',
      'Host: site.test',
      'Disallow: /',
    ].join('\n');
    for (const agent of ['GPTBot', 'CCBot', 'Bytespider', 'QueryRevBot']) {
      expect(allows(body, '/page', agent), agent).toBe(false);
    }
    expect(allows(body, '/page', 'Googlebot')).toBe(true);
    const robots = parseRobots(body);
    expect(robots.groups).toHaveLength(1);
    expect(crawlDelayFor(robots, 'QueryRevBot')).toBe(10);
    // A rule still ends the run: the next user-agent line starts a new group.
    const two =
      'User-agent: a\nContent-Signal: ai-train=no\nDisallow: /x\nUser-agent: b\nDisallow: /y\n';
    expect(allows(two, '/x', 'b')).toBe(true);
    expect(allows(two, '/x', 'a')).toBe(false);
  });

  it('reads Crawl-delay of the applying group', () => {
    const robots = parseRobots(
      'User-agent: *\nCrawl-delay: 5\nDisallow: /a\n\nUser-agent: QueryRevBot\nCrawl-delay: 2\nDisallow: /b\n',
    );
    expect(crawlDelayFor(robots, 'QueryRevBot')).toBe(2);
    expect(crawlDelayFor(robots, 'Googlebot')).toBe(5);
    expect(crawlDelayFor(parseRobots(''), 'QueryRevBot')).toBeNull();
  });

  it('parses at most 500 KiB', () => {
    const filler = `# ${'x'.repeat(600 * 1024)}\n`;
    expect(allows(`User-agent: *\n${filler}Disallow: /late\n`, '/late')).toBe(true);
  });
});

describe('the deciding rule and its line', () => {
  const body = [
    '# comment',
    'User-agent: *',
    'Disallow: /private',
    '',
    'User-agent: GPTBot',
    'User-agent: CCBot',
    'Disallow: /',
    'Allow: /blog/',
  ].join('\n');
  const robots = parseRobots(body);

  it('keeps the line of every group and rule', () => {
    expect(robots.groups.map((group) => group.line)).toEqual([2, 5]);
    expect(robots.groups[1]!.rules.map((rule) => rule.line)).toEqual([7, 8]);
  });

  it('names the rule and the group that decide a path', () => {
    const root = matchRobots(robots, 'GPTBot', '/');
    expect(root).toMatchObject({ allowed: false, via: 'named', group: { line: 5 } });
    expect(root.rule).toMatchObject({ allow: false, pattern: '/', line: 7 });
    const blog = matchRobots(robots, 'ccbot', '/blog/post');
    expect(blog).toMatchObject({ allowed: true, via: 'named', rule: { line: 8 } });
  });

  it('falls back to the catch-all, and to no group at all', () => {
    expect(matchRobots(robots, 'PerplexityBot', '/private/a')).toMatchObject({
      allowed: false,
      via: 'catch_all',
      group: { line: 2, agents: ['*'] },
      rule: { line: 3 },
    });
    expect(matchRobots(robots, 'PerplexityBot', '/open')).toMatchObject({
      allowed: true,
      via: 'catch_all',
      rule: null,
    });
    expect(matchRobots(parseRobots(''), 'GPTBot', '/')).toEqual({
      allowed: true,
      via: 'none',
      group: null,
      rule: null,
    });
  });

  it('agrees with isAllowedByRobots, and always allows /robots.txt', () => {
    for (const path of ['/', '/blog/', '/private', '/x?y=1', '/robots.txt']) {
      expect(matchRobots(robots, 'GPTBot', path).allowed).toBe(
        isAllowedByRobots(robots, 'GPTBot', path),
      );
    }
    expect(matchRobots(robots, 'GPTBot', '/robots.txt').allowed).toBe(true);
  });
});
