/**
 * Test helpers: a guard that allows one loopback address and one port, a resolver from a fixed
 * table, and a text fetcher built on them. For tests of code that fetches from a local fixture
 * server only.
 */
export { createFixtureNetworkGuard, FIXTURE_ADDRESS, tableResolver } from './fixture-guard';
export { createFixtureTextFetcher } from './fixture-fetcher';
