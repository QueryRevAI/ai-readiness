/* global process, console */
// Runs `check` with --json and reads the document in plain Node, without any package.
// Usage: node examples/read-report.mjs https://www.example.com
import { spawnSync } from 'node:child_process';

const site = process.argv[2];
if (site === undefined) {
  console.error('usage: node read-report.mjs <site-url>');
  process.exit(2);
}

const run = spawnSync('npx', ['--yes', '@queryrev/ai-readiness', 'check', site, '--json'], {
  encoding: 'utf8',
});

// With --json, standard output holds one JSON document for every exit code, errors included.
const report = JSON.parse(run.stdout);
if (report.schemaVersion !== 1) {
  throw new Error(`Unexpected schemaVersion ${report.schemaVersion}`);
}

if (report.error !== undefined) {
  console.error(`${report.error.code}: ${report.error.message} (exit code ${report.exitCode})`);
  process.exit(report.exitCode);
}

const { pass, warn, fail, info } = report.summary;
console.log(`${report.site.origin}: ${pass} pass, ${warn} warn, ${fail} fail, ${info} info`);

// A crawler the site keeps out of its home page, by purpose.
for (const crawler of report.site.crawlerAccess) {
  if (!crawler.root) console.log(`  closed to ${crawler.token} (${crawler.purpose})`);
}

// Every finding has a stable id, a level, one sentence, and its evidence in `snippet`.
for (const finding of report.site.findings) {
  if (finding.level === 'fail' || finding.level === 'warn') {
    console.log(`${finding.level.toUpperCase()} ${finding.id}: ${finding.message}`);
    if (finding.snippet !== undefined) console.log(`    ${finding.snippet}`);
  }
}

process.exit(report.exitCode);
