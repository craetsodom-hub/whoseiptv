import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const validEntry = (entry) =>
  typeof entry?.query === "string" && entry.query.length > 0 &&
  typeof entry?.territory === "string" && /^[A-Z]{2}$/.test(entry.territory);

test("keeps broad, valid, and duplicate-free country configuration per sport", async () => {
  const football = JSON.parse(await readFile(new URL("../config/football-countries.json", import.meta.url)));
  const sports = JSON.parse(await readFile(new URL("../config/sport-countries.json", import.meta.url)));

  assert.ok(football.length >= 70);
  assert.deepEqual(Object.keys(sports).sort(), ["basketball", "cricket", "formula1", "rugby", "tennis"]);
  assert.deepEqual(sports.formula1, []);

  for (const entries of [football, sports.basketball, sports.tennis, sports.cricket, sports.rugby]) {
    assert.ok(entries.length >= 16);
    assert.ok(entries.every(validEntry));
    assert.equal(new Set(entries.map((entry) => `${entry.query}|${entry.territory}`)).size, entries.length);
  }
});
