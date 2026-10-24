import { FETCH_LIMITS, type TextFetchResult } from '../net/fetch-text';
import type { Finding } from '../facts/types';
import type { FailOn } from './args';
import { EXIT_CHECKS_FAILED, EXIT_OK, UsageError, type CliContext, type ExitCode } from './types';

/** 1 when a finding is at or above the threshold, else 0. */
export function exitForFindings(findings: readonly Finding[], failOn: FailOn): ExitCode {
  const failed = findings.some(
    (finding) => finding.level === 'fail' || (failOn === 'warn' && finding.level === 'warn'),
  );
  return failed ? EXIT_CHECKS_FAILED : EXIT_OK;
}

const OUTCOME_TEXT: Readonly<Record<string, string>> = {
  refused_url: 'the address is not one this tool will request',
  refused_address: 'the address resolves to a private or reserved network',
  dns_failed: 'the host name does not resolve',
  too_many_redirects: 'too many redirects',
  redirect_loop: 'a redirect loop',
  invalid_redirect: 'a redirect without a usable address',
  redirect_refused: 'a redirect to another site, which was not followed',
  timeout: 'the request timed out',
  budget_exceeded: 'the time limit of the run was reached',
  host_stopped: 'the host asked this tool to stop (429 or 503)',
  network_error: 'the connection failed',
};

/** Why a fetch gave no usable answer, in a few plain words. Empty for an answer. */
export function describeFetchFailure(result: TextFetchResult, offersPrivateNetwork = true): string {
  if (result.outcome === 'response') {
    return result.status === null ? 'no answer' : `status ${result.status}`;
  }
  const text = OUTCOME_TEXT[result.outcome] ?? 'no answer';
  return result.outcome === 'refused_address' && offersPrivateNetwork
    ? `${text} (use --allow-private-network for a staging site)`
    : text;
}

export interface Source {
  readonly kind: 'file' | 'url';
  /** The path, or the address. */
  readonly location: string;
}

/** A name that ends like a file is a file, even where the ending is also a country's domain. */
const FILE_NAME = /\.(?:txt|md|markdown)$/i;
const HOST_LIKE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:[/?#].*)?$/i;

/**
 * Tells a file from a site: an http(s) address is a site, a name that is an existing file is a
 * file, and a bare host name (`example.com`) is a site.
 */
export async function classifySource(
  context: CliContext,
  input: string,
  maxBytes: number,
): Promise<{ source: Source; file: Awaited<ReturnType<CliContext['readFile']>> | null }> {
  if (/^https?:\/\//i.test(input)) return { source: { kind: 'url', location: input }, file: null };
  try {
    const file = await context.readFile(input, maxBytes);
    return { source: { kind: 'file', location: input }, file };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && HOST_LIKE.test(input) && !FILE_NAME.test(input)) {
      return { source: { kind: 'url', location: `https://${input}` }, file: null };
    }
    if (code === 'ENOENT') throw new UsageError(`No such file: ${input.slice(0, 200)}`);
    if (code === 'EISDIR') throw new UsageError(`${input.slice(0, 200)} is a directory.`);
    if (code === 'EACCES' || code === 'EPERM') {
      throw new UsageError(`Cannot read ${input.slice(0, 200)}: permission denied.`);
    }
    throw new UsageError(`Cannot read ${input.slice(0, 200)}.`);
  }
}

/** The address of a well-known file on a site: the given address, or `/name` at the site's root. */
export function fileAddress(input: string, name: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UsageError(`Not a web address: ${input.slice(0, 200)}`);
  }
  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = `/${name}`;
    url.search = '';
  }
  url.hash = '';
  return url.href;
}

export const ROBOTS_READ_LIMIT = FETCH_LIMITS.robots;
export const LLMS_READ_LIMIT = FETCH_LIMITS.llms;

/** The text of a file read from disk; a byte order mark is left for the parsers to handle. */
export function decodeFile(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
