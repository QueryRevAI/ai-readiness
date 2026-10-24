import type { TextFetcher } from '../net/fetch-text';

/**
 * Exit codes, the contract of the command line:
 *
 * - 0: nothing at or above `--fail-on` (`fail` unless asked otherwise)
 * - 1: the checks failed
 * - 2: usage error (a wrong command, option or input file)
 * - 3: the site could not be read (refused, unreachable, timed out, or robots.txt unreadable)
 * - 4: internal error
 */
export type ExitCode = 0 | 1 | 2 | 3 | 4;

export const EXIT_OK = 0;
export const EXIT_CHECKS_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_UNREADABLE = 3;
export const EXIT_INTERNAL = 4;

export interface Writable {
  write(chunk: string): unknown;
  readonly isTTY?: boolean;
}

export interface FileRead {
  readonly bytes: Uint8Array;
  /** The file was longer than the limit and was cut there. */
  readonly truncated: boolean;
}

/** Everything the command line touches outside its own code, so a test can replace it. */
export interface CliContext {
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Reads at most `maxBytes` of a file; throws an error with a `code` (`ENOENT`) when it cannot. */
  readonly readFile: (path: string, maxBytes: number) => Promise<FileRead>;
  /** Writes a file; without `overwrite` it fails when the file exists. */
  readonly writeFile: (path: string, text: string, overwrite: boolean) => Promise<void>;
  /**
   * Whether the commands offer `--allow-private-network` (default true). A program that embeds
   * the commands and has no such option sets this to false: the flag is then an unknown option
   * and no message mentions it.
   */
  readonly offersPrivateNetwork?: boolean;
  /** One fetcher per run; the command line closes it. */
  readonly createFetcher: (options: { allowPrivateNetwork: boolean }) => TextFetcher;
}

/** What a command returns; `runCli` prints it. */
export interface CommandResult {
  readonly exit: ExitCode;
  /** The `--json` document. */
  readonly json: unknown;
  /** The human report, for standard output. */
  readonly text: string;
  /** Notes for standard error in the human mode (a generated file goes to standard output). */
  readonly textErr?: string;
}

/** A wrong command, option or input: exit code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}
