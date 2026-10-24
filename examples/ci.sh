#!/bin/sh
# Fails a CI job when a site closes its pages to AI search crawlers or breaks its llms.txt.
# Usage: examples/ci.sh https://www.example.com
#
# The exit codes of `ai-readiness` are the contract:
#   0 nothing at or above --fail-on     1 checks failed        2 usage error
#   3 the site could not be read        4 internal error
set -u

site="${1:?usage: ci.sh <site-url>}"

npx --yes @queryrev/ai-readiness check "$site" --fail-on fail --json > ai-readiness.json
status=$?

case "$status" in
  0)
    echo "AI readiness: nothing at fail level. The report is in ai-readiness.json."
    ;;
  1)
    echo "AI readiness: checks failed. The report is in ai-readiness.json." >&2
    exit 1
    ;;
  3)
    # The site was down, slow or refused the request: not a failed check, but not a pass either.
    # Change this to `exit 0` if an unreachable site should not fail the job.
    echo "AI readiness: the site could not be read." >&2
    exit 3
    ;;
  *)
    echo "AI readiness: exited with code $status, which is a problem with the command or its arguments." >&2
    exit "$status"
    ;;
esac
