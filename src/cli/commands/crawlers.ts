import { CRAWLERS, crawlersCoveredLine } from '../../crawlers';
import { renderCrawlerList, type Style } from '../render';
import { EXIT_OK, type CommandResult } from '../types';

export function runCrawlers(style: Style): CommandResult {
  return {
    exit: EXIT_OK,
    json: {
      schemaVersion: 1,
      command: 'crawlers',
      exitCode: EXIT_OK,
      crawlersCovered: crawlersCoveredLine(),
      crawlers: CRAWLERS.map((crawler) => ({
        token: crawler.token,
        vendor: crawler.vendor,
        purpose: crawler.purpose,
      })),
    },
    text: `${renderCrawlerList(style)}\n\n${crawlersCoveredLine()}\n`,
  };
}
