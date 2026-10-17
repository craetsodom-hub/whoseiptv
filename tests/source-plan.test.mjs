import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { scheduleRequestCount, scheduledCountriesForSport } from "../scripts/source-plan.mjs";

const football = JSON.parse(await readFile(new URL("../config/football-countries.json", import.meta.url), "utf8"));
const bySport = JSON.parse(await readFile(new URL("../config/sport-countries.json", import.meta.url), "utf8"));
const sports = [
  { id: "football" }, { id: "basketball" }, { id: "tennis" },
  { id: "formula1" }, { id: "cricket" }, { id: "rugby" }
];

test("priority markets stay in every run and the primary schedule plan stays bounded", () => {
  const epoch = Date.parse("2026-10-17T00:00:00Z") / 1000;
  const footballRun = scheduledCountriesForSport({ id: "football" }, football, epoch);
  assert.deepEqual(footballRun.slice(0, 6).map((item) => item.territory), ["GB", "US", "ES", "FR", "DE", "IT"]);
  assert.equal(footballRun.length, 7);
  assert.equal(scheduleRequestCount(sports, football, bySport, epoch), 72);
});

test("secondary markets rotate without changing the request budget", () => {
  const first = Date.parse("2026-10-17T00:00:00Z") / 1000;
  const second = first + 3 * 60 * 60;
  const firstRun = scheduledCountriesForSport({ id: "football" }, football, first);
  const secondRun = scheduledCountriesForSport({ id: "football" }, football, second);
  assert.notEqual(firstRun.at(-1).query, secondRun.at(-1).query);
  assert.equal(firstRun.length, secondRun.length);
});
