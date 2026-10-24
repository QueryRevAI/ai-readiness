#!/usr/bin/env node
import { argv } from 'node:process';
import { runCli } from './main';
import { nodeContext } from './node-context';

// The exit code is set, not forced: output that is still being written is not cut off.
process.exitCode = await runCli(argv.slice(2), nodeContext());
