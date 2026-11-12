/**
 * Writes fixtures/hosted-api-runs.v1.4.json from the runs a Site integration
 * harness made through the real API (site-app/scripts/integration-check.mjs
 * writes them to site-app/.sites-runtime/run-schema-fixtures.json): every run
 * that pins a registered dataset card, which the engine job then validates
 * without running the harness. The capture is frozen like hosted-runs.v1.1.json;
 * rerun it only to replace the capture.
 *
 *   node schemas/capture-api-fixtures.mjs [path/to/run-schema-fixtures.json]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] ?? resolve(directory, '../site-app/.sites-runtime/run-schema-fixtures.json'));
const runs = JSON.parse(readFileSync(source, 'utf8'));
const pinned = runs.filter(run => run.manifest?.dataset?.cardPin);
assert.ok(pinned.some(run => run.state === 'succeeded'), 'The harness output holds no succeeded card-pinned run');
for (const run of pinned) {
  const pin = run.manifest.dataset.cardPin;
  // The record hash is the SHA-256 of the stored card text (recordStatement).
  assert.equal(createHash('sha256').update(JSON.stringify(pin.card)).digest('hex'), pin.sha256, `${run.id}: card pin hash`);
  assert.equal(pin.card.artifactSha256, run.manifest.dataset.sha256, `${run.id}: card describes other bytes`);
}
const target = resolve(directory, 'fixtures/hosted-api-runs.v1.4.json');
writeFileSync(target, JSON.stringify(pinned, null, 2) + '\n');
console.log(`Wrote ${pinned.length} card-pinned API runs (${pinned.map(run => run.state).join(', ')}) to ${target}`);
