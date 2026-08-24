import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLaLiga, parseLigue1Match, parseSkyPremierLeague, resolveOfficialFootball } from "../scripts/official-football.mjs";

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
  const records = [{ idEvent: "real-1", strEvent: "Elche CF vs FC Barcelona", strTimeStamp: "2026-08-23 19:30:00" }];
  const result = resolveOfficialFootball(candidates, records, new Map(), Date.parse("2026-08-23T18:00:00Z") / 1000);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "tsdb-real-1");
  assert.equal(result[0].broadcasterEvidence.eventMatched, true);
  assert.deepEqual(result[0].broadcasts.map((item) => item.channelName), ["Orange Fútbol 1", "Movistar Plus+", "Movistar LALIGA"]);
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
