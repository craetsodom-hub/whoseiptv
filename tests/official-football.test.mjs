import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLaLiga, parseLigue1Match, parseMlsMatch, parseSkyPremierLeague, resolveOfficialFootball } from "../scripts/official-football.mjs";
import { matchesEvent } from "../scripts/broadcast/resolver.mjs";

const fixture = (name) => readFile(new URL(`fixtures/official-football/${name}`, import.meta.url), "utf8");

test("parses exact Sky channels from their real fixture row", async () => {
  const events = parseSkyPremierLeague(await fixture("sky-premier-league.html"), { "Sky Sports+": ["Sky Sports Plus UK"] }, new Date("2026-08-23T00:00:00Z"));
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Sunderland vs Fulham");
  assert.deepEqual(events[0].broadcasts.map((item) => item.channelName), ["Sky Sports+"]);
  assert.deepEqual(events[1].broadcasts.map((item) => item.channelName), ["Sky Sports Main Event", "Sky Sports Premier League"]);
});

test("keeps every observed LaLiga operator distinct and in its match row", async () => {
  const events = parseLaLiga(await fixture("laliga-next-data.html"));
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Athletic Club vs Sevilla FC");
  assert.deepEqual(events[0].broadcasts.map((item) => item.channelName), ["DAZN EN ABIERTO", "Movistar LALIGA"]);
  assert.equal(events[1].title, "Elche CF vs FC Barcelona");
  assert.deepEqual(events[1].broadcasts.map((item) => item.channelName), ["Orange Fútbol 1", "Movistar Plus+", "Movistar LALIGA"]);
});

test("resolves an official exact destination to the corresponding source event", async () => {
  const candidates = parseLaLiga(await fixture("laliga-next-data.html"));
  const records = [{ idEvent: "real-1", strSport: "Soccer", strEvent: "Elche CF vs FC Barcelona", strLeague: "LaLiga", strTimeStamp: "2026-08-23 19:30:00" }];
  const result = resolveOfficialFootball(candidates, records, new Map(), Date.parse("2026-08-23T18:00:00Z") / 1000);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "tsdb-real-1");
  assert.equal(result[0].broadcasterEvidence.eventMatched, true);
  assert.deepEqual(result[0].broadcasts.map((item) => item.channelName), ["Orange Fútbol 1", "Movistar Plus+", "Movistar LALIGA"]);
  assert(result[0].broadcasts.every((item) => item.eventMatchingMethod.startsWith("ordered:")));
});

test("official football source linking rejects weak and ambiguous fixture identities", () => {
  const startUtcEpochSeconds = Date.parse("2026-08-23T19:00:00Z") / 1000;
  const candidate = {
    sourceId: "official-unresolved",
    source: "test",
    sourceUrl: "https://example.test/fixture",
    title: "North Athletic United vs Exact Opponent",
    competition: "LaLiga",
    homeTeam: "North Athletic United",
    awayTeam: "Exact Opponent",
    startUtcEpochSeconds,
    broadcasts: [{ channelName: "Exact Channel", territory: "ES", sourceType: "official-event" }]
  };
  const weak = resolveOfficialFootball([candidate], [{
    idEvent: "weak", strSport: "Soccer", strEvent: "South Athletic United vs Exact Opponent", strLeague: "LaLiga", strTimeStamp: "2026-08-23 19:00:00"
  }], new Map(), startUtcEpochSeconds);
  assert.equal(weak[0].id, "official-unresolved");
  assert.equal(weak[0].broadcasterEvidence.eventMatched, false);

  const ambiguous = resolveOfficialFootball([{ ...candidate, homeTeam: "Exact Home", title: "Exact Home vs Exact Opponent" }], [
    { idEvent: "one", strSport: "Soccer", strEvent: "Exact Home vs Exact Opponent", strLeague: "LaLiga", strTimeStamp: "2026-08-23 19:00:00" },
    { idEvent: "two", strSport: "Soccer", strEvent: "Exact Home vs Exact Opponent", strLeague: "LaLiga", strTimeStamp: "2026-08-23 19:00:00" }
  ], new Map(), startUtcEpochSeconds);
  assert.equal(ambiguous[0].id, "official-unresolved");
  assert.equal(ambiguous[0].broadcasterEvidence.eventMatched, false);

  const wrongSport = resolveOfficialFootball([{ ...candidate, homeTeam: "Exact Home", title: "Exact Home vs Exact Opponent" }], [{
    idEvent: "basketball", __sport: "basketball", strEvent: "Exact Home vs Exact Opponent", strLeague: "LaLiga", strTimeStamp: "2026-08-23 19:00:00"
  }], new Map(), startUtcEpochSeconds);
  assert.equal(wrongSport[0].id, "official-unresolved");
  assert.equal(wrongSport[0].broadcasterEvidence.eventMatched, false);
});

test("parses a numbered Ligue 1+ channel from the official match object", async () => {
  const events = parseLigue1Match(await fixture("ligue1-match.json"), { "Ligue 1+ 2": ["FR Ligue 1 Plus 2"] });
  assert.equal(events[0].title, "Stade Rennais FC vs Paris Saint-Germain");
  assert.equal(events[0].startUtcEpochSeconds, Date.parse("2026-08-23T18:45:00.000Z") / 1000);
  assert.deepEqual(events[0].broadcasts, [{
    channelName: "Ligue 1+ 2",
    aliases: ["FR Ligue 1 Plus 2"],
    territory: "FR",
    confirmed: true,
    sourceType: "official-event",
    sourceUrl: "https://ma-api.ligue1.fr/championship-match/l1_championship_match_73827",
    matchingMethod: "official-match-id"
  }]);
});

test("parses the MLS match API's exact Apple TV event service", async () => {
  const candidates = parseMlsMatch(await fixture("mls-match.json"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, "Club León vs Real Salt Lake");
  assert.equal(candidates[0].startUtcEpochSeconds, Date.parse("2026-08-26T02:30:00Z") / 1000);
  assert.deepEqual(candidates[0].broadcasts.map((item) => [item.channelName, item.territory, item.sourceType, item.matchingMethod]), [[
    "Apple TV", "US", "official-event", "mls-match-api-broadcaster"
  ]]);
  assert.deepEqual(parseMlsMatch(JSON.stringify([{ ...(JSON.parse(await fixture("mls-match.json"))[0]), delayedMatch: true }])), []);
  const placeholder = JSON.parse(await fixture("mls-match.json"));
  placeholder[0].home.fullName = "TBC Home";
  assert.deepEqual(parseMlsMatch(JSON.stringify(placeholder)), []);
  const event = { competition: "Leagues Cup", startUtcEpochSeconds: candidates[0].startUtcEpochSeconds, homeTeam: { name: "Club León" }, awayTeam: { name: "Real Salt Lake" } };
  assert(matchesEvent(event, candidates[0]));
  assert(!matchesEvent({ ...event, awayTeam: { name: "Chicago Fire" } }, candidates[0]));
  assert(!matchesEvent({ ...event, competition: "MLS" }, candidates[0]));
  assert(!matchesEvent({ ...event, startUtcEpochSeconds: event.startUtcEpochSeconds + 3600 }, candidates[0]));
});

test("real unresolved source snapshots contain no fixture-level channel to publish", async () => {
  const premierLeague = await fixture("premier-league-page.html");
  const ligue1 = await fixture("ligue1-next-data.html");
  const bundesliga = JSON.parse(await fixture("bundesliga-ng-state.json"));
  const bein = JSON.parse(await fixture("bein-next-data.json"));
  assert.equal(/Sky Sports|TNT Sports/.test(premierLeague), false);
  assert.equal(/Ligue 1\+\s*\d/.test(ligue1), false);
  assert.equal("activeBroadcaster" in bundesliga || "activeBroadcasters" in bundesliga, false);
  assert.deepEqual(bein.props.pageProps.initialState.channelApi.queries, {});
});
