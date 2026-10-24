import { stripUnsafeCharacters } from '../generate';

/**
 * Text that came from a site (a title, a heading, a line of its robots.txt) can carry terminal
 * escape sequences and characters that reorder how text is shown. Every string of a result goes
 * through here before it is printed or written as JSON.
 */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return stripUnsafeCharacters(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => sanitizeDeep(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeDeep(item),
      ]),
    ) as T;
  }
  return value;
}

/** One line: whitespace runs, line breaks included, become one space. */
export function oneLine(text: string): string {
  return stripUnsafeCharacters(text).replace(/\s+/g, ' ').trim();
}
