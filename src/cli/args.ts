import { parseArgs } from 'node:util';
import { UsageError } from './types';

type OptionKind = 'boolean' | 'string';
interface OptionSpec {
  readonly type: OptionKind;
  readonly short?: string;
}

const COMMON: Readonly<Record<string, OptionSpec>> = {
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const FAIL_ON: Readonly<Record<string, OptionSpec>> = { 'fail-on': { type: 'string' } };
const PRIVATE: Readonly<Record<string, OptionSpec>> = {
  'allow-private-network': { type: 'boolean' },
};

export type CommandName = 'check' | 'robots test' | 'llms validate' | 'llms generate' | 'crawlers';

interface CommandSpec {
  readonly name: CommandName;
  readonly options: Readonly<Record<string, OptionSpec>>;
  readonly positionals: { readonly min: number; readonly max: number; readonly label: string };
}

export const COMMANDS: Readonly<Record<CommandName, CommandSpec>> = {
  check: {
    name: 'check',
    options: { ...COMMON, ...FAIL_ON, ...PRIVATE },
    positionals: { min: 1, max: 1, label: '<url>' },
  },
  'robots test': {
    name: 'robots test',
    options: {
      ...COMMON,
      ...FAIL_ON,
      ...PRIVATE,
      agent: { type: 'string' },
      path: { type: 'string' },
    },
    positionals: { min: 1, max: 1, label: '<file|url>' },
  },
  'llms validate': {
    name: 'llms validate',
    options: {
      ...COMMON,
      ...FAIL_ON,
      ...PRIVATE,
      links: { type: 'boolean' },
      base: { type: 'string' },
    },
    positionals: { min: 1, max: 1, label: '<file|url>' },
  },
  'llms generate': {
    name: 'llms generate',
    options: {
      ...COMMON,
      ...PRIVATE,
      'max-pages': { type: 'string' },
      out: { type: 'string' },
      force: { type: 'boolean' },
    },
    positionals: { min: 1, max: 1, label: '<url>' },
  },
  crawlers: {
    name: 'crawlers',
    options: { ...COMMON },
    positionals: { min: 0, max: 0, label: '' },
  },
};

export interface ParsedCommand {
  readonly command: CommandName;
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, string | boolean | undefined>>;
}

/** The command words at the start of the arguments, and how many of them there are. */
function commandOf(argv: readonly string[]): { name: CommandName; words: number } {
  const first = argv[0];
  if (first === undefined || first.startsWith('-')) {
    throw new UsageError(
      'Give a command: check, robots test, llms validate, llms generate or crawlers.',
    );
  }
  if (first === 'robots' || first === 'llms') {
    const second = argv[1];
    const name = `${first} ${second ?? ''}` as CommandName;
    if (second === undefined || !(name in COMMANDS)) {
      throw new UsageError(
        first === 'robots'
          ? '"robots" needs a subcommand: robots test <file|url>.'
          : '"llms" needs a subcommand: llms validate <file|url> or llms generate <url>.',
      );
    }
    return { name, words: 2 };
  }
  if (first in COMMANDS) return { name: first as CommandName, words: 1 };
  throw new UsageError(`Unknown command "${first.slice(0, 40)}".`);
}

export function parseCommand(argv: readonly string[], offersPrivateNetwork = true): ParsedCommand {
  const { name, words } = commandOf(argv);
  const spec = COMMANDS[name];
  const specOptions = offersPrivateNetwork
    ? spec.options
    : Object.fromEntries(Object.entries(spec.options).filter(([key]) => !(key in PRIVATE)));
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv.slice(words)],
      options: Object.fromEntries(
        Object.entries(specOptions).map(([key, option]) => [
          key,
          option.short === undefined
            ? { type: option.type }
            : { type: option.type, short: option.short },
        ]),
      ),
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : 'Invalid arguments.',
    );
  }
  const count = parsed.positionals.length;
  if (parsed.values['help'] === true) {
    return {
      command: name,
      positionals: parsed.positionals,
      values: parsed.values as ParsedCommand['values'],
    };
  }
  if (count < spec.positionals.min) {
    throw new UsageError(`"${name}" needs ${spec.positionals.label}.`);
  }
  if (count > spec.positionals.max) {
    throw new UsageError(
      `"${name}" takes ${spec.positionals.max === 0 ? 'no argument' : `only ${spec.positionals.label}`}.`,
    );
  }
  return {
    command: name,
    positionals: parsed.positionals,
    values: parsed.values as Readonly<Record<string, string | boolean | undefined>>,
  };
}

export type FailOn = 'fail' | 'warn';

export function failOnOf(parsed: ParsedCommand): FailOn {
  const value = parsed.values['fail-on'];
  if (value === undefined) return 'fail';
  if (value === 'fail' || value === 'warn') return value;
  throw new UsageError('--fail-on takes "fail" or "warn".');
}

export const flag = (parsed: ParsedCommand, name: string): boolean => parsed.values[name] === true;

export const text = (parsed: ParsedCommand, name: string): string | undefined => {
  const value = parsed.values[name];
  return typeof value === 'string' ? value : undefined;
};
