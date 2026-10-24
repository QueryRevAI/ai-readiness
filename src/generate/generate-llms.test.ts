import { describe, expect, it } from 'vitest';
import { homeLinks } from './generate-llms';

describe('homeLinks', () => {
  it('resolves anchors against the page, drops fragments and non-web links, and keeps order', () => {
    const html = `
      <a href="/one">1</a><a class="x" href='two#part'>2</a><a href="https://other.example/x">3</a>
      <a href="mailto:me@site.example">4</a><a href="javascript:void(0)">5</a><a href="/one#again">6</a>
      <a>no href</a><abbr href="/not-a-link">x</abbr><a href="">empty</a>`;
    expect(homeLinks(html, 'https://site.example/')).toEqual([
      'https://site.example/one',
      'https://site.example/two',
      'https://other.example/x',
    ]);
  });

  it('stops at the maximum and ignores control characters in an address', () => {
    const many = Array.from({ length: 50 }, (_, index) => `<a href="/p${index}">x</a>`).join('');
    expect(homeLinks(many, 'https://site.example/', 10)).toHaveLength(10);
    const escape = String.fromCharCode(27);
    const [link] = homeLinks(`<a href="/a${escape}b">x</a>`, 'https://site.example/');
    expect(link).toBe('https://site.example/ab');
  });

  it('is linear on hostile input', () => {
    const hostile = `${'<a '.repeat(300_000)}${'<a href="/x"'.repeat(1)}`;
    const started = performance.now();
    homeLinks(hostile, 'https://site.example/');
    homeLinks('<a href="'.repeat(200_000), 'https://site.example/');
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
