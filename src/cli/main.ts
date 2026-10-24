import { flag, parseCommand, type ParsedCommand } from './args';
import { runCheck } from './commands/check';
import { runCrawlers } from './commands/crawlers';
import { runLlmsGenerate } from './commands/llms-generate';
import { runLlmsValidate } from './commands/llms-validate';
import { runRobotsTest } from './commands/robots-test';
import { makeStyle } from './render';
import { oneLine } from './sanitize';
import {
  EXIT_INTERNAL,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  type CliContext,
  type CommandResult,
  type ExitCode,
} from './types';
import { USAGE } from './usage';
import pkg from '../../package.json' with { type: 'json' };

export const CLI_VERSION: string = pkg.version;

async function dispatch(
  context: CliContext,
  parsed: ParsedCommand,
  style: ReturnType<typeof makeStyle>,
): Promise<CommandResult> {
  switch (parsed.command) {
    case 'check':
      return runCheck(context, parsed, style);
    case 'robots test':
      return runRobotsTest(context, parsed, style);
    case 'llms validate':
      return runLlmsValidate(context, parsed, style);
    case 'llms generate':
      return runLlmsGenerate(context, parsed, style);
    case 'crawlers':
      return runCrawlers(style);
  }
}

function errorDocument(code: 'usage' | 'internal', message: string, exit: ExitCode): string {
  return `${JSON.stringify({ schemaVersion: 1, exitCode: exit, error: { code, message } }, null, 2)}\n`;
}

/**
 * Runs the command line. Returns the exit code and sets no global state: output goes through the
 * context, so a test can run it with a fixture fetcher and read what it printed.
 */
export async function runCli(argv: readonly string[], context: CliContext): Promise<ExitCode> {
  const json = argv.includes('--json');
  try {
    if (argv.length === 0) {
      context.stderr.write(USAGE);
      return EXIT_USAGE;
    }
    if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
      context.stdout.write(USAGE);
      return EXIT_OK;
    }
    if (argv[0] === '--version' || argv[0] === '-v') {
      context.stdout.write(`${CLI_VERSION}\n`);
      return EXIT_OK;
    }
    const parsed = parseCommand(argv, context.offersPrivateNetwork !== false);
    if (flag(parsed, 'help')) {
      context.stdout.write(USAGE);
      return EXIT_OK;
    }
    const style = makeStyle({
      isTTY: context.stdout.isTTY === true && !flag(parsed, 'json'),
      env: context.env,
      noColorFlag: flag(parsed, 'no-color'),
    });
    const result = await dispatch(context, parsed, style);
    if (flag(parsed, 'json')) {
      context.stdout.write(`${JSON.stringify(result.json, null, 2)}\n`);
    } else {
      context.stdout.write(result.text);
      if (result.textErr !== undefined) context.stderr.write(result.textErr);
    }
    return result.exit;
  } catch (error) {
    if (error instanceof UsageError) {
      const message = oneLine(error.message);
      if (json) context.stdout.write(errorDocument('usage', message, EXIT_USAGE));
      else context.stderr.write(`ai-readiness: ${message}\nRun "ai-readiness --help" for usage.\n`);
      return EXIT_USAGE;
    }
    const message = `Internal error: ${error instanceof Error ? oneLine(error.name) : 'unknown'}.`;
    if (json) context.stdout.write(errorDocument('internal', message, EXIT_INTERNAL));
    else context.stderr.write(`ai-readiness: ${message}\n`);
    return EXIT_INTERNAL;
  }
}
