import { describe, expect, it } from 'vitest';
import type { TextFetchResult } from '../net/fetch-text';
import { readHomeResponse } from './home-response';

const words = (count: number): string => 'word '.repeat(count);

function answer(overrides: Partial<TextFetchResult> = {}): TextFetchResult {
  return Object.freeze({
    outcome: 'response',
    refusal: null,
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://www.example.com/',
    finalHost: 'www.example.com',
    redirects: [],
    status: 200,
    contentType: 'text/html',
    headers: {},
    text: `<html><body><main>${words(200)}</main></body></html>`,
    rawBody: null,
    bytes: 100,
    limitBytes: 2 * 1024 * 1024,
    truncated: false,
    decodeFailed: false,
    requests: 1,
    elapsedMs: 5,
    ...overrides,
  });
}

describe('readHomeResponse', () => {
  it('reads a 200 HTML page', () => {
    const read = readHomeResponse(answer());
    expect(read).toMatchObject({
      outcome: 'read',
      status: 200,
      finalUrl: 'https://www.example.com/',
      redirects: 0,
    });
    expect(read.facts?.mainWords).toBe(200);
  });

  it('passes the X-Robots-Tag header on', () => {
    const read = readHomeResponse(answer({ headers: { 'x-robots-tag': ['noindex'] } }));
    expect(read.facts?.noindex).toBe(true);
  });

  it('sniffs a page that has no content type, and takes XHTML', () => {
    expect(readHomeResponse(answer({ contentType: null })).outcome).toBe('read');
    expect(readHomeResponse(answer({ contentType: 'application/xhtml+xml' })).outcome).toBe('read');
    expect(readHomeResponse(answer({ contentType: null, text: '{"a":1}' })).outcome).toBe(
      'not_html',
    );
  });

  it.each([
    [{ status: 401 }, 'forbidden'],
    [{ status: 403 }, 'forbidden'],
    [{ status: 202 }, 'challenge'],
    [{ status: 404 }, 'error_status'],
    [{ status: 500 }, 'error_status'],
    [{ status: 204 }, 'error_status'],
    [{ status: 301 }, 'error_status'],
    [{ contentType: 'application/json' }, 'not_html'],
    [{ contentType: 'application/pdf' }, 'not_html'],
    [{ text: null }, 'not_html'],
    [{ outcome: 'redirect_refused' as const, status: 301 }, 'off_site'],
    [{ outcome: 'too_many_redirects' as const }, 'redirect_error'],
    [{ outcome: 'redirect_loop' as const }, 'redirect_error'],
    [{ outcome: 'invalid_redirect' as const }, 'redirect_error'],
    [{ outcome: 'timeout' as const, status: null }, 'network'],
    [{ outcome: 'dns_failed' as const, status: null }, 'network'],
    [{ outcome: 'refused_address' as const, status: null }, 'network'],
    [{ outcome: 'host_stopped' as const, status: null }, 'network'],
  ] as const)('maps %j to %s', (overrides, outcome) => {
    const read = readHomeResponse(answer(overrides));
    expect(read.outcome).toBe(outcome);
    expect(read.facts).toBeNull();
  });

  it('calls a small page with the marks of a bot check a challenge', () => {
    const text =
      '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing</body></html>';
    expect(readHomeResponse(answer({ text })).outcome).toBe('challenge');
  });

  it('reads an empty app shell that loads a captcha or a bot-check script', () => {
    const scripts = [
      '<script src="https://www.google.com/recaptcha/api.js"></script>',
      '<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script>',
      '<script src="https://js.datadome.co/tags.js"></script>',
      '<script>window.awswaf=1;window.kpsdk=1;var _pxAppId="x"</script>',
    ].join('');
    const text = `<html><head><title>Shop</title>${scripts}</head><body><div id="root"></div></body></html>`;
    const read = readHomeResponse(answer({ text }));
    expect(read.outcome).toBe('read');
    expect(read.facts?.botCheck).toBe(false);
  });

  it('calls a real interstitial a challenge, with its scripts or without', () => {
    const text =
      '<html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x.js"></script></head><body><h1>Verify you are human</h1></body></html>';
    expect(readHomeResponse(answer({ text })).outcome).toBe('challenge');
  });

  it('calls a default server page a placeholder', () => {
    const text =
      '<html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1></body></html>';
    expect(readHomeResponse(answer({ text })).outcome).toBe('placeholder');
  });

  it('keeps the flag for a body cut at the cap', () => {
    expect(readHomeResponse(answer({ truncated: true }))).toMatchObject({
      outcome: 'read',
      truncated: true,
    });
  });

  it('counts the redirects followed', () => {
    const hop = { url: 'https://example.com/', status: 301, location: 'https://www.example.com/' };
    expect(readHomeResponse(answer({ redirects: [hop, hop] })).redirects).toBe(2);
  });
});

describe('readHomeResponse and the page’s character set', () => {
  const body = (words: number[], count: number) => {
    const repeated = Array.from({ length: count }, () => [...words, 0x20]).flat();
    return Uint8Array.from([
      ...[...'<html><head></head><body><main>'].map((c) => c.charCodeAt(0)),
      ...repeated,
      ...[...'</main></body></html>'].map((c) => c.charCodeAt(0)),
    ]);
  };
  const raw = (bytes: Uint8Array, header: string) =>
    answer({
      rawBody: bytes,
      text: new TextDecoder('utf-8').decode(bytes),
      headers: { 'content-type': [header] },
    });

  it('counts the words of a windows-1251 page, which UTF-8 would not', () => {
    const bytes = body([0xef, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2], 200);
    expect(readHomeResponse(raw(bytes, 'text/html; charset=windows-1251')).facts?.mainWords).toBe(
      200,
    );
    expect(readHomeResponse(raw(bytes, 'text/html')).facts?.mainWords).not.toBe(200);
  });

  it('counts Shift_JIS and GBK pages by the segmenter on the right text', () => {
    const jp = readHomeResponse(
      raw(body([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea], 60), 'text/html; charset=Shift_JIS'),
    );
    const cn = readHomeResponse(raw(body([0xd6, 0xd0, 0xce, 0xc4], 60), 'text/html; charset=gbk'));
    expect(jp.facts?.mainWords).toBeGreaterThan(30);
    expect(cn.facts?.mainWords).toBeGreaterThan(30);
  });
});
