import test from "node:test";
import assert from "node:assert/strict";
import { competitionPopularity, footballImportance, matchSignificance, normalizeFootballName } from "../scripts/football-ranking.mjs";
import { selectEvents } from "../scripts/feed-core.mjs";

let id = 0;
function fixture(competition, home, away, start = 1_800_000_000, titleSuffix = "") {
  return { id: `f-${id++}`, sport: "football", competition, title: `${home} vs ${away}${titleSuffix}`, homeTeam: { name: home }, awayTeam: { name: away }, startUtcEpochSeconds: start };
}

test("normalization and competition matching avoid substring collisions", () => {
  assert.equal(normalizeFootballName("Bayern München"), "bayern munchen");
  assert.equal(competitionPopularity("Premier League"), 91);
  assert.equal(competitionPopularity("Premier League 2026-2027"), 91);
  assert.equal(competitionPopularity("Premier League 2"), 35);
  assert.equal(competitionPopularity("Women's Premier League"), 20);
  assert.equal(competitionPopularity("U21 Bundesliga"), 20);
});

test("both clubs strongly correct domestic competition ordering", () => {
  const lowPremier = fixture("Premier League", "Brentford", "Burnley");
  for (const major of [
    fixture("Bundesliga", "Bayern Munich", "Borussia Dortmund"),
    fixture("Serie A", "Inter Milan", "Juventus"),
    fixture("Ligue 1", "Paris Saint-Germain", "Marseille"),
    fixture("Brasileirão Série A", "Flamengo", "Palmeiras"),
    fixture("Saudi Pro League", "Al Hilal", "Al Nassr")
  ]) assert(footballImportance(major) > footballImportance(lowPremier));
});

test("same-league order uses both sides", () => {
  const elite = fixture("Bundesliga", "Bayern Munich", "Borussia Dortmund");
  const mixed = fixture("Bundesliga", "Bayern Munich", "Heidenheim");
  const small = fixture("Bundesliga", "Heidenheim", "Bochum");
  assert(footballImportance(elite) > footballImportance(mixed));
  assert(footballImportance(mixed) > footballImportance(small));
});

test("competition remains primary and international tournaments dominate friendlies", () => {
  assert(footballImportance(fixture("UEFA Champions League", "Unknown A", "Unknown B")) > footballImportance(fixture("Regional League", "Inter Miami", "Unknown")));
  assert(footballImportance(fixture("FIFA World Cup", "Brazil", "Argentina")) > footballImportance(fixture("International Friendly", "Brazil", "Argentina")));
  assert(footballImportance(fixture("UEFA European Championship", "France", "Spain")) > footballImportance(fixture("UEFA Nations League", "France", "Spain")));
  assert(footballImportance(fixture("Copa América", "Brazil", "Argentina")) > footballImportance(fixture("International Friendly", "Brazil", "Argentina")));
});

test("significance is bounded and ordered", () => {
  const ordinary = fixture("FA Cup", "Unknown A", "Unknown B");
  const semifinal = fixture("FA Cup", "Unknown A", "Unknown B", ordinary.startUtcEpochSeconds, " - Semifinal");
  const final = fixture("FA Cup", "Unknown A", "Unknown B", ordinary.startUtcEpochSeconds, " - Final");
  assert.equal(matchSignificance(final), 4);
  assert(footballImportance(final) > footballImportance(semifinal));
  assert(footballImportance(semifinal) > footballImportance(ordinary));
  assert(footballImportance(fixture("UEFA Champions League", "Real Madrid", "Liverpool")) > footballImportance(fixture("Regional League", "Unknown A", "Unknown B", ordinary.startUtcEpochSeconds, " - Final")));
});

test("importance selection happens before the 100-event cap and kickoff is last tie-breaker", () => {
  const early = Array.from({ length: 105 }, (_, index) => fixture("Regional League", `Local ${index}`, `Village ${index}`, 1_800_000_000 + index));
  const major = fixture("UEFA Champions League", "Real Madrid", "Liverpool", 1_800_090_000);
  const selected = selectEvents([...early, major]);
  assert.equal(selected.length, 100);
  assert(selected.includes(major));
  assert(!selected.includes(early[104]));

  const tiedEarly = fixture("Bundesliga", "Bayern Munich", "Borussia Dortmund", 1_800_000_001);
  const tiedLate = fixture("Bundesliga", "Bayern Munich", "Borussia Dortmund", 1_800_000_002);
  assert.deepEqual(selectEvents([tiedLate, tiedEarly]), [tiedEarly, tiedLate]);
});

test("Champions League night ranks UCL above domestic and global league fixtures", () => {
  const events = [
    fixture("Brasileirão Série A", "Flamengo", "Palmeiras"),
    fixture("Saudi Pro League", "Al Hilal", "Al Nassr"),
    fixture("Premier League", "Brentford", "Burnley"),
    fixture("UEFA Champions League", "Arsenal", "Paris Saint-Germain"),
    fixture("UEFA Champions League", "Barcelona", "Bayern Munich")
  ];
  assert(selectEvents(events).slice(0, 2).every((event) => event.competition === "UEFA Champions League"));
});
