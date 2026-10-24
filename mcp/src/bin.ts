#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

// A local server over standard input and output: the protocol uses stdout, so nothing else is
// ever written there. Diagnostics, if any, go to stderr and never carry text from a site.
const server = createServer();
await server.connect(new StdioServerTransport());
