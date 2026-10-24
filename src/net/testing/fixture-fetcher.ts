import { buildTextFetcher, type TextFetcher } from '../fetch-text';
import type { HostResolver } from '../guard';
import { createFixtureNetworkGuard } from './fixture-guard';

/**
 * A text fetcher for tests against a local fixture server: the fixture guard (127.0.0.1 on one
 * port only) and, unless a test shortens them, the production timings and politeness.
 */
export function createFixtureTextFetcher(options: {
  readonly port: number;
  readonly resolver: HostResolver;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly hostIntervalMs?: number;
  /** PEM of a fixture's self-signed certificate, to trust in this fetcher only. */
  readonly ca?: string;
}): TextFetcher {
  return buildTextFetcher({
    guard: createFixtureNetworkGuard({ port: options.port, resolver: options.resolver }),
    ...(options.connectTimeoutMs === undefined
      ? {}
      : { connectTimeoutMs: options.connectTimeoutMs }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.hostIntervalMs === undefined ? {} : { hostIntervalMs: options.hostIntervalMs }),
    ...(options.ca === undefined ? {} : { testCa: options.ca }),
  });
}
