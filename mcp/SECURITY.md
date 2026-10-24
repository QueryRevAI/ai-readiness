# Security policy

## Reporting a vulnerability

Email **security@queryrev.com** with what you found and how to reproduce it. Please do not open
a public issue for a vulnerability.

We reply within three working days, tell you whether we can reproduce the problem, and keep you
informed until a fix is released. We credit reporters in the release notes unless you prefer not
to be named.

## What counts

This server reads files from sites that a program, on a person's behalf, types in, so the parts
that matter most are:

- the network layer: anything that lets a request reach an address it should not (private or
  reserved networks, cloud metadata addresses, a redirect or a DNS answer that changes between
  the check and the connection), or that exceeds the limits on size, time, redirects or request
  rate described in the README;
- any way to reach a private network at all: this server has no option for it, and must not
  gain one through an input, an environment variable or a file;
- the inputs: a value that gets past the checks of a tool and does something the README says it
  cannot (reads or writes a file on the machine, requests a scheme other than http and https,
  changes how the command is run);
- the parsers (robots.txt, llms.txt, sitemaps, HTML, JSON-LD): input that makes them run for
  far longer than the size of the input warrants, or use unbounded memory;
- output: text from a site that reaches the client with control or bidirectional characters
  intact, or outside the JSON of the result.

## Supported versions

The latest release receives fixes. Older releases are not patched.

## What this server never does

It sends nothing to queryrev.com or anywhere else but the site you asked about. It has no
telemetry, no account and no key. It requests only public files, with `GET`, and sends no
cookies or credentials. It reads no file from the machine, writes none, and its code reads no
setting from the environment.
