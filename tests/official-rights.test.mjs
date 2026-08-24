import test from "node:test";
import assert from "node:assert/strict";
import rights from "../config/official-event-broadcasters.json" with { type: "json" };
import { attachAllEventDestinations, augmentWithOfficialRights, coverageReport, matchingRights, validateOfficialRightsConfig } from "../scripts/official-rights.mjs";
import { canonicalChannelIdentity, cleanAliases } from "../scripts/broadcast/normalize.mjs";
import { collectAdaptersSafely, matchesEvent, mergeExactBroadcasts, resolveExactBroadcasts } from "../scripts/broadcast/resolver.mjs";
import { SUPPORTED_TERRITORIES } from "../scripts/territories.mjs";
import { expandTerritories } from "../scripts/broadcast/territory-regions.mjs";

const kickoff = Math.floor(Date.parse("2026-08-23T15:00:00Z") / 1000);
const event = (competition = "Premier League", season = "2026/27") => ({
  competition, season, startUtcEpochSeconds: kickoff, homeTeam: { name: "Liverpool" }, awayTeam: { name: "Arsenal" }, broadcasts: []
});

test("validates the season-aware multi-competition rights catalog", () => {
  assert.equal(validateOfficialRightsConfig(rights), true);
  assert.deepEqual(rights.competitions.map((item) => item.id), ["fifa-world-cup", "premier-league", "uefa-champions-league", "laliga", "bundesliga", "ligue-1", "mls", "leagues-cup"]);
});

test("rights metadata never becomes a playlist-match broadcast and never leaks", () => {
  const events = [event(), event("LaLiga"), event("UEFA Champions League"), event("Premier League 2")];
  augmentWithOfficialRights(events, rights);
  assert.equal(events.every((item) => item.broadcasts.length === 0), true);
  assert(events[0].broadcastRights.some((item) => item.territory === "GB" && item.holders.some((holder) => holder.name === "Sky Sports")));
  assert(!events[0].broadcastRights.some((item) => item.holders.some((holder) => holder.name === "Paramount+")));
  assert(events[1].broadcastRights.some((item) => item.territory === "ES"));
  assert(events[2].broadcastRights.some((item) => item.holders.some((holder) => holder.name === "Paramount+")));
  assert.equal(events[3].broadcastRights, undefined);
});

test("all-event services require explicit all-match evidence", () => {
  const withoutProof = structuredClone(rights);
  delete withoutProof.competitions.find((item) => item.id === "laliga").cycles[0].allEventDestinations[0].allMatches;
  const target = event("LaLiga");
  attachAllEventDestinations([target], withoutProof);
  assert(!target.broadcasts.some((item) => item.channelName === "ESPN+"));
  assert(target.broadcasts.some((item) => item.channelName === "DAZN"));
});

test("generic rights never manufacture a numbered channel", () => {
  const target = event("LaLiga");
  augmentWithOfficialRights([target], rights);
  assert(target.broadcastRights.some((right) => right.holders.some((holder) => holder.name === "beIN Sports")));
  assert(!target.broadcasts.some((item) => /^beIN SPORTS \d+$/i.test(item.channelName)));
});

test("expired and wrong-season rights are ignored", () => {
  assert.equal(matchingRights({ ...event(), startUtcEpochSeconds: Math.floor(Date.parse("2029-08-23T15:00:00Z") / 1000), season: "2029/30" }, rights).length, 0);
  assert.equal(matchingRights({ ...event(), season: "2024/25" }, rights).length, 0);
});

test("regional scopes expand exactly and support audited exclusions", () => {
  assert(expandTerritories({ region: "MENA" }).includes("MA"));
  assert(!expandTerritories({ region: "MENA" }).includes("FR"));
  const southAmericaWithoutBrazil = expandTerritories({ region: "SOUTH_AMERICA", exclude: ["BR"] });
  assert(southAmericaWithoutBrazil.includes("AR"));
  assert(!southAmericaWithoutBrazil.includes("BR"));
});

test("canonical aliases collapse formatting variants but preserve numbered channels", () => {
  assert.equal(canonicalChannelIdentity("UK | Sky Sports Main Event FHD"), canonicalChannelIdentity("SkySports Main Event"));
  assert.equal(canonicalChannelIdentity("beIN SPORTS HD 1"), canonicalChannelIdentity("beIN Sports 1 HD"));
  assert.notEqual(canonicalChannelIdentity("beIN Sports 1"), canonicalChannelIdentity("beIN Sports 2"));
  assert.deepEqual(cleanAliases("Sky Sports Main Event", ["UK Sky Sports Main Event", "Sky Sports Main Event HD", "Sky Sports Premier League"]), ["UK Sky Sports Main Event", "Sky Sports Main Event HD"]);
});

test("source priority is deterministic and official exact data overrides weaker exclusive data", () => {
  const weak = { channelName: "Wrong Sports", aliases: [], territory: "GB", confirmed: true, sourceType: "source-event", exclusive: true };
  const schedule = { channelName: "Sky Sports Premier League", aliases: [], territory: "GB", sourceType: "official-broadcaster-schedule", exclusive: true };
  const exact = { channelName: "Sky Sports Main Event", aliases: ["UK Sky Sports Main Event"], territory: "GB", sourceType: "official-event", exclusive: true };
  assert.deepEqual(mergeExactBroadcasts(weak, schedule, exact).map((item) => item.channelName), ["Sky Sports Main Event"]);
  assert.deepEqual(mergeExactBroadcasts(exact, weak, schedule).map((item) => item.channelName), ["Sky Sports Main Event"]);
});

test("duplicate formats collapse to aliases while distinct channel numbers survive", () => {
  const merged = mergeExactBroadcasts(
    { channelName: "beIN Sports 1", aliases: [], territory: "MA", sourceType: "official-event" },
    { channelName: "MA | beIN Sports 1 HD", aliases: [], territory: "MA", sourceType: "official-broadcaster-schedule" },
    { channelName: "beIN Sports 2", aliases: [], territory: "MA", sourceType: "official-event" }
  );
  assert.equal(merged.length, 2);
  assert(merged.find((item) => item.channelName === "beIN Sports 1").aliases.includes("MA | beIN Sports 1 HD"));
});

test("a service alias cannot become an alias for every numbered channel", () => {
  assert.deepEqual(cleanAliases("beIN Sports", ["beIN Sports 1", "beIN Sports 2"]), []);
  assert.deepEqual(cleanAliases("beIN Sports 1", ["beIN Sports HD 1", "beIN Sports 2"]), ["beIN Sports HD 1"]);
});

test("exact-event matching requires competition, both teams, and time", () => {
  const candidate = { competition: "Premier League", homeTeam: "Arsenal", awayTeam: "Liverpool", startUtcEpochSeconds: kickoff + 300 };
  assert.equal(matchesEvent(event(), candidate), true);
  assert.equal(matchesEvent(event(), { ...candidate, awayTeam: "Everton" }), false);
  assert.equal(matchesEvent(event(), { ...candidate, competition: "FA Cup" }), false);
  assert.equal(matchesEvent(event(), { ...candidate, startUtcEpochSeconds: kickoff + 3600 }), false);
  assert.equal(matchesEvent(event(), { ...candidate, homeTeam: "Liverpool", awayTeam: "Liverpool" }), false);
  assert.equal(matchesEvent({ ...event(), homeTeam: { name: "Inter" }, awayTeam: { name: "Milan" } }, { ...candidate, homeTeam: "Internazionale", awayTeam: "Milan" }), true);
  assert.equal(matchesEvent({ ...event("Spanish La Liga"), homeTeam: { name: "Real Madrid" }, awayTeam: { name: "Real Sociedad" } }, {
    competition: "LALIGA EA SPORTS", homeTeam: "Real Madrid", awayTeam: "Real Sociedad", startUtcEpochSeconds: kickoff
  }), true);
});

test("adapter outage fails safely without discarding successful candidates", async () => {
  const failures = [];
  const candidates = await collectAdaptersSafely([
    { id: "good", collect: async () => [{ competition: "Premier League" }] },
    { id: "down", collect: async () => { throw new Error("offline"); } }
  ], {}, (id) => failures.push(id));
  assert.equal(candidates.length, 1);
  assert.deepEqual(failures, ["down"]);
});

test("official schedules are checked against territorial rights before enrichment", () => {
  const target = event();
  augmentWithOfficialRights([target], rights);
  const base = { competition: "Premier League", homeTeam: "Liverpool", awayTeam: "Arsenal", startUtcEpochSeconds: kickoff };
  resolveExactBroadcasts([target], [
    { ...base, broadcasts: [{ channelName: "Sky Sports Main Event", territory: "GB", sourceType: "official-broadcaster-schedule" }] },
    { ...base, broadcasts: [{ channelName: "Invented Sports 1", territory: "GB", sourceType: "official-broadcaster-schedule" }] }
  ]);
  assert(target.broadcasts.some((item) => item.channelName === "Sky Sports Main Event"));
  assert(!target.broadcasts.some((item) => item.channelName === "Invented Sports 1"));
});

test("resolver continues with later providers after a successful provider", () => {
  const target = event();
  const base = { competition: "Premier League", homeTeam: "Liverpool", awayTeam: "Arsenal", startUtcEpochSeconds: kickoff };
  resolveExactBroadcasts([target], [
    { ...base, broadcasts: [{ channelName: "First Party One", territory: "US", sourceType: "official-event" }] },
    { ...base, broadcasts: [{ channelName: "First Party Two", territory: "CA", sourceType: "official-event" }] }
  ]);
  assert.deepEqual(target.broadcasts.map((item) => item.channelName).sort(), ["First Party One", "First Party Two"]);
});

test("global exact-event collections retain more than 64 territories deterministically", () => {
  const territories = [...SUPPORTED_TERRITORIES].slice(0, 130);
  const broadcasts = territories.map((territory) => ({ channelName: `Official ${territory}`, aliases: [], territory, sourceType: "official-event" }));
  const merged = mergeExactBroadcasts(broadcasts);
  assert.equal(merged.length, 130);
  assert.deepEqual(new Set(merged.map((item) => item.territory)).size, 130);
});

test("coverage reports rights-only, exact-event, and unresolved territories honestly", () => {
  const reports = coverageReport(rights, [{ ...event(), broadcasts: [{ territory: "GB", sourceType: "official-event", destinationType: "linear" }, { territory: "MA", sourceType: "source-event" }] }], ["GB", "JP"], kickoff);
  const premierLeague = reports.find((item) => item.id === "premier-league");
  assert(premierLeague.exactEventTerritories.includes("GB"));
  assert(premierLeague.exactLinearTerritories.includes("GB"));
  assert(premierLeague.sourceEventTerritories.includes("MA"));
  assert(!premierLeague.rightsOnlyTerritories.includes("GB"));
  assert(premierLeague.unresolvedTerritories.includes("JP"));
  const laliga = reports.find((item) => item.id === "laliga");
  assert.deepEqual(laliga.exactServiceTerritories, ["FR", "US"]);
});
