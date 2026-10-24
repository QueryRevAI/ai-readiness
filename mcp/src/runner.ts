import { crawlersCoveredLine, createTextFetcher, type TextFetcher } from '@queryrev/ai-readiness';
import { runCli, type CliContext, type FileRead } from '@queryrev/ai-readiness/run';
import { cleanDeep } from './clean';

/**
 * The name text input goes by when it is handed to the command runner as a file. It reads as a
 * sentence in the few messages that mention it ("the given text is an HTML page"), and the
 * `source` of a result is mapped to `{ kind: 'text' }` so the name never shows there.
 */
export const TEXT_INPUT_NAME = 'the given text';

export interface RunOptions {
  /** Text standing in for the one file the command may read. Nothing else can be read. */
  readonly text?: string;
  /** The fetcher of one run; the strict one by default. Tests pass a fixture fetcher. */
  readonly createFetcher?: () => TextFetcher;
  /** Ends the run's requests when it aborts (the client cancelled, or its timeout passed). */
  readonly signal?: AbortSignal;
  /** Called with the number of requests made so far, after each one. */
  readonly onRequest?: (count: number) => void;
}

export interface RunOutput {
  readonly exitCode: number;
  /** The `--json` document of the command line, as text. */
  readonly json: string;
  /** The run failed on its input or inside (exit codes 2 and 4). */
  readonly isError: boolean;
}

const enoent = (path: string): Error =>
  Object.assign(new Error(`ENOENT: ${path.slice(0, 80)}`), { code: 'ENOENT' });

/** The fetcher with the run's signal added to every request, and a count of requests. */
function instrument(fetcher: TextFetcher, options: RunOptions): TextFetcher {
  const { signal, onRequest } = options;
  let requests = 0;
  return {
    fetchText: async (url, fetchOptions) => {
      const merged =
        signal === undefined
          ? fetchOptions.signal
          : fetchOptions.signal === undefined
            ? signal
            : AbortSignal.any([fetchOptions.signal, signal]);
      const result = await fetcher.fetchText(url, {
        ...fetchOptions,
        ...(merged === undefined ? {} : { signal: merged }),
      });
      requests += 1;
      onRequest?.(requests);
      return result;
    },
    setCrawlDelay: (host, seconds) => {
      fetcher.setCrawlDelay(host, seconds);
    },
    isStopped: (host) => fetcher.isStopped(host),
    close: () => fetcher.close(),
  };
}

/**
 * Runs one command of the command line and returns its `--json` document. The surroundings are
 * the smallest the command can use: the only file is the text input, nothing can be written,
 * the environment is empty, the commands offer no private-network option, and the fetcher is
 * the strict one whatever the command asks for.
 */
export async function runCommand(
  argv: readonly string[],
  options: RunOptions = {},
): Promise<RunOutput> {
  const out: string[] = [];
  const makeFetcher = options.createFetcher ?? (() => createTextFetcher());
  const context: CliContext = {
    stdout: { write: (chunk) => out.push(chunk) },
    stderr: { write: () => undefined },
    env: {},
    offersPrivateNetwork: false,
    readFile: (path, maxBytes): Promise<FileRead> => {
      if (options.text === undefined || path !== TEXT_INPUT_NAME) {
        return Promise.reject(enoent(path));
      }
      const bytes = Buffer.from(options.text, 'utf8');
      return Promise.resolve({
        bytes: bytes.subarray(0, maxBytes),
        truncated: bytes.length > maxBytes,
      });
    },
    writeFile: () => Promise.reject(new Error('This server writes no file.')),
    createFetcher: ({ allowPrivateNetwork }) => {
      // The flag is unknown to the commands here, so nothing asks for it. If something ever
      // did, the run stops rather than loosen the guard.
      if (allowPrivateNetwork) throw new Error('The private network is not available here.');
      return instrument(makeFetcher(), options);
    },
  };
  const exitCode = await runCli([...argv, '--json'], context);
  const document = JSON.parse(out.join('')) as Record<string, unknown>;
  // Text is not a file: say so in the result.
  const source = document['source'] as { location?: unknown } | undefined;
  if (options.text !== undefined && source?.location === TEXT_INPUT_NAME) {
    document['source'] = { kind: 'text' };
  }
  // Every result says which crawlers it covers. The command line's document has the line at its
  // top for most commands, inside `site` for `check`, and not at all for a single crawler or an
  // error; here it is always at the top.
  const result = { ...document, crawlersCovered: crawlersCoveredLine() };
  return {
    exitCode,
    json: JSON.stringify(cleanDeep(result), null, 2),
    isError: exitCode === 2 || exitCode === 4,
  };
}
