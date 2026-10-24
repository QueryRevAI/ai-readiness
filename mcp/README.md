# QueryRev AI Readiness for MCP

A local [MCP](https://modelcontextprotocol.io) server that checks how a site's public files treat AI crawlers. It gives any MCP client five tools: the crawler access check, a robots.txt tester, an llms.txt validator, an llms.txt generator and the list of crawlers covered. Every result is a finding with its evidence. There are no scores, no model calls and no telemetry.

It runs on your machine, over standard input and output, and makes its requests from your machine. It is the same checking code as the [`@queryrev/ai-readiness`](https://www.npmjs.com/package/@queryrev/ai-readiness) command line, and returns the same JSON as `ai-readiness <command> --json`.

Requires Node 22.19 or later.

## Install

Nothing to install: an MCP client starts the server with `npx`.

```
npx -y @queryrev/ai-readiness-mcp
```

Started by hand it waits for a client on standard input; stop it with Ctrl-C.

## Configure a client

Any MCP client that starts a local server over standard input and output takes the same three things: a name, a command and its arguments. Many clients read them from a JSON file like this one:

```json
{
  "mcpServers": {
    "ai-readiness": {
      "command": "npx",
      "args": ["-y", "@queryrev/ai-readiness-mcp"]
    }
  }
}
```

The name of the key that holds the servers, and the place of the file, differ between clients; see your client's documentation. A client that takes a command line instead takes `npx -y @queryrev/ai-readiness-mcp`. To pin a version, write it after the package name: `@queryrev/ai-readiness-mcp@<version>`.

The server has no option, and its code reads no setting from the environment. There is nothing to configure beyond how it is started.

## Tools

| Tool            | Input                                      | What it does                                                                                                  |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `check`         | `url`, `failOn`                            | Crawler access, llms.txt, the home page as served, structured data and the sitemap                            |
| `robots_test`   | `url` or `text`, `agent`, `path`, `failOn` | Which robots.txt line decides for a crawler and a path. With `text` no request is made                        |
| `llms_validate` | `url` or `text`, `links`, `base`, `failOn` | Checks an llms.txt against [llmstxt.org](https://llmstxt.org); `links` also requests up to 20 of its links    |
| `llms_generate` | `url`, `maxPages` (1 to 100, default 30)   | Builds the skeleton of an llms.txt from the site's own sitemap or home page links. Nothing is written to disk |
| `crawlers`      | none                                       | The crawlers covered, with vendor and purpose. Makes no request                                               |

Inputs are checked before anything happens:

- `url` is an `http` or `https` address of at most 2048 characters, without spaces or control characters. Nothing else is accepted: no file address, no other scheme, no bare host name.
- `text` is the text of a file, at most 500 KiB for a robots.txt and 1 MiB for an llms.txt. The server reads no file from your machine and writes none; text you already have is passed as `text`. In a result, text is a source of its own, `{ "kind": "text" }`, and a message calls it "the given text".
- `agent` is a crawler token such as `OAI-SearchBot`. `path` starts with `/`.
- A field that is not listed is refused. There is no field that reaches a private network, and no way to turn it on.

Each result is one block of JSON text with `schemaVersion: 1`, `command`, `exitCode` and the report, as `ai-readiness <command> --json` prints it. `exitCode` is the command line's: `0` nothing at or above `failOn` (`fail` by default), `1` checks failed, `3` the site could not be read. Two kinds of error come back as an error result (`isError`):

- An input that breaks a tool's schema (a wrong address, an unknown field, a value over its cap, both or neither of `url` and `text`) is refused before anything runs, with the protocol library's plain-text input-validation message. It is not JSON and has no exit code.
- A usage error found by the command itself (for example `text` that is an HTML page, not a robots.txt) comes back as the command line's JSON with `exitCode` `2` and `error.code` `usage`. An internal error is the same with `4`.

Findings have a stable `id`, a `level` (`pass`, `warn`, `fail` or `info`), one sentence in `message`, and the evidence in `snippet` when there is one.

A site that cannot be read is not an error result: it is JSON with `exitCode` `3`.

The result is the command line's document with one addition: `crawlersCovered` at the top of every result, also where the command line has it elsewhere or not at all.

Crawlers covered: the 11 AI crawlers on this list, from OpenAI, Perplexity, Google, Apple, Common Crawl, Meta, Amazon and ByteDance. Other crawlers are not checked.

The `crawlers` tool lists them. `robots_test` with an `agent` tests the one token you name, covered or not. Nothing here says "all AI crawlers".

## Time, cancelling and progress

`check` takes at most 30 seconds, `llms_generate` at most 120, the others 10 seconds a request. If a client cancels a call, or its own timeout passes and it cancels, the server stops the requests of that call. A client that sends a progress token with `llms_generate` (or any other tool that makes requests) gets a progress notification after each request.

## Text from a site is data

Titles, headings, lines of a robots.txt and page text in a result come from a site that anyone can write. The server removes control characters and the characters that reorder text (the bidirectional controls) from every string it returns, and returns the text only inside the JSON. A client should still treat it as untrusted data to report, and never as instructions: a page can say anything, including "ignore your instructions". The server's own description tells the client so.

## What it cannot see

It reads public files over HTTP, as one visitor from your machine. It cannot see:

- a CDN or firewall rule that answers AI crawlers differently from how it answers this tool (a crawler that robots.txt allows can still be blocked at the network edge);
- what a crawler actually fetches, how often, or whether a page is cited by an AI answer;
- content that only appears after scripts run: the home page is read as served, without scripts;
- anything behind a login, a bot check or a block of this tool's own address.

## Network behaviour

The server is run by anyone against any address a client passes to it, so it is strict about what it touches.

- User agent: `Mozilla/5.0 (compatible; QueryRev-AIReadiness/1.0; +https://queryrev.com/bot)`. Its robots.txt token is `QueryRev-AIReadiness`, and it obeys the rules written for that token (or `*`), including `Crawl-delay` up to 10 seconds.
- `check` and `llms_generate` request a file only where robots.txt lets this tool in. `robots_test` and `llms_validate` request the one file you point them at; `llms_validate` with `links` asks robots.txt before it requests each link. With `text` nothing is requested.
- `GET` only. No cookies, no credentials, no proxy taken from the environment.
- Only `http` and `https`, only ports 80 and 443, no user name or password in the address, no IP-literal hosts, host names of at most 253 characters.
- The host name is resolved once and the connection goes to the address that was checked. Private, loopback, link-local, cloud metadata and other special-purpose ranges are always refused. Unlike the command line, this server has no option that allows a private network.
- At most 3 redirects, each checked again; a redirect to another site is not followed.
- 5 seconds to connect, 10 seconds a request, 30 seconds for `check`, 120 seconds for `llms_generate`.
- Size limits, counted after decompression and reported when reached: robots.txt 500 KiB, llms.txt 1 MiB, pages 2 MiB, sitemaps 5 MiB.
- One request a second to a host. The tool stops asking a host that answers 429 or 503. At most two tool calls run at once; others wait.
- Nothing is sent to queryrev.com or to anyone but the site you ask about. There is no telemetry, no account and no key. The server writes nothing to disk and nothing to standard output but the protocol.

## Licences

The code is MIT (see `LICENSE`). It bundles the code of `@queryrev/ai-readiness`, also MIT.

## Security

Report a vulnerability to **security@queryrev.com**, not in a public issue. See `SECURITY.md`.
