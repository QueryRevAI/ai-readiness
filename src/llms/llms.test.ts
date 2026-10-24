import { describe, expect, it } from 'vitest';
import { llmsStructure, looksLikeHtml, looksLikeLlmsTxt, validateLlmsTxt } from './index';

describe('telling a file from a page', () => {
  it('reads HTML by its type or its first bytes', () => {
    expect(looksLikeHtml('text/html', 'User-agent: *')).toBe(true);
    expect(looksLikeHtml('text/plain', '\n  <!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml(null, '<html lang="en">')).toBe(true);
    expect(looksLikeHtml('text/plain', 'User-agent: *\nDisallow:')).toBe(false);
  });

  it('accepts an llms.txt only as a 200 text file that opens with an H1', () => {
    expect(looksLikeLlmsTxt(200, 'text/plain', '# Example\n\n> A site.')).toBe(true);
    expect(looksLikeLlmsTxt(200, 'text/markdown', '﻿\n\n# Example')).toBe(true);
    expect(looksLikeLlmsTxt(200, null, '# Example')).toBe(true);
    expect(looksLikeLlmsTxt(404, 'text/plain', '# Example')).toBe(false);
    expect(looksLikeLlmsTxt(200, 'text/html', '# Example')).toBe(false);
    expect(looksLikeLlmsTxt(200, 'application/json', '# Example')).toBe(false);
    expect(looksLikeLlmsTxt(200, 'text/plain', '<!doctype html><title>Home</title>')).toBe(false);
    expect(looksLikeLlmsTxt(200, 'text/plain', '## Not a title\n# Late')).toBe(false);
    expect(looksLikeLlmsTxt(200, 'text/plain', '#NoSpace')).toBe(false);
    expect(looksLikeLlmsTxt(200, 'text/plain', '')).toBe(false);
    // A robots.txt served at /llms.txt, even one that opens with a "# " comment.
    expect(looksLikeLlmsTxt(200, 'text/plain', '# robots.txt\nUser-agent: *\nDisallow:\n')).toBe(
      false,
    );
    // An llms.txt that quotes a user-agent line among its links is still one.
    expect(
      looksLikeLlmsTxt(200, 'text/plain', '# A\nUser-agent: QueryRevBot\n## Docs\n- [A](/a)\n'),
    ).toBe(true);
  });
});

describe('validating an answer at /llms.txt', () => {
  const file = [
    '# Example Site',
    '',
    '> What the site offers.',
    '',
    '```',
    '# not a heading',
    '```',
    '',
    '## Docs',
    '',
    '- [Start](https://site.test/start): how to begin',
    '- [API](https://site.test/api)',
  ].join('\n');
  const answer = (over: Partial<Parameters<typeof validateLlmsTxt>[0]>) =>
    validateLlmsTxt({
      status: 200,
      contentType: 'text/plain',
      body: file,
      truncated: false,
      ...over,
    });

  it('reads a well-formed file, its H1, and its structure', () => {
    const report = answer({});
    expect(report).toMatchObject({
      present: true,
      verdict: 'llms_txt',
      h1: 'Example Site',
      h1Count: 1,
    });
    expect(report.structure).toMatchObject({
      summary: true,
      sections: 1,
      links: 2,
      structured: true,
    });
    expect(report.bytes).toBe(Buffer.byteLength(file));
  });

  it('applies the soft-404 rule: a 200 that is a page, a robots.txt or lacks the H1 is no file', () => {
    expect(
      answer({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }).verdict,
    ).toBe('html');
    expect(answer({ body: 'User-agent: *\nDisallow: /' }).verdict).toBe('robots');
    expect(answer({ body: 'Just some text' }).verdict).toBe('no_h1');
    expect(answer({ contentType: 'application/json', body: '{}' }).verdict).toBe('not_text');
    for (const verdict of ['html', 'robots', 'no_h1'] as const) {
      expect(verdict).not.toBe('llms_txt');
    }
  });

  it('tells a missing file, another status and no answer apart', () => {
    expect(answer({ status: 404, body: 'nope' })).toMatchObject({
      present: false,
      verdict: 'not_found',
      structure: null,
    });
    expect(answer({ status: 500 }).verdict).toBe('status');
    expect(answer({ status: null, body: null })).toMatchObject({ verdict: 'no_answer', bytes: 0 });
  });

  it('counts more than one H1, and keeps the cut flag', () => {
    const report = answer({ body: `${file}\n# Second`, truncated: true });
    expect(report).toMatchObject({ h1Count: 2, truncated: true });
  });
});

describe('links on ordinary files', () => {
  it('counts the same links as before on ordinary files', () => {
    const body = [
      '# Site',
      '> s',
      '## A',
      '- [One](https://a.test/1): note',
      '- [Two](<https://a.test/2> "Title")',
      '- ![img](https://a.test/i.png) and [Three](',
      '  https://a.test/3 )',
      '- [no target]() [bad](a b)',
    ].join('\n');
    expect(llmsStructure(body).targets).toEqual([
      'https://a.test/1',
      'https://a.test/2',
      'https://a.test/3',
    ]);
  });
});
