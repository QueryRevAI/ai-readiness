import { crawlersCoveredLine, CRAWLERS } from '../crawlers';
import type { Finding, FindingLevel } from '../facts/types';
import { oneLine } from './sanitize';

/** The "full report" link every human report ends with. It is printed, never opened. */
export function fullReportUrl(command: string): string {
  return `https://queryrev.com/tools?utm_source=ai-readiness-cli&utm_medium=cli&utm_campaign=full-report&utm_content=${command}`;
}

/** What this tool cannot see, said once in the same words wherever it matters. */
export const CANNOT_SEE =
  'Not seen: a CDN or firewall rule can answer AI crawlers differently from how it answers this tool.';

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  level(level: FindingLevel, text: string): string;
}

const CODES: Record<FindingLevel, string> = {
  pass: '32',
  warn: '33',
  fail: '31',
  info: '36',
};

/** Colour only on a terminal, and never when NO_COLOR is set or `--no-color` is given. */
export function makeStyle(options: {
  readonly isTTY: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly noColorFlag: boolean;
}): Style {
  const noColor = options.env['NO_COLOR'] !== undefined && options.env['NO_COLOR'] !== '';
  const on = options.isTTY && !noColor && !options.noColorFlag && options.env['TERM'] !== 'dumb';
  const wrap = (code: string, text: string): string =>
    on ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    bold: (text) => wrap('1', text),
    dim: (text) => wrap('2', text),
    level: (level, text) => wrap(CODES[level], text),
  };
}

const LABEL: Record<FindingLevel, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  info: 'INFO',
};

export function summarize(findings: readonly Finding[]): Record<FindingLevel, number> {
  const counts: Record<FindingLevel, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const finding of findings) counts[finding.level] += 1;
  return counts;
}

/** The findings as lines: a label, the id, the sentence, and the evidence under it. */
export function renderFindings(findings: readonly Finding[], style: Style): string {
  const idWidth = Math.min(30, Math.max(0, ...findings.map((finding) => finding.id.length)));
  const lines: string[] = [];
  for (const finding of findings) {
    lines.push(
      `  ${style.level(finding.level, LABEL[finding.level])}  ${finding.id.padEnd(idWidth)}  ${oneLine(finding.message)}`,
    );
    if (finding.snippet !== undefined) {
      for (const line of finding.snippet.split(/\r\n|\r|\n/)) {
        if (line.trim() === '') continue;
        lines.push(`        ${style.dim('|')} ${style.dim(line.trim())}`);
      }
    }
  }
  return lines.join('\n');
}

export function renderSummary(findings: readonly Finding[]): string {
  const counts = summarize(findings);
  return `${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.info} info`;
}

/** The covered crawlers as a table: token, vendor, purpose. */
export function renderCrawlerList(style: Style): string {
  const width = Math.max(...CRAWLERS.map((crawler) => crawler.token.length));
  const vendorWidth = Math.max(...CRAWLERS.map((crawler) => crawler.vendor.length));
  return [
    `  ${style.bold('Crawler'.padEnd(width))}  ${style.bold('Vendor'.padEnd(vendorWidth))}  ${style.bold('Purpose')}`,
    ...CRAWLERS.map(
      (crawler) =>
        `  ${crawler.token.padEnd(width)}  ${crawler.vendor.padEnd(vendorWidth)}  ${crawler.purpose}`,
    ),
  ].join('\n');
}

export { crawlersCoveredLine };

/** A table with a header row; cells are padded to the widest entry of their column. */
export function renderTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  style: Style,
): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[], bold: boolean): string =>
    `  ${cells
      .map((cell, column) => {
        const padded = column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0);
        return bold ? style.bold(padded) : padded;
      })
      .join('  ')}`;
  return [line(header, true), ...rows.map((row) => line(row, false))].join('\n');
}
