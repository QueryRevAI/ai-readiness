/**
 * The command runner (`@queryrev/ai-readiness/run`): the same code the command line runs, with
 * the surroundings (streams, files, the fetcher) passed in. A program that offers the commands
 * to another program, such as an MCP server, runs them here and prints exactly what
 * `ai-readiness <command> --json` prints.
 *
 * It does not include the command line's real file system or its private-network fetcher: the
 * caller builds the context.
 */
export { runCli, CLI_VERSION } from './main';
export type { CliContext, ExitCode, FileRead, Writable } from './types';
