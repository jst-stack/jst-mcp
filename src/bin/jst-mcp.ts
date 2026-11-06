#!/usr/bin/env node
import { main } from "../composition/mcp.js";
import { runInit } from "../composition/install.js";

async function run(): Promise<void> {
  if (process.argv[2] === "init") {
    const result = await runInit({ dryRun: process.argv.includes("--dry-run") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  await main();
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
