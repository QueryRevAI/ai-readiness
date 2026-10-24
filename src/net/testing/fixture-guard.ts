import { classifyAddress } from '../address';
import { guardWithRules, type HostResolver, type NetworkGuard } from '../guard';

/**
 * A network guard for tests against the local fixture site. It allows exactly one address,
 * 127.0.0.1, on exactly one port, the fixture's. Every other address is refused: with the
 * strict rule's reason when the strict rules refuse it, and as `not_global` when they would
 * allow it, so a test can never reach the public internet. Ports other than the fixture's are
 * refused, 80 and 443 included.
 *
 * This lives in the testing entry point only; production code has no way to build a guard
 * with other rules.
 */
export const FIXTURE_ADDRESS = '127.0.0.1';

export function createFixtureNetworkGuard(options: {
  readonly port: number;
  readonly resolver: HostResolver;
}): NetworkGuard {
  return guardWithRules(
    {
      ports: [options.port],
      classify: (address) => {
        if (address === FIXTURE_ADDRESS) return { allowed: true, family: 4 };
        const strict = classifyAddress(address);
        return strict.allowed ? { allowed: false, reason: 'not_global' } : strict;
      },
    },
    options.resolver,
  );
}

/** A resolver from a fixed table; unknown names fail as `ENOTFOUND` would. Counts lookups. */
export function tableResolver(table: Readonly<Record<string, readonly string[]>>): HostResolver & {
  readonly lookups: string[];
} {
  const lookups: string[] = [];
  const resolve = (hostname: string): Promise<readonly string[]> => {
    lookups.push(hostname);
    const answer = table[hostname.toLowerCase()];
    if (answer === undefined) return Promise.reject(new Error('ENOTFOUND'));
    return Promise.resolve(answer);
  };
  return Object.assign(resolve, { lookups });
}
