import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SUPPORTED_TERRITORIES } from './territories.mjs';
if (!process.argv[2]) throw new Error('Provide the consumer JSON output path');
const source = await readFile(new URL('./territories.mjs', import.meta.url));
await writeFile(process.argv[2], JSON.stringify({ schemaVersion: 1,
  sourceRepository: 'https://github.com/craetsodom-hub/whoseiptv', sourceFile: 'scripts/territories.mjs',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  territories: [...SUPPORTED_TERRITORIES].sort() }, null, 2) + '\n');
