#!/usr/bin/env node

import { buildReleaseBundle } from "./lib/release.mjs";

const result = buildReleaseBundle();
console.log(`Release bundle staged at ${result.bundleDir}`);
console.log(`Release tarball written to ${result.tarballPath}`);
console.log(`Release checksum written to ${result.checksumPath}`);
console.log(`Release notes written to ${result.releaseNotesPath}`);
console.log(`Release manifest written to ${result.manifestPath}`);
