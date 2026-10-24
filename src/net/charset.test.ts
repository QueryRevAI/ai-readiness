import { describe, expect, it } from 'vitest';
import { decodeHtml, detectCharset } from './charset';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const page = (head: string, body: number[]) =>
  Uint8Array.from([
    ...ascii(`<html><head>${head}</head><body>`),
    ...body,
    ...ascii('</body></html>'),
  ]);

// "привет" in windows-1251, "日本語" in Shift_JIS, "中文" in GBK, "한글" in EUC-KR.
const CYRILLIC = [0xef, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2];
const SHIFT_JIS = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea];
const GBK = [0xd6, 0xd0, 0xce, 0xc4];
const EUC_KR = [0xc7, 0xd1, 0xb1, 0xdb];

describe('decodeHtml', () => {
  it.each([
    ['windows-1251', CYRILLIC, 'привет'],
    ['shift_jis', SHIFT_JIS, '日本語'],
    ['gbk', GBK, '中文'],
    ['euc-kr', EUC_KR, '한글'],
  ])('reads a %s page by its header', (label, body, expected) => {
    const read = decodeHtml(page('', body), `text/html; charset=${label.toUpperCase()}`);
    expect(read.text).toContain(expected);
    expect(read.charset).toBe(new TextDecoder(label).encoding);
  });

  it('reads a page by its meta charset when the header says nothing', () => {
    const read = decodeHtml(page('<meta charset="windows-1251">', CYRILLIC), 'text/html');
    expect(read.text).toContain('привет');
    const old = decodeHtml(
      page('<meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">', SHIFT_JIS),
      null,
    );
    expect(old.text).toContain('日本語');
  });

  it('lets the header win over a meta that disagrees', () => {
    const read = decodeHtml(
      page('<meta charset="utf-8">', CYRILLIC),
      'text/html; charset=windows-1251',
    );
    expect(read.text).toContain('привет');
    expect(read.charset).toBe('windows-1251');
  });

  it('lets a byte order mark win over both', () => {
    const utf8 = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      ...ascii('<p>'),
      ...new TextEncoder().encode('日本語'),
    ]);
    expect(decodeHtml(utf8, 'text/html; charset=shift_jis').text).toContain('日本語');
    const utf16 = Uint8Array.from([0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x00, 0xe9, 0x00]);
    expect(decodeHtml(utf16, 'text/html; charset=windows-1251')).toMatchObject({
      charset: 'utf-16le',
    });
    expect(decodeHtml(utf16, null).text).toContain('é');
  });

  it('reads as UTF-8 without a declaration, and when a label is not known', () => {
    const utf8 = new TextEncoder().encode('<p>naïve — 日本語</p>');
    expect(decodeHtml(utf8, null)).toEqual({ text: '<p>naïve — 日本語</p>', charset: 'utf-8' });
    expect(detectCharset(utf8, 'text/html; charset=not-a-charset')).toBe('utf-8');
    expect(detectCharset(page('<meta charset="nope-9">', []), null)).toBe('utf-8');
  });

  it('does not look for a meta past the first 2 KiB', () => {
    const late = page(`${' '.repeat(3000)}<meta charset="windows-1251">`, CYRILLIC);
    expect(detectCharset(late, null)).toBe('utf-8');
  });

  it('holds back a character split by a size cap', () => {
    const bytes = new TextEncoder().encode('日本語');
    expect(decodeHtml(bytes.subarray(0, 4), null, true).text).toBe('日');
  });
});
