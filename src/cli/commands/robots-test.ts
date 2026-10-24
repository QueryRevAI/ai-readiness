import { CRAWLERS, crawlerAccess, crawlersCoveredLine } from '../../crawlers';
import { robotsRead } from '../../facts/check-site';
import type { Finding, FindingLevel } from '../../facts/types';
import { looksLikeHtml } from '../../llms';
import { CHECK_BUDGET_MS } from '../../net/fetch-text';
import { matchRobots, parseRobots, type RobotsTxt, type RuleMatch } from '../../robots';
import { failOnOf, flag, text as option, type ParsedCommand } from '../args';
import {
  classifySource,
  decodeFile,
  describeFetchFailure,
  exitForFindings,
  fileAddress,
  ROBOTS_READ_LIMIT,
  type Source,
} from '../common';
import { cliFinding } from '../finding';
import { fullReportUrl, renderFindings, renderSummary, renderTable, type Style } from '../render';
import { oneLine, sanitizeDeep } from '../sanitize';
import {
  EXIT_UNREADABLE,
  UsageError,
  type CliContext,
  type CommandResult,
  type ExitCode,
} from '../types';

const AGENT_TOKEN = /^[A-Za-z0-9._*-]{1,64}$/;
const PATH_MAX = 2048;

/** Edit distance, for "did you mean" on a mistyped crawler token. Both strings are short. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = above;
    }
  }
  return row[b.length]!;
}

/** The covered crawler a typed token is probably meant to be, if it is not one. */
function suggestion(token: string): string | null {
  const lower = token.toLowerCase();
  if (CRAWLERS.some((crawler) => crawler.token.toLowerCase() === lower)) return null;
  let best: { token: string; score: number } | null = null;
  for (const crawler of CRAWLERS) {
    const score = distance(lower, crawler.token.toLowerCase());
    if (score <= 3 && (best === null || score < best.score)) best = { token: crawler.token, score };
  }
  return best?.token ?? null;
}

function describeMatch(match: RuleMatch): { sentence: string; evidence: string } {
  const group =
    match.via === 'none'
      ? 'no group applies'
      : match.via === 'named'
        ? `the group for this agent (line ${match.group?.line ?? 0})`
        : `the "*" group (line ${match.group?.line ?? 0})`;
  if (match.rule === null) {
    return {
      sentence:
        match.via === 'none'
          ? 'no group applies, so nothing is closed'
          : `${group}, and no rule matches`,
      evidence:
        match.group === null
          ? 'no group applies'
          : `${match.via === 'named' ? 'group for this agent' : '"*" group'} at line ${match.group.line}, no rule matches`,
    };
  }
  const rule = `${match.rule.allow ? 'Allow' : 'Disallow'}: ${match.rule.pattern}`;
  return {
    sentence: `${group}, decided by line ${match.rule.line} (${rule})`,
    evidence: `line ${match.rule.line}: ${rule}`,
  };
}

function flatMatch(match: RuleMatch): Record<string, unknown> {
  return {
    allowed: match.allowed,
    via: match.via,
    group:
      match.group === null ? null : { line: match.group.line, agents: [...match.group.agents] },
    rule:
      match.rule === null
        ? null
        : {
            type: match.rule.allow ? 'allow' : 'disallow',
            pattern: match.rule.pattern,
            line: match.rule.line,
          },
  };
}

interface Loaded {
  readonly robots: RobotsTxt;
  readonly source: Source;
  readonly notes: Finding[];
}

async function load(
  context: CliContext,
  parsed: ParsedCommand,
): Promise<Loaded | { unreadable: string; source: Source }> {
  const { source, file } = await classifySource(context, parsed.positionals[0]!, ROBOTS_READ_LIMIT);
  const notes: Finding[] = [];
  if (source.kind === 'file' && file !== null) {
    const body = decodeFile(file.bytes);
    if (looksLikeHtml(null, body)) {
      throw new UsageError(`${source.location.slice(0, 200)} is an HTML page, not a robots.txt.`);
    }
    if (file.truncated) {
      notes.push(
        cliFinding(
          'robots-file-cut',
          'info',
          'The file is larger than 500 KiB; it was read as far as that limit.',
        ),
      );
    }
    return { robots: parseRobots(body), source, notes };
  }
  const address = fileAddress(source.location, 'robots.txt');
  const fetcher = context.createFetcher({
    allowPrivateNetwork: flag(parsed, 'allow-private-network'),
  });
  try {
    const result = await fetcher.fetchText(address, {
      kind: 'robots',
      signal: AbortSignal.timeout(CHECK_BUDGET_MS),
    });
    const { read, robots } = robotsRead(result, address);
    if (robots === null) {
      return {
        unreadable: `${address}: ${describeFetchFailure(result, context.offersPrivateNetwork !== false)}`,
        source,
      };
    }
    if (read.outcome === 'missing') {
      notes.push(
        cliFinding(
          'robots-missing',
          'info',
          `There is no robots.txt at ${address} (status ${read.status ?? 0}), so nothing is closed.`,
        ),
      );
    }
    if (read.truncated) {
      notes.push(
        cliFinding(
          'robots-file-cut',
          'info',
          'The file is larger than 500 KiB; it was read as far as that limit.',
        ),
      );
    }
    return { robots, source: { kind: 'url', location: address }, notes };
  } finally {
    await fetcher.close();
  }
}

export async function runRobotsTest(
  context: CliContext,
  parsed: ParsedCommand,
  style: Style,
): Promise<CommandResult> {
  const failOn = failOnOf(parsed);
  const agent = option(parsed, 'agent');
  const path = option(parsed, 'path') ?? '/';
  if (agent !== undefined && !AGENT_TOKEN.test(agent)) {
    throw new UsageError(
      '--agent takes a crawler token such as OAI-SearchBot (letters, digits, . _ - *).',
    );
  }
  if (
    !path.startsWith('/') ||
    path.length > PATH_MAX ||
    [...path].some((char) => char <= ' ' || char === '\u007f')
  ) {
    throw new UsageError('--path must start with "/" and hold no spaces or control characters.');
  }

  const loaded = await load(context, parsed);
  if ('unreadable' in loaded) {
    const message = `robots.txt could not be read: ${loaded.unreadable}`;
    const exit: ExitCode = EXIT_UNREADABLE;
    return {
      exit,
      json: sanitizeDeep({
        schemaVersion: 1,
        command: 'robots-test',
        exitCode: exit,
        source: loaded.source,
        error: { code: 'unreadable', message },
      }),
      text: `${oneLine(message)}\nExit code 3.\n`,
    };
  }
  const { robots, source, notes } = loaded;
  const findings: Finding[] = [...notes];
  if (robots.groups.length === 0) {
    findings.push(
      cliFinding(
        'robots-groups',
        'info',
        'The file has no User-agent group, so nothing is closed.',
      ),
    );
  }
  const lines: string[] = [style.bold(`robots.txt test: ${source.location}`), `Path: ${path}`, ''];
  let detail: Record<string, unknown>;
  let covered: string | null = null;

  if (agent !== undefined) {
    const match = matchRobots(robots, agent, path);
    const { sentence, evidence } = describeMatch(match);
    const level: FindingLevel = match.allowed ? 'pass' : 'fail';
    findings.push(
      cliFinding(
        'robots-access',
        level,
        `${agent} ${match.allowed ? 'may' : 'may not'} fetch ${path}: ${sentence}.`,
        evidence,
      ),
    );
    const near = suggestion(agent);
    if (near !== null) {
      findings.push(
        cliFinding(
          'robots-agent-unlisted',
          'info',
          `${agent} is not one of the crawlers this tool covers. Did you mean ${near}? The rules are tested for any token you type.`,
        ),
      );
    } else if (!CRAWLERS.some((crawler) => crawler.token.toLowerCase() === agent.toLowerCase())) {
      findings.push(
        cliFinding(
          'robots-agent-unlisted',
          'info',
          `${agent} is not one of the crawlers this tool covers; the rules are tested for any token you type.`,
        ),
      );
    }
    lines.push(`Agent: ${agent}`, '', renderFindings(findings, style));
    detail = { agent, match: flatMatch(match) };
  } else {
    const rows: string[][] = [];
    const entries = crawlerAccess(robots, { path }).map((entry) => {
      const match = entry.path ?? entry.root;
      const training = entry.crawler.purpose === 'training';
      const level: FindingLevel = !match.allowed
        ? training
          ? 'info'
          : 'fail'
        : !training && path === '/' && entry.access === 'partial'
          ? 'warn'
          : 'pass';
      const { sentence, evidence } = describeMatch(match);
      findings.push(
        cliFinding(
          `robots-access-${entry.crawler.token.toLowerCase()}`,
          level,
          `${entry.crawler.token} ${match.allowed ? 'may' : 'may not'} fetch ${path}: ${sentence}.${level === 'warn' ? ' Parts of the site are closed to it.' : ''}`,
          evidence,
        ),
      );
      rows.push([
        level.toUpperCase(),
        entry.crawler.token,
        entry.crawler.purpose,
        match.allowed ? 'allowed' : 'blocked',
        evidence,
      ]);
      return {
        token: entry.crawler.token,
        purpose: entry.crawler.purpose,
        vendor: entry.crawler.vendor,
        siteAccess: entry.access,
        match: flatMatch(match),
      };
    });
    lines.push(renderTable(['Level', 'Crawler', 'Purpose', 'Access', 'Decided by'], rows, style));
    const other = findings.filter((finding) => !finding.id.startsWith('robots-access-'));
    if (other.length > 0) lines.push('', renderFindings(other, style));
    detail = { crawlersCovered: crawlersCoveredLine(), crawlers: entries };
    covered = crawlersCoveredLine();
  }

  const exit = exitForFindings(findings, failOn);
  const safe = sanitizeDeep({ findings, detail, source });
  lines.push('', renderSummary(findings));
  if (covered !== null) lines.push('', covered);
  lines.push('', `Full report: ${fullReportUrl('robots-test')}`);
  return {
    exit,
    json: {
      schemaVersion: 1,
      command: 'robots-test',
      exitCode: exit,
      failOn,
      path,
      source: safe.source,
      ...safe.detail,
      findings: safe.findings,
    },
    text: `${lines.join('\n')}\n`,
  };
}
