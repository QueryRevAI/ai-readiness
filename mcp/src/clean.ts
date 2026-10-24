import { stripUnsafeCharacters } from '@queryrev/ai-readiness';

// The checking code removes control and bidirectional characters. This server removes two more
// that it does not: the line and paragraph separators, which a client may show as line breaks.
const EXTRA = /[\u2028\u2029]/g;

/**
 * Text from a site made safe to hand to a program that reads it: what the checking code removes
 * (control and bidirectional characters), and the line and paragraph separators. Tab and line
 * breaks stay.
 */
export function cleanText(text: string): string {
  return stripUnsafeCharacters(text).replace(EXTRA, '');
}

/** Every string in a JSON value, keys included, through `cleanText`. */
export function cleanDeep<T>(value: T): T {
  if (typeof value === 'string') return cleanText(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => cleanDeep(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        cleanText(key),
        cleanDeep(item),
      ]),
    ) as T;
  }
  return value;
}
