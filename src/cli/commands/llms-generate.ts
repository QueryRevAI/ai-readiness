import { crawlersCoveredLine } from '../../crawlers';
import {
  generateLlmsTxt,
  GENERATE_DEFAULT_PAGES,
  GENERATE_MAX_PAGES,
  type GeneratedLlms,
  type SkippedReason,
} from '../../generate/generate-llms';
import { flag, text as option, type ParsedCommand } from '../args';
import { fullReportUrl, type Style } from '../render';
import { oneLine, sanitizeDeep } from '../sanitize';
import {
  EXIT_OK,
  EXIT_UNREADABLE,
  UsageError,
  type CliContext,
  type CommandResult,
  type ExitCode,
} from '../types';

function pagesOption(value: string | undefined): number {
  if (value === undefined) return GENERATE_DEFAULT_PAGES;
  if (!/^\d{1,4}$/.test(value)) {
    throw new UsageError(`--max-pages takes a whole number from 1 to ${GENERATE_MAX_PAGES}.`);
  }
  const count = Number(value);
  if (count < 1 || count > GENERATE_MAX_PAGES) {
    throw new UsageError(`--max-pages takes a whole number from 1 to ${GENERATE_MAX_PAGES}.`);
  }
  return count;
}

const SOURCE_TEXT: Record<GeneratedLlms['source'], string> = {
  sitemap: 'the sitemap',
  home_links: 'the links on the home page',
  none: 'no source',
};

const SKIPPED_TEXT: Record<SkippedReason, string> = {
  robots: 'closed to this reader by robots.txt',
  noindex: 'marked noindex',
  not_html: 'not an HTML page',
  status: 'not a 200 answer',
  off_site: 'redirected to another site',
  unreachable: 'no answer',
  duplicate: 'the same page as one listed',
};

function skippedSummary(result: GeneratedLlms): string[] {
  const counts = new Map<SkippedReason, number>();
  for (const entry of result.skipped) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => `${count} ${SKIPPED_TEXT[reason]}`);
}

export async function runLlmsGenerate(
  context: CliContext,
  parsed: ParsedCommand,
  style: Style,
): Promise<CommandResult> {
  const maxPages = pagesOption(option(parsed, 'max-pages'));
  const out = option(parsed, 'out');
  const force = flag(parsed, 'force');
  if (out !== undefined) {
    if (out === '') throw new UsageError('--out needs a file name.');
    if (!force) {
      let exists = true;
      try {
        await context.readFile(out, 1);
      } catch (error) {
        exists = (error as NodeJS.ErrnoException).code !== 'ENOENT';
      }
      if (exists) {
        throw new UsageError(
          `${out.slice(0, 200)} already exists (or cannot be checked). Use --force to replace it.`,
        );
      }
    }
  }

  const fetcher = context.createFetcher({
    allowPrivateNetwork: flag(parsed, 'allow-private-network'),
  });
  let raw: GeneratedLlms;
  try {
    raw = await generateLlmsTxt(parsed.positionals[0]!, { maxPages, fetcher });
  } finally {
    await fetcher.close();
  }
  const result = sanitizeDeep(raw);
  const exit: ExitCode = result.outcome === 'generated' ? EXIT_OK : EXIT_UNREADABLE;

  if (result.text !== null && out !== undefined) await context.writeFile(out, result.text, force);

  const summary: string[] = [];
  if (result.outcome === 'generated') {
    const skipped = skippedSummary(result);
    summary.push(
      style.bold(
        `Generated an llms.txt for ${result.origin}: ${result.pages.length} page${result.pages.length === 1 ? '' : 's'} from ${SOURCE_TEXT[result.source]}.`,
      ),
    );
    if (skipped.length > 0) summary.push(`Left out: ${skipped.join(', ')}.`);
    if (out !== undefined) summary.push(`Wrote ${out}.`);
  } else {
    summary.push(
      style.bold(
        `No llms.txt was generated for ${result.origin === '' ? parsed.positionals[0]! : result.origin}.`,
      ),
    );
  }
  for (const note of result.notes) summary.push(oneLine(note));
  if (result.outcome === 'generated') {
    summary.push(
      "Titles and descriptions are the pages' own words. Read the file and edit it before you publish it.",
    );
  } else {
    summary.push('Exit code 3.');
    if (
      result.outcome === 'robots_unreadable' &&
      context.offersPrivateNetwork !== false &&
      !flag(parsed, 'allow-private-network')
    ) {
      summary.push('A staging site on a private network is reached with --allow-private-network.');
    }
  }
  summary.push('', crawlersCoveredLine(), '', `Full report: ${fullReportUrl('llms-generate')}`);

  const json = {
    schemaVersion: 1,
    command: 'llms-generate',
    exitCode: exit,
    crawlersCovered: crawlersCoveredLine(),
    ...(exit === EXIT_UNREADABLE
      ? { error: { code: 'unreadable', message: result.notes.join(' ') } }
      : {}),
    ...(out === undefined ? {} : { out }),
    result,
  };
  if (out !== undefined || result.text === null) {
    return { exit, json, text: `${summary.join('\n')}\n` };
  }
  return { exit, json, text: result.text, textErr: `${summary.join('\n')}\n` };
}
