import { describe, expect, it } from 'vitest';
import { countWords, MAX_SEGMENTED_CHARS, MAX_WORDS_COUNTED } from './words';

const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
function reference(text: string): number {
  let count = 0;
  for (const segment of segmenter.segment(text)) if (segment.isWordLike) count += 1;
  return count;
}

describe('countWords', () => {
  it('counts English words', () => {
    expect(countWords('The quick brown fox.')).toEqual({ words: 4, capped: false });
    expect(countWords('')).toEqual({ words: 0, capped: false });
    expect(countWords('  \n\t ')).toEqual({ words: 0, capped: false });
  });

  it('keeps an apostrophe and a decimal point inside a word, and splits at a hyphen', () => {
    expect(countWords("don't stop").words).toBe(2);
    expect(countWords('version 3.5 is out').words).toBe(4);
    expect(countWords('a co-op e-mail').words).toBe(5);
  });

  it('counts Chinese and Japanese text by word, not as one word', () => {
    expect(countWords('你好世界今天天气很好').words).toBeGreaterThan(3);
    expect(countWords('今日は天気がいいですね').words).toBeGreaterThan(3);
    expect(countWords('我们一起去公园玩吧。今天天气很好，适合散步。').words).toBeGreaterThan(5);
  });

  it('counts words with accents and in other scripts', () => {
    expect(countWords('Café déjà vu').words).toBe(3);
    expect(countWords('Xin chào các bạn').words).toBe(4);
    expect(countWords('Привет мир').words).toBe(2);
  });

  it('stops counting at the limit', () => {
    const text = 'word '.repeat(MAX_WORDS_COUNTED + 50);
    expect(countWords(text)).toEqual({ words: MAX_WORDS_COUNTED, capped: true });
    expect(countWords('a b c d e', 3)).toEqual({ words: 3, capped: true });
    expect(countWords('é '.repeat(500), 10)).toEqual({ words: 10, capped: true });
  });

  it('reads only the first part of very long text that is not plain ASCII', () => {
    const text = '_ '.repeat(MAX_SEGMENTED_CHARS);
    expect(countWords(text)).toEqual({ words: 0, capped: true });
    expect(countWords(`é ${'x '.repeat(10)}`)).toEqual({ words: 11, capped: false });
  });

  it('gives the same count as the word-break rules for plain ASCII text', () => {
    // The fast path is a regular expression; this is the check that it follows the rules.
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const alphabet = 'abAZ19 .\':,;-/\n\t"<>()&!$%@#*+=?[]{}|\\^~`';
    for (let run = 0; run < 20_000; run += 1) {
      const length = 1 + Math.floor(random() * 24);
      let text = '';
      for (let index = 0; index < length; index += 1) {
        text += alphabet[Math.floor(random() * alphabet.length)];
      }
      expect(countWords(text).words, JSON.stringify(text)).toBe(reference(text));
    }
  });

  it('uses the word-break rules for text with an underscore', () => {
    for (const text of ['_', '__', 'a_b', 'foo_bar baz', '__init__ file']) {
      expect(countWords(text).words, text).toBe(reference(text));
    }
  });
});
