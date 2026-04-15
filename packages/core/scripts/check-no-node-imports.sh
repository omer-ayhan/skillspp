#!/usr/bin/env bash
set -euo pipefail

if rg -n "from ['\"].*apps/|from ['\"]@skillspp/skillspp-cli|from ['\"]skillspp['\"]|from ['\"]@skillspp/skillspp-mcp" src >/dev/null; then
  echo "Core package must not import app-layer modules." >&2
  rg -n "from ['\"].*apps/|from ['\"]@skillspp/skillspp-cli|from ['\"]skillspp['\"]|from ['\"]@skillspp/skillspp-mcp" src >&2
  exit 1
fi

if rg -n "from ['\"]commander['\"]|from ['\"]ink['\"]" src >/dev/null; then
  echo "Core package must not import adapter libraries (commander/ink)." >&2
  rg -n "from ['\"]commander['\"]|from ['\"]ink['\"]" src >&2
  exit 1
fi

if rg -n "process\\.stdout\\.write|process\\.stderr\\.write" src >/dev/null; then
  echo "Core package must not write to stdio directly." >&2
  rg -n "process\\.stdout\\.write|process\\.stderr\\.write" src >&2
  exit 1
fi

if rg -n "type\\s+\\w*CommanderOptions|parseTelemetrySink|parsePolicyMode\\(" src >/dev/null; then
  echo "Core package must not define CLI parser artifacts." >&2
  rg -n "type\\s+\\w*CommanderOptions|parseTelemetrySink|parsePolicyMode\\(" src >&2
  exit 1
fi

echo "Core boundary checks passed."
