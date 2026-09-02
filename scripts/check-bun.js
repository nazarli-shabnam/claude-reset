#!/usr/bin/env node
// The test suite uses Bun's built-in test runner (`import { ... } from "bun:test"`).
// Fail early with an actionable message instead of a cryptic "bun: not found".
const { spawnSync } = require("child_process");

const found = spawnSync("bun", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });

if (found.error || found.status !== 0) {
  console.error(
    "\n  This project's tests run on Bun, which was not found on your PATH.\n" +
    "  Install it from https://bun.sh, then re-run `npm test` (or just `bun test`).\n"
  );
  process.exit(1);
}
