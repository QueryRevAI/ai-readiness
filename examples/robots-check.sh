#!/bin/sh
# Tests a robots.txt file before it goes live: every line below states what must be true.
# `robots test --agent` exits 0 when the crawler may fetch the path and 1 when it may not, so
# the exit code is the answer. Usage: examples/robots-check.sh [path-to-robots.txt]
set -u

file="${1:-$(dirname "$0")/robots.txt}"
failed=0

# expect <allowed|blocked> <crawler> <path>
expect() {
  want="$1"
  agent="$2"
  path="$3"
  npx --yes @queryrev/ai-readiness robots test "$file" --agent "$agent" --path "$path" >/dev/null 2>&1
  status=$?
  case "$status" in
    0) got=allowed ;;
    1) got=blocked ;;
    *) echo "error: robots test exited $status for $agent $path" >&2; failed=1; return ;;
  esac
  if [ "$got" = "$want" ]; then
    echo "ok      $agent $path is $got"
  else
    echo "FAILED  $agent $path is $got, expected $want"
    failed=1
  fi
}

expect allowed OAI-SearchBot /
expect allowed PerplexityBot /blog/a-post
expect allowed ChatGPT-User /pricing
expect blocked OAI-SearchBot /account/settings
expect blocked GPTBot /

exit "$failed"
