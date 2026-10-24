import { describe, expect, it } from 'vitest';
import { parseRobots } from '../robots';
import {
  agentVerdict,
  AI_AGENTS,
  CRAWLER_PURPOSES,
  crawlerAccess,
  CRAWLERS,
  crawlersCoveredLine,
  STUDY_AGENTS,
  verdictsFor,
} from './index';

const verdict = (body: string, agent: string) => agentVerdict(parseRobots(body), agent);
const access = (body: string, agent: string) => verdict(body, agent).access;

describe('what a robots.txt says to one agent', () => {
  it('reads a missing or empty file as allowed', () => {
    expect(verdict('', 'GPTBot')).toMatchObject({ access: 'allowed', named: false });
    expect(access('# nothing but a comment\n', '*')).toBe('allowed');
  });

  it('blocks an agent named in a group that disallows the whole site', () => {
    const body = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
    expect(verdict(body, 'GPTBot')).toMatchObject({ access: 'blocked', named: true });
    // The others follow the catch-all.
    expect(verdict(body, 'CCBot')).toMatchObject({ access: 'allowed', named: false });
    expect(access(body, '*')).toBe('allowed');
  });

  it('applies the catch-all to an agent without a group of its own', () => {
    const body = 'User-agent: *\nDisallow: /\n';
    expect(verdict(body, 'PerplexityBot')).toMatchObject({ access: 'blocked', named: false });
    expect(access(body, '*')).toBe('blocked');
  });

  it('lets an agent’s own group override the catch-all entirely', () => {
    const body = 'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n';
    expect(verdict(body, 'OAI-SearchBot')).toMatchObject({ access: 'allowed', named: true });
    expect(access(body, 'GPTBot')).toBe('blocked');
  });

  it('matches the product token without regard to case', () => {
    expect(access('user-agent: gptbot\ndisallow: /\n', 'GPTBot')).toBe('blocked');
    expect(access('USER-AGENT: Meta-ExternalAgent\nDISALLOW: /\n', 'Meta-ExternalAgent')).toBe(
      'blocked',
    );
  });

  it('merges groups that share a line of agents, and groups that name the agent twice', () => {
    const body = [
      'User-agent: GPTBot',
      'User-agent: CCBot',
      'Disallow: /',
      '',
      'User-agent: Bytespider',
      'Disallow: /private/',
      '',
      'User-agent: Bytespider',
      'Disallow: /',
    ].join('\n');
    expect(access(body, 'GPTBot')).toBe('blocked');
    expect(access(body, 'CCBot')).toBe('blocked');
    expect(access(body, 'Bytespider')).toBe('blocked');
  });

  it('ignores comments and the parts of a line after them', () => {
    const body = 'User-agent: GPTBot # OpenAI\nDisallow: / # all of it\n# Disallow: /\n';
    expect(access(body, 'GPTBot')).toBe('blocked');
    expect(access('User-agent: GPTBot\n# Disallow: /\n', 'GPTBot')).toBe('allowed');
  });

  it('gives Allow the win over Disallow at equal length, and the longer rule the win otherwise', () => {
    // RFC 9309 2.2.2: the most specific (longest) match wins; Allow wins a tie.
    expect(access('User-agent: GPTBot\nDisallow: /\nAllow: /\n', 'GPTBot')).toBe('allowed');
    // `Disallow: /*` is longer than `Allow: /` at every path: the site is closed.
    expect(access('User-agent: CCBot\nAllow: /\nDisallow: /*\n', 'CCBot')).toBe('blocked');
    // An Allow for some paths opens part of a closed site.
    expect(access('User-agent: GPTBot\nDisallow: /\nAllow: /blog/\n', 'GPTBot')).toBe('partial');
    // Only the home page open.
    expect(access('User-agent: *\nDisallow: /\nAllow: /$\n', 'Amazonbot')).toBe('partial');
  });

  it('reads a rule that matches / but is narrower than the whole site as partial', () => {
    // Disallow: /$ closes the home page only.
    expect(verdict('User-agent: GPTBot\nDisallow: /$\n', 'GPTBot')).toMatchObject({
      access: 'partial',
      named: true,
    });
    expect(access('User-agent: *\nDisallow: /$\n', '*')).toBe('partial');
    expect(access('User-agent: *\nDisallow: /$\n', 'CCBot')).toBe('partial');
    // With a rule for the whole site beside it, the site is closed.
    expect(access('User-agent: GPTBot\nDisallow: /$\nDisallow: /\n', 'GPTBot')).toBe('blocked');
  });

  it('reads wildcard patterns as covering the whole site', () => {
    expect(access('User-agent: GPTBot\nDisallow: /*\n', 'GPTBot')).toBe('blocked');
    expect(access('User-agent: GPTBot\nDisallow: *\n', 'GPTBot')).toBe('blocked');
    // A wildcard narrower than the whole site closes part of it.
    expect(access('User-agent: GPTBot\nDisallow: /*.pdf$\n', 'GPTBot')).toBe('partial');
  });

  it('counts a named group that closes some paths as partial, and inherited housekeeping as allowed', () => {
    const body = 'User-agent: *\nDisallow: /admin/\n\nUser-agent: GPTBot\nDisallow: /news/\n';
    expect(verdict(body, 'GPTBot')).toMatchObject({ access: 'partial', named: true });
    expect(verdict(body, 'CCBot')).toMatchObject({ access: 'allowed', named: false });
    // The catch-all's own housekeeping is not a block of anyone.
    expect(access(body, '*')).toBe('allowed');
  });

  it('does not count housekeeping repeated in a named group as a block', () => {
    // A named group replaces the catch-all, so sites repeat its paths there.
    const body = [
      'User-agent: *',
      'Disallow: /search',
      'Disallow: /cart',
      '',
      'User-agent: GPTBot',
      'Disallow: /search',
      '',
      'User-agent: CCBot',
      'Disallow: /search',
      'Disallow: /articles/',
    ].join('\n');
    expect(verdict(body, 'GPTBot')).toMatchObject({ access: 'allowed', named: true });
    expect(verdict(body, 'CCBot')).toMatchObject({ access: 'partial', named: true });
  });

  it('reads an empty Disallow as no rule', () => {
    expect(verdict('User-agent: GPTBot\nDisallow:\n', 'GPTBot')).toMatchObject({
      access: 'allowed',
      named: true,
    });
  });

  it('does not take a longer token for the agent (Googlebot is not Google-Extended)', () => {
    const body = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: Applebot\nDisallow: /\n';
    expect(verdict(body, 'Google-Extended')).toMatchObject({ access: 'allowed', named: false });
    expect(verdict(body, 'Applebot-Extended')).toMatchObject({ access: 'allowed', named: false });
  });

  it('never counts the catch-all as named', () => {
    expect(verdict('User-agent: *\nDisallow: /\n', '*')).toMatchObject({
      access: 'blocked',
      named: false,
    });
  });

  it('gives a verdict for every measured agent', () => {
    expect(Object.keys(verdictsFor(parseRobots('')))).toEqual([...STUDY_AGENTS]);
  });
});

describe('the crawlers covered', () => {
  it('lists the same tokens as the measured agents, in the same order', () => {
    expect(CRAWLERS.map((crawler) => crawler.token)).toEqual([...AI_AGENTS]);
    expect(CRAWLERS.every((crawler) => CRAWLER_PURPOSES.includes(crawler.purpose))).toBe(true);
  });
});

describe('the access of every covered crawler', () => {
  const robots = parseRobots(
    ['User-agent: *', 'Disallow: /cart', '', 'User-agent: GPTBot', 'Disallow: /'].join('\n'),
  );

  it('gives one entry per covered crawler, in order', () => {
    expect(crawlerAccess(robots).map((entry) => entry.crawler.token)).toEqual([...AI_AGENTS]);
  });

  it('gives the verdict and the rule that decides / and the path', () => {
    const entries = crawlerAccess(robots, { path: '/cart/1' });
    const gpt = entries.find((entry) => entry.crawler.token === 'GPTBot')!;
    expect(gpt).toMatchObject({ access: 'blocked', named: true, llmsTxt: false });
    expect(gpt.root).toMatchObject({ allowed: false, rule: { line: 5 } });
    const perplexity = entries.find((entry) => entry.crawler.token === 'PerplexityBot')!;
    expect(perplexity).toMatchObject({ access: 'allowed', named: false, llmsTxt: true });
    expect(perplexity.root.allowed).toBe(true);
    expect(perplexity.path).toMatchObject({ allowed: false, via: 'catch_all', rule: { line: 2 } });
  });

  it('leaves out the path when only / is asked about', () => {
    expect(crawlerAccess(robots, { path: '/' })[0]!.path).toBeNull();
  });

  it('says which crawlers are covered, and never claims all of them', () => {
    const line = crawlersCoveredLine();
    expect(line).toContain(`${CRAWLERS.length} AI crawlers`);
    for (const vendor of new Set(CRAWLERS.map((crawler) => crawler.vendor))) {
      expect(line).toContain(vendor);
    }
    expect(line).not.toMatch(/\ball\b/i);
  });
});
