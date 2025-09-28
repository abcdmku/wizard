#!/usr/bin/env node
/**
 * Node.js CLI wizard example - demonstrates usage without React
 * Simulates an order processing saga with multiple steps
 */

import { runInteractiveCLI } from "./cli/interactive";
import { runAutomatedSaga } from "./saga/automated";

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "cli";

  if (mode === "auto") {
    await runAutomatedSaga();
  } else {
    await runInteractiveCLI();
  }
}

main().catch(console.error);