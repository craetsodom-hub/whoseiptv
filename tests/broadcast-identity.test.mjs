import test from "node:test";
import assert from "node:assert/strict";
import rights from "../config/official-event-broadcasters.json" with { type: "json" };
import { createParticipantIdentityRegistry, participantIdentityEvidence } from "../scripts/broadcast/identity.mjs";
import { matchesEvent, resolveExactBroadcasts } from "../scripts/broadcast/resolver.mjs";
import { augmentWithOfficialRights } from "../scripts/official-rights.mjs";

const kickoff = Math.floor(Date.parse("2026-08-23T19:00:00Z") / 1000);
const fixture = (home, away, options = {}) => ({
  id: options.id ?? `${home}-${away}`,
  sport: options.sport ?? "football",
  competition: options.competition ?? "LaLiga",
  season: "2026/27",
  homeTeam: typeof home === "string" ? { name: home } : home,
  awayTeam: typeof away === "string" ? { name: away } : away,
  startUtcEpochSeconds: options.start ?? kickoff,
  broadcasts: []
});
const row = (home, away, options = {}) => ({
  sport: options.sport ?? "football",
  competition: options.competition ?? "LaLiga",
  homeTeam: home,
  awayTeam: away,
  startUtcEpochSeconds: options.start ?? kickoff,
  broadcasts: options.broadcasts ?? []
});

test("canonical participant identities cover official/common, organization, accents, abbreviations, order and localization", () => {
  assert(matchesEvent(fixture("Barcelona", "Athletic Bilbao"), row("Barcelona", "Athletic Club")));
  assert(matchesEvent(fixture("FC Barcelona", "Getafe CF"), row("Barcelona", "Getafe")));
  assert(matchesEvent(fixture("Deportivo Alavés", "Fenerbahçe"), row("Deportivo Alaves", "Fenerbahce")));
  assert(matchesEvent(fixture("Manchester United", "Paris Saint-Germain"), row("Manchester Utd", "PSG")));
  assert(matchesEvent(fixture("Red Bull Salzburg", "Real Madrid"), row("Salzburg Red Bull", "Real Madrid")));
  assert(matchesEvent(fixture("Spain National Team", "France"), row("Spain", "France")));
  assert(matchesEvent(fixture("Bayern München", "RB Leipzig", { competition: "Bundesliga" }), row("Bayern Munich", "RasenBallsport Leipzig", { competition: "German Bundesliga" })));
});

test("source IDs and source-provided aliases resolve deterministically while conflicting IDs reject", () => {
  const target = fixture(
    { name: "Renamed Home", sourceIds: { provider: "10" } },
    { name: "Exact Away", aliases: ["Away Localized"] }
  );
  assert(matchesEvent(target, row(
    { name: "Old Sponsor Home", sourceIds: { provider: "10" } },
    { name: "Away Localized" }
  )));
  assert(!matchesEvent(target, row(
    { name: "Renamed Home", sourceIds: { provider: "11" } },
    { name: "Away Localized" }
  )));

  assert.equal(participantIdentityEvidence(
    { name: "Provider A Name", sourceIds: { "provider-a": "42" } },
    { name: "Provider B Name", sourceIds: { "provider-b": "42" } },
    "football"
  ), null);

  const mapped = createParticipantIdentityRegistry({ participants: [{
    id: "mapped-club",
    sport: "football",
    type: "club",
    country: "GB",
    names: ["Mapped Club"],
    sourceIds: { "provider-a": "42", "provider-b": "42" }
  }] });
  assert.equal(participantIdentityEvidence(
    { name: "Provider A Name", participantType: "club", country: "GB", sourceIds: { "provider-a": "42" } },
    { name: "Provider B Name", participantType: "club", country: "GB", sourceIds: { "provider-b": "42" } },
    "football",
    mapped
  )?.method, "canonical-participant-alias");
  assert.equal(participantIdentityEvidence(
    { name: "Blank A", source: " ", sourceId: "42" },
    { name: "Blank B", source: " ", sourceId: "42" },
    "football"
  ), null);
  assert.equal(participantIdentityEvidence(
    { name: "Empty A", source: "provider", sourceId: " " },
    { name: "Empty B", source: "provider", sourceId: " " },
    "football"
  ), null);
});

test("unordered pairs work, but competition and kickoff remain mandatory", () => {
  const target = fixture("Barcelona", "Athletic Bilbao");
  assert(matchesEvent(target, row("Athletic Club", "Barcelona")));
  assert(!matchesEvent(target, row("Athletic Club", "Barcelona", { competition: "Copa del Rey" })));
  assert(!matchesEvent(target, row("Athletic Club", "Barcelona", { start: kickoff + 16 * 60 })));
});

test("one exact opponent can support conservative multi-token equivalence", () => {
  assert(matchesEvent(
    fixture("Exact Opponent", "Sporting Kansas City"),
    row("Exact Opponent", "Kansas City Sporting Association")
  ));
});

test("generic overlap, team qualifiers, locations, sports and competitions never cross-match", () => {
  assert(!matchesEvent(fixture("Exact Opponent", "United City"), row("Exact Opponent", "United Rovers")));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge"), row("Exact Opponent", "Northbridge Women")));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge"), row("Exact Opponent", "Northbridge U21")));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge U21"), row("Exact Opponent", "Northbridge U23")));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge"), row("Exact Opponent", "Northbridge B")));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge B"), row("Exact Opponent", "Northbridge II")));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge 2"), row("Exact Opponent", "Northbridge 3")));
  assert(!matchesEvent(
    fixture("Exact Opponent", { name: "Springfield", participantType: "club", country: "US" }),
    row("Exact Opponent", { name: "Springfield", participantType: "national-team", country: "US" })
  ));
  assert(!matchesEvent(
    fixture("Exact Opponent", { name: "Racing", participantType: "club", country: "AR" }),
    row("Exact Opponent", { name: "Racing", participantType: "club", country: "ES" })
  ));
  assert(!matchesEvent(
    fixture("Exact Opponent", { name: "ŁKS Łódź", sourceIds: { registry: "one" } }),
    row("Exact Opponent", { name: "LKS Lodz", sourceIds: { registry: "two" } })
  ));
  assert(!matchesEvent(fixture("Exact Opponent", "Sporting Kansas City"), row("Exact Opponent", "Sporting Lisbon")));
  assert(!matchesEvent(fixture("Exact Opponent", "North Athletic United"), row("Exact Opponent", "South Athletic United")));
  assert(!matchesEvent(fixture("Exact Opponent", "UC"), row("Exact Opponent", "United City")));
  assert(!matchesEvent(fixture("Exact Opponent", "North Athletic United"), row("Exact Opponent", "North Athletic United City")));
  assert(!matchesEvent(fixture("Exact Opponent", "Barcelona"), row("Exact Opponent", "Barcellona")));
  assert(!matchesEvent(
    fixture("Exact Opponent", { name: "Alpha", aliases: ["City"] }),
    row("Exact Opponent", { name: "Beta", aliases: ["City"] })
  ));
  assert(!matchesEvent(
    fixture("Exact Opponent", { name: "Alpha", aliases: ["Shared Athletic Club"] }),
    row("Exact Opponent", { name: "Beta", aliases: ["Shared Athletic Club"] })
  ));
  assert(!matchesEvent(fixture("Exact Opponent", "Racing"), row("Exact Opponent", "Racing")));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge"), row("Exact Opponent", "Northbridge", { sport: "basketball" })));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge"), { ...row("Exact Opponent", "Northbridge"), sport: undefined }));
  assert(!matchesEvent(fixture("Exact Opponent", "Northbridge"), row("Exact Opponent", "Northbridge", { competition: "LaLiga 2" })));
});

test("registry rejects duplicate, ambiguous and malformed identity metadata", () => {
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", type: "club", names: ["City One", "City"] },
    { id: "two", sport: "football", type: "club", names: ["City Two", "City"] }
  ] }), /Ambiguous canonical participant alias/);
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", type: "club", names: ["Paris Saint-Germain", "Paris Saint Germain"] }
  ] }), /Duplicate canonical participant alias/);
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", names: ["Missing Type"] }
  ] }), /Invalid canonical participant identity registry/);
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", type: "club", country: "England", names: ["Bad Country"] }
  ] }), /Invalid canonical participant identity registry/);
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", type: "club", names: ["One"], sourceIds: { provider: "7" } },
    { id: "two", sport: "football", type: "club", names: ["Two"], sourceIds: { provider: "7" } }
  ] }), /Ambiguous canonical participant source ID/);
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", type: "garbage", names: ["Bad Type"] }
  ] }), /Invalid canonical participant identity registry/);
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", type: "club", names: [7] }
  ] }), /Invalid canonical participant identity registry/);
  assert.throws(() => createParticipantIdentityRegistry({ participants: [
    { id: "one", sport: "football", type: "club", names: ["Bad ID"], sourceIds: { "a:b": "c" } }
  ] }), /Invalid canonical participant source ID/);
  assert.doesNotThrow(() => createParticipantIdentityRegistry({ participants: [
    { id: "football-city", sport: "football", type: "club", country: "GB", names: ["Shared Name"] },
    { id: "basketball-city", sport: "basketball", type: "club", country: "US", names: ["Shared Name"] }
  ] }));
});

test("ambiguous candidate-to-event resolution fails closed", () => {
  const first = fixture("Same Home", "Same Away", { id: "one" });
  const second = fixture("Same Home", "Same Away", { id: "two" });
  const candidate = row("Same Home", "Same Away", { broadcasts: [{
    channelName: "Official One", territory: "ES", sourceType: "official-event", sourceUrl: "https://example.test/schedule", matchingMethod: "fixture-row"
  }] });
  resolveExactBroadcasts([first, second], [candidate]);
  assert.deepEqual(first.broadcasts, []);
  assert.deepEqual(second.broadcasts, []);
});

test("Barcelona and Athletic regression preserves exact regional numbered and language channels", () => {
  const target = fixture("Barcelona", "Athletic Bilbao");
  augmentWithOfficialRights([target], rights);
  const common = {
    region: "Arabic",
    displayRegion: "AR",
    regionTerritories: ["MA", "QA"],
    rightsHolder: "beIN Sports",
    sourceType: "official-broadcaster-schedule",
    destinationVerified: true,
    sourceUrl: "https://www.beinsports.com/api/opta/tv-event?region=en-mena",
    matchingMethod: "bein-epg-match-teams-competition-kickoff",
    destinationType: "linear",
    destinationPrecision: "channel",
    verifiedAt: "2026-08-23"
  };
  resolveExactBroadcasts([target], [row("Barcelona", "Athletic Club", { broadcasts: [
    { ...common, channelName: "beIN SPORTS 1" },
    { ...common, channelName: "beIN SPORTS EN 1" }
  ] })]);

  assert.deepEqual(target.broadcasts.map((item) => item.channelName), ["beIN SPORTS 1", "beIN SPORTS EN 1"]);
  assert(target.broadcasts.every((item) => item.region === "Arabic" && item.territories.includes("MA")));
  assert(target.broadcasts.every((item) => item.sourceUrl.includes("beinsports.com") && item.destinationPrecision === "channel"));
  assert(target.broadcasts.every((item) => item.eventMatchingMethod.includes("canonical-participant-alias")));
});

test("rights metadata alone never becomes a playable destination", () => {
  const target = fixture("Barcelona", "Athletic Bilbao");
  augmentWithOfficialRights([target], rights);
  resolveExactBroadcasts([target], []);
  assert(target.broadcastRights.length > 0);
  assert.deepEqual(target.broadcasts, []);
});

test("unverified schedule output cannot enter playable broadcasts", () => {
  const target = fixture("Barcelona", "Athletic Bilbao");
  augmentWithOfficialRights([target], rights);
  resolveExactBroadcasts([target], [row("Barcelona", "Athletic Club", { broadcasts: [{
    channelName: "beIN Unauthorized 1",
    region: "Arabic",
    displayRegion: "AR",
    regionTerritories: ["MA"],
    rightsHolder: "beIN Sports",
    sourceType: "official-broadcaster-schedule",
    sourceUrl: "https://example.test/unverified",
    matchingMethod: "unverified-parser"
  }] })]);
  assert.deepEqual(target.broadcasts, []);
});
