#!/usr/bin/env node
/**
 * Runs every Playwright suite, then builds the results table whatever the
 * outcome: red tests are expected, so the exit code is the table's.
 *
 *   node scripts/test-report.mjs [playwright args]
 *
 * A script rather than `playwright test; node ...` because npm runs scripts
 * through cmd.exe on Windows, which has no `;` separator.
 */

import { spawnSync } from "node:child_process";

const run = (command, args) =>
  spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" }).status;

run("npx", ["playwright", "test", ...process.argv.slice(2)]);
process.exit(run(process.execPath, ["scripts/results-table.mjs"]) ?? 1);
