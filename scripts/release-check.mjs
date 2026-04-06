#!/usr/bin/env node

import { collectReleaseIssues } from "./lib/release.mjs";

function parseArgs(argv) {
  const options = {
    tag: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--tag") {
      options.tag = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const report = collectReleaseIssues(undefined, options);

if (report.issues.length > 0) {
  console.error("Release checks failed:");
  for (const issue of report.issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`Release checks passed for gemini v${report.version}.`);
