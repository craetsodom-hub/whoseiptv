import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { broadcastAliases, canonicalChannelIdentity } from "../scripts/broadcast/normalize.mjs";
import { buildDiscoveryCoverage, discoverOfficialDestinations, validateOfficialSourceAdapter } from "../scripts/broadcast/discovery.mjs";
import { createTeamArtworkResolver, enrichTeamArtwork } from "../scripts/team-artwork.mjs";
import { mergeExactBroadcasts } from "../scripts/broadcast/resolver.mjs";

const fixture = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("generic broadcaster normalization handles quality, separators and locale prefixes without a provider map", () => {
  assert.equal(canonicalChannelIdentity("ES | Example Sports HD"), canonicalChannelIdentity("Example Sports"));
  assert.deepEqual(broadcastAliases("ES | Example Sports HD"), ["ES | Example Sports", "Example Sports"]);
  assert.notEqual(canonicalChannelIdentity("Example Sports 1"), canonicalChannelIdentity("Example Sports 2"));
});

test("official discovery captures source failure and only reports verified event channels as exact", async () => {
  const good = {
    id: "good", sourceUrl: "https://official.example.test/schedule", trustedHosts: ["official.example.test"], parserTypes: ["structured-json"],
    appliesTo: () => true,
    collect: async () => [{ competition: "Example League", homeTeam: "Home FC", awayTeam: "Away FC", startUtcEpochSeconds: 1_788_188_400, broadcasts: [] }]
  };
  const down = { ...good, id: "down", sourceUrl: "https://down.example.test/schedule", trustedHosts: ["down.example.test"], collect: async () => { throw new Error("offline"); } };
  const discovered = await discoverOfficialDestinations([good, down], {});
  assert.equal(discovered.candidates.length, 1);
  assert.deepEqual(discovered.attempts.map((attempt) => attempt.success), [true, false]);
  const event = {
    id: "fixture", sport: "football", competition: "Example League", broadcasts: mergeExactBroadcasts(
      { channelName: "Example Sports", territory: "ES", sourceType: "official-event", destinationVerified: true, confirmed: true, sourceUrl: good.sourceUrl },
      { channelName: "Example Network", territory: "GB", sourceType: "official-network-selection", destinationPrecision: "network", confirmed: false, sourceUrl: good.sourceUrl }
    ),
    broadcastRights: [{ territory: "ES", holders: [{ name: "Example Sports" }] }, { territory: "GB", holders: [{ name: "Example Network" }] }]
  };
  const report = buildDiscoveryCoverage([event], [good, down], discovered.attempts);
  assert.equal(report.events.find((item) => item.territory === "ES").exactDestinations.length, 1);
  assert.equal(report.events.find((item) => item.territory === "GB").exactDestinations.length, 0);
  assert.match(report.events.find((item) => item.territory === "GB").rejectionReason, /Rights-holder/);
  assert.equal(report.summaries.territory.find((item) => item.territory === "ES").coveragePercentage, 100);
});

test("official source contracts reject untrusted and undeclared parser sources", () => {
  assert.throws(() => validateOfficialSourceAdapter({
    id: "unsafe", collect() {}, sourceUrl: "https://other.example.test/feed", trustedHosts: ["official.example.test"], parserTypes: ["structured-json"]
  }), /Untrusted/);
  assert.throws(() => validateOfficialSourceAdapter({
    id: "unknown-parser", collect() {}, sourceUrl: "https://official.example.test/feed", trustedHosts: ["official.example.test"], parserTypes: ["scrape-anything"]
  }), /Invalid/);
});

test("logo resolver accepts only trusted HTTPS badges, caches lookups, and keeps events when lookups fail", async () => {
  const badges = await fixture("./fixtures/logos/trusted-untrusted-and-missing.json");
  let calls = 0;
  const resolver = createTeamArtworkResolver({ fetchText: async () => { calls += 1; return JSON.stringify(badges); }, minIntervalMs: 0 });
  const events = [{ homeTeam: { name: "Trusted FC" }, awayTeam: { name: "Untrusted FC" }, broadcasts: [] }, { homeTeam: { name: "Trusted FC" }, awayTeam: { name: "Missing FC" }, broadcasts: [] }];
  await enrichTeamArtwork(events, resolver);
  assert.match(events[0].homeTeam.badgeUrl, /^https:\/\/r2\.thesportsdb\.com\//);
  assert.equal(events[0].awayTeam.badgeUrl, null);
  assert.equal(events[1].awayTeam.badgeUrl, null);
  assert.equal(calls, 3); // duplicate team name was deduplicated in flight/cache
  const failure = createTeamArtworkResolver({ fetchText: async () => { throw new Error("offline"); }, minIntervalMs: 0 });
  const unaffected = [{ homeTeam: { name: "A" }, awayTeam: { name: "B" }, broadcasts: [{ channelName: "Official", territory: "GB" }] }];
  await enrichTeamArtwork(unaffected, failure);
  assert.equal(unaffected[0].broadcasts.length, 1);
  assert.equal(unaffected[0].homeTeam.badgeUrl, null);
});

test("logo lookup budget is fail-closed and never removes an event", async () => {
  let calls = 0;
  const resolver = createTeamArtworkResolver({ fetchText: async () => { calls += 1; return JSON.stringify({ teams: [] }); }, maxRequests: 1, minIntervalMs: 0 });
  const events = [{ homeTeam: { name: "One" }, awayTeam: { name: "Two" }, broadcasts: [{ channelName: "Verified" }] }];
  await enrichTeamArtwork(events, resolver);
  assert.equal(calls, 1);
  assert.equal(resolver.stats().requests, 1);
  assert.equal(events[0].broadcasts.length, 1);
});

test("normalised duplicate destinations stay inside their territories", () => {
  const destinations = mergeExactBroadcasts(
    { channelName: "ES | Example Sports HD", territory: "ES", sourceType: "official-event", sourceUrl: "https://official.example.test/s", confirmed: true },
    { channelName: "Example Sports", territory: "ES", sourceType: "official-event", sourceUrl: "https://official.example.test/s", confirmed: true },
    { channelName: "Example Sports", territory: "GB", sourceType: "official-event", sourceUrl: "https://official.example.test/s", confirmed: true }
  );
  assert.equal(destinations.length, 2);
  assert.deepEqual(destinations.map((item) => item.territory).sort(), ["ES", "GB"]);
});
