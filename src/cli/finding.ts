import { stripUnsafeCharacters } from '../generate';
import type { Finding, FindingLevel } from '../facts/types';

const DOC_BASE = 'https://queryrev.com/research/ai-search-readiness#';

/** A finding of the command line's own checks (a robots.txt test); the evidence is cut short. */
export function cliFinding(
  id: string,
  level: FindingLevel,
  message: string,
  snippet?: string,
  anchor = 'readable-by-ai-search',
): Finding {
  const evidence = stripUnsafeCharacters(snippet ?? '').slice(0, 300);
  const docUrl = `${DOC_BASE}${anchor}`;
  return Object.freeze(
    evidence === ''
      ? { id, level, message: stripUnsafeCharacters(message), docUrl }
      : { id, level, message: stripUnsafeCharacters(message), docUrl, snippet: evidence },
  );
}
