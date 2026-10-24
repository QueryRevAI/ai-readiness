# QueryRev AI Readiness

Checks how a site's public files treat AI crawlers: which of 11 AI crawlers robots.txt lets in, whether the llms.txt is a real llms.txt, and what the home page says without running scripts. Every result is a finding with its evidence. There are no scores, no model calls and no telemetry.

```
npx @queryrev/ai-readiness check www.example.com
```

Requires Node 22.19 or later. One runtime dependency (`undici`).

## Install

```
npx @queryrev/ai-readiness <command>      # no install
npm install --global @queryrev/ai-readiness
ai-readiness <command>
```

## Commands

| Command                                  | What it does                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `check <url>`                            | Crawler access, llms.txt, the home page as served, structured data and the sitemap                     |
| `robots test <file\|url> --agent --path` | Which robots.txt line decides for a crawler and a path. A file is read offline                         |
| `llms validate <file\|url> [--links]`    | Checks an llms.txt against [llmstxt.org](https://llmstxt.org); `--links` also requests up to 20 links |
| `llms generate <url> [--max-pages 30]`   | Builds the skeleton of an llms.txt from the site's own sitemap or home page links                      |
| `crawlers`                               | The crawlers covered, with vendor and purpose                                                          |

Options: `--json`, `--fail-on fail|warn`, `--allow-private-network`, `--no-color`, `--help`, `--version`. Options go after the command.

### `check`

```
$ ai-readiness check www.example.com
AI readiness check: https://www.example.com

Crawler access (robots.txt, whole site)
  Crawler             Purpose   Access
  GPTBot              training  allowed
  OAI-SearchBot       search    allowed
  ...

Findings
  PASS  robots-txt                  robots.txt found (77 bytes).
  PASS  sitemap-in-robots           robots.txt lists a sitemap.
        | https://www.example.com/sitemap.xml
  PASS  ai-search-crawler-access    All 5 AI search and user-fetch crawlers on the list can read the home page.
  INFO  ai-training-crawler-access  No AI training crawler on the list is blocked. Blocking them is the site's choice.
  WARN  organization-same-as        The Organization has no sameAs link to a profile on another site.
  ...

13 pass, 1 warn, 0 fail, 2 info
```

`check` asks for four files, in this order, and only where robots.txt lets this tool in: `/robots.txt`, the home page, `/llms.txt` and the sitemap. If robots.txt cannot be read, nothing else is requested and the exit code is 3.

Training crawlers are reported but never counted as a failure: blocking them is the site's choice. A crawler for AI search or for fetching a page when a user asks is a `fail` when robots.txt keeps it from the home page.

### `robots test`

```
$ ai-readiness robots test robots.txt --agent OAI-SearchBot --path /account/settings
  FAIL  robots-access  OAI-SearchBot may not fetch /account/settings: the "*" group (line 9), decided by line 10 (Disallow: /account/).
        | line 10: Disallow: /account/
```

With `--agent` the exit code answers the question: 0 when the crawler may fetch the path, 1 when it may not. Any token can be tested; the tool suggests only the crawlers it covers. Without `--agent` it tests every covered crawler.

Matching follows RFC 9309: the group that names the token applies, else the `*` group; the longest matching rule wins and `Allow` wins a tie.

### `llms validate`

```
$ ai-readiness llms validate https://www.example.com --links
  PASS  llms-txt-found     The file is an llms.txt.
  PASS  llms-txt-h1        The file has one H1, as llmstxt.org asks.
  PASS  llms-txt-summary   The file has a summary blockquote.
  PASS  llms-txt-sections  The file has 2 H2 sections of links and 14 links in all.
  FAIL  llms-txt-links     1 of 14 checked links answer 404 or 410.
        | 404 https://www.example.com/old-guide
```

A 200 alone is not enough: an HTML page, or a robots.txt, served at `/llms.txt` is reported as not being an llms.txt, and so is text that does not open with a Markdown H1. For a local file, `--links` needs `--base <site address>` to resolve the links.

### `llms generate`

```
$ ai-readiness llms generate https://www.example.com --max-pages 30 --out llms.txt
```

Reads robots.txt, then the sitemaps it lists (at most 5 files), else the links on the home page. Only pages on the same site are listed; pages that say `noindex`, redirect elsewhere or are closed to this tool by robots.txt are left out. Each page's title and meta description are used as the page wrote them. The result is a skeleton: read it and edit it before you publish it. With `--out` the file is written only if it does not exist, unless `--force` is given. Without `--out` the file goes to standard output and the notes to standard error.

## Crawlers covered

Crawlers covered: the 11 AI crawlers on this list, from OpenAI, Perplexity, Google, Apple, Common Crawl, Meta, Amazon and ByteDance. Other crawlers are not checked.

| Crawler            | Vendor       | Purpose  |
| ------------------ | ------------ | -------- |
| GPTBot             | OpenAI       | training |
| OAI-SearchBot      | OpenAI       | search   |
| ChatGPT-User       | OpenAI       | user     |
| PerplexityBot      | Perplexity   | search   |
| Perplexity-User    | Perplexity   | user     |
| Google-Extended    | Google       | training |
| Applebot-Extended  | Apple        | training |
| CCBot              | Common Crawl | training |
| Meta-ExternalAgent | Meta         | training |
| Amazonbot          | Amazon       | search   |
| Bytespider         | ByteDance    | training |

The line is printed at the end of `check`, `crawlers`, `llms validate`, `llms generate` and `robots test` without `--agent`, and is the `crawlersCovered` field of their JSON. `robots test --agent` tests the one token you name, covered or not. Nothing here says "all AI crawlers".

## What it cannot see

It reads public files over HTTP, as one visitor from your machine. It cannot see:

- a CDN or firewall rule that answers AI crawlers differently from how it answers this tool (a crawler that robots.txt allows can still be blocked at the network edge);
- what a crawler actually fetches, how often, or whether a page is cited by an AI answer;
- content that only appears after scripts run: the home page is read as served, without scripts;
- anything behind a login, a bot check or a block of this tool's own address.

## Network behaviour

The tool is meant to be run by anyone against any address, so it is strict about what it touches.

- User agent: `Mozilla/5.0 (compatible; QueryRev-AIReadiness/1.0; +https://queryrev.com/bot)`. Its robots.txt token is `QueryRev-AIReadiness`, and it obeys the rules written for that token (or `*`), including `Crawl-delay` up to 10 seconds.
- `check` and `llms generate` request a file only where robots.txt lets this tool in. `robots test` and `llms validate` fetch the one file you point them at; `llms validate --links` asks robots.txt before it requests each link.
- `GET` only. No cookies, no credentials, no proxy taken from the environment.
- Only `http` and `https`, only ports 80 and 443, no user name or password in the address, no IP-literal hosts, host names of at most 253 characters.
- The host name is resolved once and the connection goes to the address that was checked. Private, loopback, link-local, cloud metadata and other special-purpose ranges are refused.
- At most 3 redirects, each checked again; a redirect to another site is not followed.
- 5 seconds to connect, 10 seconds a request, 30 seconds for `check`, 120 seconds for `llms generate`.
- Size limits, counted after decompression and reported when reached: robots.txt 500 KiB, llms.txt 1 MiB, pages 2 MiB, sitemaps 5 MiB.
- One request a second to a host. The tool stops asking a host that answers 429 or 503.
- Text from a site is stripped of control and escape characters before it is printed.
- `--allow-private-network` lets the command line reach a staging site on a private network. It never opens cloud metadata addresses, IP-literal hosts or other ports. The library entry point has no such option.
- Nothing is sent to queryrev.com or to anyone but the site you ask about. There is no telemetry, no account and no key. The "Full report" link at the end of a report is printed, not opened.

## Use in CI

The exit code is the contract:

| Code | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | Nothing at or above `--fail-on` (`fail` by default; `warn` to be stricter)            |
| 1    | Checks failed                                                                         |
| 2    | Usage error: a wrong command, option or input file                                    |
| 3    | The site could not be read: refused, unreachable, timed out, or robots.txt unreadable |
| 4    | Internal error                                                                        |

```
npx @queryrev/ai-readiness check https://www.example.com --fail-on fail
```

`--json` prints one JSON document on standard output and nothing else, for every exit code, errors included:

```json
{
  "schemaVersion": 1,
  "command": "check",
  "exitCode": 0,
  "failOn": "fail",
  "summary": { "pass": 13, "warn": 1, "fail": 0, "info": 2 },
  "site": { "origin": "https://www.example.com", "crawlerAccess": [], "findings": [] }
}
```

`schemaVersion`, the flags and the exit codes are the contract: a change to them is a major version. Within version 1, fields may be added. Each finding has a stable `id`, a `level` (`pass`, `warn`, `fail` or `info`), one sentence in `message`, a `docUrl`, and its evidence in `snippet` when there is one.

The `examples/` folder has a CI script that acts on the exit codes (`ci.sh`), a plain-Node consumer of the JSON (`read-report.mjs`), and a robots.txt with a script that tests it (`robots.txt`, `robots-check.sh`).

## Licences

- The code is MIT (see `LICENSE`).
- The data under `data/` is CC BY 4.0 (see `data/LICENSE`). Credit it by citing the dataset below.

## How to cite

Cite the software with the metadata in `CITATION.cff` (GitHub shows a "Cite this repository" button). The crawler study the covered list comes from is a dataset under CC BY 4.0:

> QueryRev Research. State of AI Crawler Access (October 2026). Zenodo. https://doi.org/10.5281/zenodo.23424275

## Contributing

Issues and pull requests are welcome at https://github.com/QueryRevAI/ai-readiness. This repository is updated by release snapshots, so we apply an accepted change ourselves and credit you as a co-author on the commit; the next release carries it. A pull request is therefore closed with a note instead of being merged.

A new crawler for the covered list needs a link to the vendor's own documentation of its token.

## Security

Report a vulnerability to **security@queryrev.com**, not in a public issue. See `SECURITY.md`.
