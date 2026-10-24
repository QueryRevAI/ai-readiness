import { checkSite } from '../../facts';
import type { SiteCheck } from '../../facts';
import { failOnOf, flag, type ParsedCommand } from '../args';
import { exitForFindings } from '../common';
import {
  CANNOT_SEE,
  fullReportUrl,
  makeStyle,
  renderFindings,
  renderSummary,
  renderTable,
  summarize,
} from '../render';
import { sanitizeDeep } from '../sanitize';
import { EXIT_UNREADABLE, type CliContext, type CommandResult } from '../types';

const PRIVATE_NETWORK_HINT =
  'A staging site on a private network is reached with --allow-private-network.';

/** A site that gave no robots.txt answer to read, or an address that cannot be checked. */
function unreadable(site: SiteCheck): string | null {
  if (site.findings.some((finding) => finding.id === 'site-refused')) {
    return site.findings[0]?.snippet ?? 'the address cannot be checked';
  }
  if (site.robots.outcome === 'not_read') {
    return site.robots.status === null
      ? 'no answer to the request for robots.txt'
      : `robots.txt answered ${site.robots.status}`;
  }
  return null;
}

export async function runCheck(
  context: CliContext,
  parsed: ParsedCommand,
  style: ReturnType<typeof makeStyle>,
): Promise<CommandResult> {
  const failOn = failOnOf(parsed);
  const fetcher = context.createFetcher({
    allowPrivateNetwork: flag(parsed, 'allow-private-network'),
  });
  let raw: SiteCheck;
  try {
    raw = await checkSite(parsed.positionals[0]!, { fetcher });
  } finally {
    await fetcher.close();
  }
  const site = sanitizeDeep(raw);
  const why = unreadable(site);
  const exit = why !== null ? EXIT_UNREADABLE : exitForFindings(site.findings, failOn);

  const lines: string[] = [
    style.bold(`AI readiness check: ${site.origin === '' ? parsed.positionals[0]! : site.origin}`),
    '',
  ];
  if (site.crawlerAccess.length > 0) {
    lines.push(style.bold('Crawler access (robots.txt, whole site)'));
    lines.push(
      renderTable(
        ['Crawler', 'Purpose', 'Access'],
        site.crawlerAccess.map((entry) => [
          entry.token,
          entry.purpose,
          entry.access === 'partial' ? 'partial (some paths closed)' : entry.access,
        ]),
        style,
      ),
    );
    lines.push('');
  }
  lines.push(style.bold('Findings'));
  lines.push(renderFindings(site.findings, style));
  lines.push('');
  lines.push(`${renderSummary(site.findings)}`);
  if (why !== null) {
    lines.push('', `The site could not be read: ${why}. Exit code 3.`);
    if (
      site.robots.status === null &&
      context.offersPrivateNetwork !== false &&
      !flag(parsed, 'allow-private-network')
    ) {
      lines.push(PRIVATE_NETWORK_HINT);
    }
  }
  lines.push('', site.crawlersCovered, CANNOT_SEE, '', `Full report: ${fullReportUrl('check')}`);

  return {
    exit,
    json: {
      schemaVersion: 1,
      command: 'check',
      exitCode: exit,
      failOn,
      summary: summarize(site.findings),
      ...(why === null ? {} : { error: { code: 'unreadable', message: why } }),
      site,
    },
    text: `${lines.join('\n')}\n`,
  };
}
