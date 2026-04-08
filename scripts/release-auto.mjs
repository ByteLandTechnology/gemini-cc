#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import { prepareAutomaticRelease } from "./lib/release.mjs";

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    root: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--write") {
      options.write = true;
      continue;
    }
    if (token === "--root" && argv[index + 1]) {
      options.root = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = prepareAutomaticRelease(options.root, {
    write: options.write,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.releaseNeeded) {
    console.log("No release needed.");
    return;
  }

  const action = options.write ? "Prepared" : "Planned";
  console.log(
    `${action} release ${result.tagName} from ${result.commits.length} releasable commit(s).`,
  );
  console.log(`Current version: ${result.currentVersion}`);
  console.log(`Next version: ${result.nextVersion}`);
  console.log(`Bump: ${result.bump}`);
  if (result.updatedFiles.length > 0) {
    console.log(`Updated files: ${result.updatedFiles.length}`);
  }
}

main();
