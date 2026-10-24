import { crawlersCoveredLine } from '../../crawlers';
import { checkTextUrl, CHECK_BUDGET_MS } from '../../net/fetch-text';
import type { Finding } from '../../facts/types';
import { validateLlmsTxt, type LlmsReport } from '../../llms';
import { llmsFindings } from '../../llms/findings';
import { checkLlmsLinks, llmsLinkFindings, type LlmsLinksReport } from '../../llms/links';
import { failOnOf, flag, text as option, type ParsedCommand } from '../args';
import {
  classifySource,
  decodeFile,
  describeFetchFailure,
  exitForFindings,
  fileAddress,
  LLMS_READ_LIMIT,
} from '../common';
import { fullReportUrl, renderFindings, renderSummary, renderTable, type Style } from '../render';
import { oneLine, sanitizeDeep } from '../sanitize';
import { EXIT_UNREADABLE, UsageError, type CliContext, type CommandResult } from '../types';

function reportJson(report: LlmsReport): Record<string, unknown> {
  return {
    present: report.present,
    verdict: report.verdict,
    status: report.status,
    contentType: report.contentType,
    bytes: report.bytes,
    truncated: report.truncated,
    h1: report.h1,
    h1Count: report.h1Count,
    structure:
      report.structure === null
        ? null
        : {
            summary: report.structure.summary,
            sections: report.structure.sections,
            links: report.structure.links,
            structured: report.structure.structured,
          },
  };
}

export async function runLlmsValidate(
  context: CliContext,
  parsed: ParsedCommand,
  style: Style,
): Promise<CommandResult> {
  const failOn = failOnOf(parsed);
  const wantLinks = flag(parsed, 'links');
  const baseOption = option(parsed, 'base');
  let base: string | null = null;
  if (baseOption !== undefined) {
    const checked = checkTextUrl(baseOption);
    if ('refusal' in checked)
      throw new UsageError('--base takes the site address, such as https://example.com.');
    base = checked.url.origin;
  }

  const { source, file } = await classifySource(context, parsed.positionals[0]!, LLMS_READ_LIMIT);
  if (source.kind === 'file' && wantLinks && base === null) {
    throw new UsageError(
      '--links on a file needs --base <site address> to resolve and limit the links.',
    );
  }

  let report: LlmsReport;
  let location = source.location;
  const fetcher = context.createFetcher({
    allowPrivateNetwork: flag(parsed, 'allow-private-network'),
  });
  try {
    if (source.kind === 'file' && file !== null) {
      report = validateLlmsTxt({
        status: 200,
        contentType: 'text/plain',
        body: decodeFile(file.bytes),
        truncated: file.truncated,
      });
    } else {
      const address = fileAddress(source.location, 'llms.txt');
      location = address;
      const signal = AbortSignal.timeout(CHECK_BUDGET_MS);
      const result = await fetcher.fetchText(address, { kind: 'llms', signal });
      if (result.outcome !== 'response') {
        const message = `${address} could not be read: ${describeFetchFailure(result, context.offersPrivateNetwork !== false)}`;
        return {
          exit: EXIT_UNREADABLE,
          json: sanitizeDeep({
            schemaVersion: 1,
            command: 'llms-validate',
            exitCode: EXIT_UNREADABLE,
            source: { kind: 'url', location: address },
            error: { code: 'unreadable', message },
          }),
          text: `${oneLine(message)}\nExit code 3.\n`,
        };
      }
      report = validateLlmsTxt({
        status: result.status,
        contentType: result.contentType,
        body: result.text,
        truncated: result.truncated,
      });
      if (base === null) base = new URL(result.finalUrl).origin;
    }

    const findings: Finding[] = llmsFindings(report);
    let links: LlmsLinksReport | null = null;
    if (wantLinks && report.structure !== null && base !== null) {
      links = await checkLlmsLinks(report.structure.targets, {
        fetcher,
        base,
        signal: AbortSignal.timeout(CHECK_BUDGET_MS),
      });
      findings.push(...llmsLinkFindings(links));
    }

    const exit = exitForFindings(findings, failOn);
    const safe = sanitizeDeep({
      findings,
      report: reportJson(report),
      links,
      source: { kind: source.kind, location },
    });
    const lines: string[] = [
      style.bold(`llms.txt validation: ${safe.source.location}`),
      '',
      renderFindings(safe.findings, style),
    ];
    if (safe.links !== null && safe.links.results.length > 0) {
      lines.push(
        '',
        style.bold('Links checked'),
        renderTable(
          ['Result', 'Status', 'Address'],
          safe.links.results.map((entry) => [
            entry.outcome === 'ok' ? 'OK' : entry.outcome.replace('_', ' '),
            entry.status === null ? '-' : String(entry.status),
            entry.url,
          ]),
          style,
        ),
      );
    }
    lines.push(
      '',
      renderSummary(findings),
      '',
      crawlersCoveredLine(),
      '',
      `Full report: ${fullReportUrl('llms-validate')}`,
    );
    return {
      exit,
      json: {
        schemaVersion: 1,
        command: 'llms-validate',
        exitCode: exit,
        failOn,
        crawlersCovered: crawlersCoveredLine(),
        source: safe.source,
        report: safe.report,
        ...(safe.links === null ? {} : { links: safe.links }),
        findings: safe.findings,
      },
      text: `${lines.join('\n')}\n`,
    };
  } finally {
    await fetcher.close();
  }
}
