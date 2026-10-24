import { open, writeFile } from 'node:fs/promises';
import { env, stderr, stdout } from 'node:process';
import { createCliTextFetcher } from '../net/cli';
import type { CliContext, FileRead } from './types';

async function readFile(path: string, maxBytes: number): Promise<FileRead> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    return {
      bytes: buffer.subarray(0, Math.min(bytesRead, maxBytes)),
      truncated: bytesRead > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

/** The command line's real surroundings: this process's streams, environment and file system. */
export function nodeContext(): CliContext {
  return {
    stdout,
    stderr,
    env,
    readFile,
    writeFile: (path, text, overwrite) =>
      writeFile(path, text, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' }),
    createFetcher: ({ allowPrivateNetwork }) => createCliTextFetcher({ allowPrivateNetwork }),
  };
}
