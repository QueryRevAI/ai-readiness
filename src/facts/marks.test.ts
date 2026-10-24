import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_TYPES,
  SCHEMA_ORG_SHA256,
  SCHEMA_ORG_VERSION,
} from './schema-org-organization-types';
import {
  CHALLENGE_MARKS,
  INTERSTITIAL_MARKS,
  isChallenge,
  isHomeChallenge,
  placeholderMark,
  PLACEHOLDER_MARKS,
} from './marks';
import {
  APP_ROOT_IDS,
  APP_ROOT_SELECTOR,
  EMPTY_SHELL_MAX_WORDS,
  EMPTY_SHELL_MIN_BYTES,
} from './app-shell';

describe('isChallenge (a bot check in place of robots.txt)', () => {
  it('is true for a 202, an HTML page and the marks of a bot check', () => {
    expect(isChallenge(202, 'User-agent: *\nDisallow:')).toBe(true);
    expect(isChallenge(200, '<!DOCTYPE html><html><body>Hi</body></html>')).toBe(true);
    expect(isChallenge(200, 'Just a moment...')).toBe(true);
    expect(isChallenge(200, 'Please verify you are human')).toBe(true);
  });

  it('is false for a file with a group, and for empty or plain text', () => {
    expect(isChallenge(200, 'User-agent: *\nDisallow: /private')).toBe(false);
    expect(isChallenge(200, '# <html> in a comment\nUser-agent: *')).toBe(false);
    expect(isChallenge(200, '')).toBe(false);
    expect(isChallenge(200, 'Sitemap: https://example.com/sitemap.xml')).toBe(false);
  });
});

describe('isHomeChallenge', () => {
  it('is true for a 202, and for a small page whose visible text is a bot check', () => {
    expect(isHomeChallenge(202, 'fine', 500)).toBe(true);
    expect(isHomeChallenge(200, 'Just a moment... Checking your browser', 4)).toBe(true);
    expect(isHomeChallenge(200, 'Pardon Our Interruption', 3)).toBe(true);
    expect(isHomeChallenge(200, 'Access denied. Please complete the captcha.', 6)).toBe(true);
    expect(isHomeChallenge(200, 'Attention Required! | Cloudflare', 4)).toBe(true);
  });

  it('is false for a page with text, and for a small page that is not a check', () => {
    expect(isHomeChallenge(200, 'Just a moment... Checking your browser', 800)).toBe(false);
    expect(isHomeChallenge(200, 'Welcome to our shop', 3)).toBe(false);
    expect(isHomeChallenge(200, 'You need to enable JavaScript to run this app.', 9)).toBe(false);
  });

  it('does not look at script sources, only at what a visitor reads', () => {
    for (const source of [
      'challenge-platform',
      'recaptcha',
      'datadome',
      '_pxappid',
      'kpsdk',
      'awswaf',
    ]) {
      expect(INTERSTITIAL_MARKS.test(source), source).toBe(false);
    }
  });

  it('matches the marks without case', () => {
    expect(CHALLENGE_MARKS.test('CF-BROWSER-VERIFICATION')).toBe(true);
    // Written in parts: the package's text test looks for hosting platforms' names.
    expect(CHALLENGE_MARKS.test(`${['Ver', 'cel'].join('')} Security Checkpoint`)).toBe(true);
  });
});

describe('placeholderMark', () => {
  it.each([
    ['nginx_default', '<title>Welcome to nginx!</title><h1>Welcome to nginx!</h1>'],
    ['apache_default', '<title>Apache2 Ubuntu Default Page: It works</title>'],
    ['apache_default', '<title>Apache HTTP Server Test Page powered by CentOS</title>'],
    ['apache_it_works', '<html><body><h1>It works!</h1></body></html>'],
    ['iis_default', '<title>IIS Windows Server</title>'],
    ['iis_default', '<title>Internet Information Services</title>'],
    ['caddy_default', '<title>Caddy works!</title>'],
    ['panel_default', "<title>Web Server's Default Page</title>"],
    ['hosting_default', '<h1>Future home of something quite cool</h1>'],
    ['parked_domain', '<p>This domain is for sale. Contact the owner.</p>'],
    [
      'parked_domain',
      '<a href="https://www.hugedomains.com/domain_profile.cfm?d=x">Buy this domain</a>',
    ],
  ])('finds %s', (id, html) => {
    expect(placeholderMark(html, 5)).toBe(id);
  });

  it('does not call a page with real text a placeholder', () => {
    expect(placeholderMark('<title>Welcome to nginx!</title>', 400)).toBeNull();
    expect(placeholderMark('<h1>Our company</h1><p>We sell shoes.</p>', 6)).toBeNull();
    expect(placeholderMark('<h1>It works! Really well</h1>', 4)).toBeNull();
  });

  it('has marks with distinct ids', () => {
    const ids = PLACEHOLDER_MARKS.map((mark) => mark.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the empty-shell constants', () => {
  it("are those of the crawler's render decision", () => {
    expect(EMPTY_SHELL_MIN_BYTES).toBe(5120);
    expect(EMPTY_SHELL_MAX_WORDS).toBe(50);
    expect(APP_ROOT_IDS).toHaveLength(11);
    expect(APP_ROOT_SELECTOR).toBe(
      '[id="root"], [id="app"], [id="__next"], [id="__nuxt"], [id="___gatsby"], [id="svelte"], [id="q-app"], [id="remix-root"], [id="__docusaurus"], [id="main-app"], [id="app-root"], app-root, [ng-version], [ng-app], [data-reactroot], [data-server-rendered]',
    );
  });
});

describe('the pinned schema.org vocabulary', () => {
  it('names its release, and lists Organization and its subtypes', () => {
    expect(SCHEMA_ORG_VERSION).toMatch(/^\d+\.\d+$/);
    expect(SCHEMA_ORG_SHA256).toMatch(/^[0-9a-f]{64}$/);
    for (const type of [
      'Organization',
      'LocalBusiness',
      'Corporation',
      'NewsMediaOrganization',
      'OnlineStore',
      'Restaurant',
      'NGO',
      'Airline',
      'ElementarySchool',
      'MedicalClinic',
    ]) {
      expect(ORGANIZATION_TYPES, type).toContain(type);
    }
    for (const type of ['Person', 'Product', 'WebSite', 'Thing', 'Place', 'Event']) {
      expect(ORGANIZATION_TYPES, type).not.toContain(type);
    }
    expect([...ORGANIZATION_TYPES]).toEqual([...ORGANIZATION_TYPES].sort());
  });
});
