import { isIPv6 } from 'node:net';
import { classifyAddress, type AddressClass, type AddressRefusal } from './address';
import { buildTextFetcher, type TextFetcher, type TextFetcherOptions } from './fetch-text';
import {
  createNetworkGuard,
  guardWithRules,
  STRICT_RULES,
  systemResolver,
  type HostResolver,
  type NetworkGuard,
} from './guard';

/**
 * The command-line entry point (`@queryrev/ai-readiness/cli`). It adds one thing to the main
 * entry: a fetcher that a person at a terminal may point at a staging site on their own
 * network, with an explicit flag. A hosted service, a server or an MCP server imports the main
 * entry, whose fetcher has no way to loosen the guard, and never this one.
 *
 * Even with the opt-in, cloud metadata and link-local addresses stay refused, as do IP-literal
 * hosts and ports other than 80 and 443: a staging site is reached by its name.
 */

// Addresses of cloud metadata services that sit inside ranges the opt-in opens.
const METADATA_IN_PRIVATE_RANGES = new Set(['100.100.100.200', 'fd00:ec2::254']);
const PRIVATE_NETWORK_REASONS: ReadonlySet<AddressRefusal> = new Set<AddressRefusal>([
  'private',
  'loopback',
  'shared',
]);

function canonicalAddress(address: string): string {
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  if (!isIPv6(bare)) return bare;
  try {
    return new URL(`http://[${bare}]/`).hostname.slice(1, -1);
  } catch {
    return bare;
  }
}

/** The address rule of the private-network opt-in. */
export function classifyPrivateNetworkAddress(address: string): AddressClass {
  const strict = classifyAddress(address);
  if (strict.allowed) return strict;
  if (!PRIVATE_NETWORK_REASONS.has(strict.reason)) return strict;
  const canonical = canonicalAddress(address);
  if (METADATA_IN_PRIVATE_RANGES.has(canonical)) {
    return { allowed: false, reason: 'cloud_metadata' };
  }
  return { allowed: true, family: isIPv6(canonical) ? 6 : 4 };
}

/** The guard of the opt-in: ports 80 and 443, the address rule above. */
export function createPrivateNetworkGuard(resolver: HostResolver = systemResolver): NetworkGuard {
  return guardWithRules(
    { ports: STRICT_RULES.ports, classify: classifyPrivateNetworkAddress },
    resolver,
  );
}

export interface CliTextFetcherOptions extends TextFetcherOptions {
  /** Set only from the user's explicit command-line flag. Off by default. */
  readonly allowPrivateNetwork?: boolean;
}

/** The CLI's fetcher: strict unless the user asked for the private network. One per run. */
export function createCliTextFetcher(options: CliTextFetcherOptions = {}): TextFetcher {
  const resolver = options.resolver;
  const guard =
    options.allowPrivateNetwork === true
      ? createPrivateNetworkGuard(resolver)
      : createNetworkGuard(resolver === undefined ? {} : { resolver });
  return buildTextFetcher({ guard });
}
