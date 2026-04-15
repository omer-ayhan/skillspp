#!/usr/bin/env bash
set -euo pipefail

if command -v rg >/dev/null 2>&1; then
  SEARCH_WITH_RG=1
else
  SEARCH_WITH_RG=0
fi

search_matches() {
  local pattern="$1"
  shift

  if [ "$SEARCH_WITH_RG" -eq 1 ]; then
    rg -n --glob '!**/dist/**' --glob '!**/node_modules/**' -- "$pattern" "$@"
  else
    grep -RInE --exclude-dir=dist --exclude-dir=node_modules -- "$pattern" "$@"
  fi
}

list_files() {
  local target="$1"

  if [ "$SEARCH_WITH_RG" -eq 1 ]; then
    rg --files "$target" --glob '!**/node_modules/**'
  else
    find "$target" -type d \( -name node_modules -o -name dist \) -prune -o -type f -print | sed 's#^\./##'
  fi
}

filter_matches() {
  local pattern="$1"

  if [ "$SEARCH_WITH_RG" -eq 1 ]; then
    rg -- "$pattern"
  else
    grep -E -- "$pattern"
  fi
}

filter_non_matches() {
  local pattern="$1"

  if [ "$SEARCH_WITH_RG" -eq 1 ]; then
    rg -v -- "$pattern"
  else
    grep -Ev -- "$pattern"
  fi
}

# 1) apps must not import other apps
if search_matches "from ['\"][^'\"]*apps/" apps >/dev/null; then
  echo "Boundary violation: apps must not import from other apps." >&2
  search_matches "from ['\"][^'\"]*apps/" apps >&2
  exit 1
fi

# 1b) apps must not keep app-local provider/source business modules
if search_matches "from ['\"](\\./|\\.\\./)[^'\"]*/(sources|providers)/" apps >/dev/null; then
  echo "Boundary violation: apps must not import app-local sources/providers modules." >&2
  search_matches "from ['\"](\\./|\\.\\./)[^'\"]*/(sources|providers)/" apps >&2
  exit 1
fi

# 1c) skillspp-cli runtime must stay transport-only
if [ -e "apps/skillspp-cli/src/runtime/background-tasks.ts" ]; then
  echo "Boundary violation: apps/skillspp-cli/src/runtime/background-tasks.ts must live in packages/core." >&2
  exit 1
fi
if list_files apps/skillspp-cli/src/runtime | filter_non_matches "background-executor.ts|background-runner.ts|background-task-types.ts" >/dev/null; then
  echo "Boundary violation: apps/skillspp-cli/src/runtime may only contain background-executor.ts, background-runner.ts, and background-task-types.ts." >&2
  list_files apps/skillspp-cli/src/runtime | filter_non_matches "background-executor.ts|background-runner.ts|background-task-types.ts" >&2
  exit 1
fi

# 2) packages must not import from apps
if search_matches "from ['\"][^'\"]*apps/" packages >/dev/null; then
  echo "Boundary violation: packages must not import from apps." >&2
  search_matches "from ['\"][^'\"]*apps/" packages >&2
  exit 1
fi

# 3) no deep private workspace imports (../..../src) across workspace boundaries
if search_matches "from ['\"]\.\.\/\.\.\/core\/src|from ['\"]\.\.\/\.\.\/platform-node\/src|from ['\"]\.\.\/\.\.\/\.\.\/packages\/" apps packages >/dev/null; then
  echo "Boundary violation: deep private workspace imports are not allowed." >&2
  search_matches "from ['\"]\.\.\/\.\.\/core\/src|from ['\"]\.\.\/\.\.\/platform-node\/src|from ['\"]\.\.\/\.\.\/\.\.\/packages\/" apps packages >&2
  exit 1
fi

# 4) app packages must import explicit core subpaths (not broad root barrel)
if search_matches "from ['\"]@skillspp/core['\"]" apps >/dev/null; then
  echo "Boundary violation: apps must not import @skillspp/core root barrel. Use explicit @skillspp/core/* subpaths." >&2
  search_matches "from ['\"]@skillspp/core['\"]" apps >&2
  exit 1
fi

# 5) core root barrel must not export runtime internals
if search_matches "export \\* from \\\"\\.\\/runtime\\/|export \\* from \\\"\\.\\/sources\\/|export \\* from \\\"\\.\\/providers\\/|export \\* from \\\"\\.\\/contracts\\/runtime-types\\\"|export \\* from \\\"\\.\\/contracts\\/source-types\\\"" packages/core/src/index.ts >/dev/null; then
  echo "Boundary violation: @skillspp/core root barrel exports internal/runtime surfaces." >&2
  search_matches "export \\* from \\\"\\.\\/runtime\\/|export \\* from \\\"\\.\\/sources\\/|export \\* from \\\"\\.\\/providers\\/|export \\* from \\\"\\.\\/contracts\\/runtime-types\\\"|export \\* from \\\"\\.\\/contracts\\/source-types\\\"" packages/core/src/index.ts >&2
  exit 1
fi

# 6) no generated JS/d.ts files in package src directories
if list_files packages | filter_matches "/src/.*\\.(js|d\\.ts)$" >/dev/null; then
  echo "Boundary violation: generated .js/.d.ts files found under packages/*/src. Build outputs must go to dist/." >&2
  list_files packages | filter_matches "/src/.*\\.(js|d\\.ts)$" >&2
  exit 1
fi

# 7) forbid importing core intermediate barrels
if search_matches "from ['\"]@skillspp/core/(contracts|runtime|sources)['\"]" apps packages >/dev/null; then
  echo "Boundary violation: do not import @skillspp/core/contracts|runtime|sources barrels; use module-level subpaths." >&2
  search_matches "from ['\"]@skillspp/core/(contracts|runtime|sources)['\"]" apps packages >&2
  exit 1
fi

# 8) package export-surface and side-effect metadata checks
node <<'NODE'
const fs = require("node:fs");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const corePkg = readJson("packages/core/package.json");
const platformPkg = readJson("packages/platform-node/package.json");

assert(corePkg.sideEffects === false, "Boundary violation: packages/core must set sideEffects=false.");
assert(
  platformPkg.sideEffects === false,
  "Boundary violation: packages/platform-node must set sideEffects=false.",
);

const coreExportKeys = Object.keys(corePkg.exports || {}).sort();
const expectedCoreExportKeys = [
  ".",
  "./agents",
  "./commands",
  "./contracts/*",
  "./errors",
  "./events",
  "./lockfile",
  "./policy",
  "./results",
  "./runtime/*",
  "./skills",
  "./source-parser",
  "./source-resolution",
  "./sources/*",
  "./telemetry",
].sort();
assert(
  JSON.stringify(coreExportKeys) === JSON.stringify(expectedCoreExportKeys),
  `Boundary violation: packages/core exports must be exactly ${expectedCoreExportKeys.join(", ")}.`,
);

for (const [key, value] of Object.entries(corePkg.exports || {})) {
  const typesPath = value?.types || "";
  const jsPath = value?.default || "";
  assert(
    typesPath.startsWith("./dist/") && jsPath.startsWith("./dist/"),
    `Boundary violation: packages/core export ${key} must point to dist artifacts.`,
  );
}

const platformExportKeys = Object.keys(platformPkg.exports || {}).sort();
assert(
  JSON.stringify(platformExportKeys) === JSON.stringify(["."]),
  "Boundary violation: packages/platform-node exports must expose only root entry.",
);
NODE

echo "Workspace boundary checks passed."
