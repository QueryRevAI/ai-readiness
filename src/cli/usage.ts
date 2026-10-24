export const USAGE = `ai-readiness: checks how a site's public files treat AI crawlers.

Usage: ai-readiness <command> [arguments] [options]

Commands
  check <url>                       robots.txt access of the covered AI crawlers, llms.txt, the
                                    home page as served, structured data and the sitemap
  robots test <file|url>            which robots.txt line decides for a crawler and a path
      --agent <token>                 one crawler token (any token); all covered crawlers without it
      --path <path>                   the path to test, default /
  llms validate <file|url>          checks an llms.txt against llmstxt.org
      --links                         also request up to 20 links on the same site
      --base <url>                    the site of a local file's links (needed with --links)
  llms generate <url>               builds the skeleton of an llms.txt from the site's own pages
      --max-pages <n>                 pages to list, 1 to 100, default 30
      --out <file>                    write the file here (--force replaces an existing file)
  crawlers                          the AI crawlers covered, with vendor and purpose

Options
  --json                 one JSON document with schemaVersion 1, no colour, no other output
  --fail-on <level>      exit 1 for findings at "fail" (default) or at "warn" (check, robots test, llms validate)
  --allow-private-network
                         reach a staging site on a private network (never cloud metadata addresses)
  --no-color             no colour (also off without a terminal, or when NO_COLOR is set)
  -h, --help             this text
  -v, --version          the version

Exit codes
  0  nothing at or above --fail-on
  1  checks failed
  2  usage error
  3  the site could not be read (refused, unreachable, timed out)
  4  internal error

Reads public files only. Sends nothing to queryrev.com.
`;
