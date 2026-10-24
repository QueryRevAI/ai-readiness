import { describe, expect, it } from 'vitest';
import { buildFindings, FINDING_IDS } from './findings';
import type { SiteCheck } from './types';

describe('the finding ids', () => {
  it('are pinned: an id is never renamed or reused', () => {
    expect(FINDING_IDS).toEqual([
      'site-refused',
      'robots-txt',
      'sitemap-in-robots',
      'reader-blocked',
      'ai-search-crawler-access',
      'ai-training-crawler-access',
      'home-page-read',
      'home-truncated',
      'noindex-home-page',
      'text-in-html',
      'app-shell',
      'little-text',
      'json-ld-on-home-page',
      'json-ld-errors',
      'json-ld-bounds',
      'organization-schema',
      'organization-microdata-only',
      'organization-name-and-url',
      'organization-logo',
      'organization-same-as',
      'website-schema',
      'faq-schema',
      'llms-txt-found',
      'llms-txt-structure',
      'sitemap-valid',
      'sitemap-cut',
    ]);
  });
});

describe('text from a site in a finding', () => {
  it('loses control and reordering characters', () => {
    const site = {
      schemaVersion: 1,
      origin: 'https://example.com',
      host: 'example.com',
      crawlersCovered: '',
      robots: {
        outcome: 'file',
        url: 'https://example.com/robots.txt',
        status: 200,
        bytes: 10,
        truncated: false,
        sitemaps: ['https://example.com/\u001b[31mred\u0007.xml‮'],
        allowsThisReader: true,
      },
      crawlerAccess: [],
      home: null,
      llms: {
        asked: true,
        present: true,
        verdict: 'llms_txt',
        bytes: 5,
        truncated: false,
        h1: 'Title\u001b]0;pwned\u0007',
        sections: 1,
        links: 1,
      },
      sitemap: { asked: false, source: null, url: null, status: null, facts: null },
    } satisfies Omit<SiteCheck, 'findings'>;
    const findings = buildFindings(site);
    const snippets = findings.map((finding) => finding.snippet ?? '').join('');
    expect(snippets).toContain('red.xml');
    expect(snippets).toContain('Title');
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮]/.test(snippets)).toBe(false);
  });
});
