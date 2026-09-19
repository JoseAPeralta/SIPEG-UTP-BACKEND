import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openApiDocument } from './openapi.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputPath = resolve(repoRoot, 'openapi.json');

export const serializeOpenApiDocument = (): string =>
  `${JSON.stringify(openApiDocument, null, 2)}\n`;

const main = (): void => {
  const serialized = serializeOpenApiDocument();
  const checkOnly = process.argv.includes('--check');

  if (checkOnly) {
    let committed: string;

    try {
      committed = readFileSync(outputPath, 'utf8');
    } catch {
      console.error('openapi.json is missing. Run pnpm docs:generate and commit the result.');
      process.exitCode = 1;
      return;
    }

    if (committed !== serialized) {
      console.error('openapi.json is out of date. Run pnpm docs:generate and commit the result.');
      process.exitCode = 1;
      return;
    }

    console.log('openapi.json is up to date.');
    return;
  }

  writeFileSync(outputPath, serialized);
  console.log(`openapi.json written to ${outputPath}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
