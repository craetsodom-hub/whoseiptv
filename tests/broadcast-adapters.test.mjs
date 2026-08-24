import test from "node:test";
import assert from "node:assert/strict";
import rights from "../config/official-event-broadcasters.json" with { type: "json" };
import { parseBeinMenaGuide, beinMenaAdapter } from "../scripts/broadcast/adapters/bein-mena.mjs";
import { parseSkySemanticHtml, parseSkySportsSchedule, skySportsAdapter } from "../scripts/broadcast/adapters/sky-sports.mjs";
import { parseLaligaSchedule, parseLaligaSemanticTable, laligaAdapter } from "../scripts/broadcast/adapters/laliga.mjs";
import { parseLigue1Schedule, ligue1Adapter } from "../scripts/broadcast/adapters/ligue1.mjs";
import { parseBundesligaSchedule, bundesligaAdapter } from "../scripts/broadcast/adapters/bundesliga.mjs";
import { parsePremierLeagueSelections, premierLeagueAdapter } from "../scripts/broadcast/adapters/premier-league.mjs";
import { parseTntSportsSchedule } from "../scripts/broadcast/adapters/tnt-sports.mjs";
import { OFFICIAL_ADAPTER_STATUS, OFFICIAL_BROADCAST_ADAPTERS } from "../scripts/broadcast/adapters/index.mjs";
import { attachAllEventDestinations, augmentWithOfficialRights } from "../scripts/official-rights.mjs";
import { mergeExactBroadcasts, resolveExactBroadcasts } from "../scripts/broadcast/resolver.mjs";
import { canonicalChannelIdentity } from "../scripts/broadcast/normalize.mjs";

const script = (value) => `<script type="application/json">${JSON.stringify(value)}</script>`;
const epoch = (value) => Math.floor(Date.parse(value) / 1000);
const event = (competition, home, away, kickoff, season = "2026/27") => ({
  id: `${home}-${away}`, sport: "football", competition, season, homeTeam: { name: home }, awayTeam: { name: away },
  startUtcEpochSeconds: epoch(kickoff), broadcasts: []
});
const collect = (adapter, html) => adapter.collect({ fetchText: async () => html, verifiedAt: "2026-08-23", aliasesByChannel: {} });

test("only fail-closed fixture-tested adapters are registered", () => {
  assert.deepEqual(OFFICIAL_BROADCAST_ADAPTERS.map((adapter) => adapter.id), ["bein-mena", "sky-sports-uk", "premier-league-selections", "laliga-spain", "ligue1-france", "bundesliga-active"]);
  assert.equal(OFFICIAL_ADAPTER_STATUS.find((adapter) => adapter.id === "sky-sports-uk").contractStatus, "semantic-html-verified");
  assert.equal(OFFICIAL_ADAPTER_STATUS.find((adapter) => adapter.id === "bein-mena").contractStatus, "fixture-tested-live-unverified");
});

test("Sky parses exact subchannels and preserves legitimate simulcasts", async () => {
  const html = script({ fixtures: [
    { homeTeam: "Manchester City", awayTeam: "Bournemouth", kickoff: "2026-08-23T15:00:00Z", channels: ["Sky Sports Main Event"] },
    { homeTeam: "Brighton & Hove Albion", awayTeam: "Aston Villa", kickoff: "2026-08-23T17:30:00Z", channels: ["Sky Sports Premier League"] },
    { homeTeam: "Fulham", awayTeam: "Chelsea", kickoff: "2026-08-24T15:00:00Z", channels: ["Sky Sports Premier League", "Sky Sports Main Event"] }
  ] });
  assert.equal(parseSkySportsSchedule(html).length, 3);
  const candidates = await collect(skySportsAdapter, html);
  assert.deepEqual(candidates[2].broadcasts.map((item) => item.channelName), ["Sky Sports Premier League", "Sky Sports Main Event"]);
  assert.notEqual(candidates[2].broadcasts[0].channelName, candidates[2].broadcasts[1].channelName);
});

test("Sky semantic HTML separates kickoff from coverage and supports Sky Sports+", () => {
  const html = `
    <article>
      <h3>Sunderland vs Fulham</h3>
      <p>Coverage <time datetime="2026-08-30T12:00:00Z">13:00</time></p>
      <p>Kick Off <time data-role="kickoff" datetime="2026-08-30T13:00:00Z">14:00</time></p>
      <p>Watch on Sky Sports+</p>
    </article>
    <article>
      <h3>Fulham vs Chelsea</h3>
      <p>Kick-off <time itemprop="startDate" datetime="2026-08-30T15:30:00Z">16:30</time></p>
      <p>Sky Sports Premier League and Sky Sports Main Event</p>
    </article>`;
  const rows = parseSkySemanticHtml(html);
  assert.equal(rows[0].startUtcEpochSeconds, epoch("2026-08-30T13:00:00Z"));
  assert.deepEqual(rows[0].channels, ["Sky Sports+"]);
  assert.deepEqual(rows[1].channels, ["Sky Sports Premier League", "Sky Sports Main Event"]);
  assert.notEqual(canonicalChannelIdentity("Sky Sports+"), canonicalChannelIdentity("Sky Sports Main Event"));
  assert.notEqual(canonicalChannelIdentity("Sky Sports+"), canonicalChannelIdentity("Sky Sports Premier League"));
});

test("generic Premier League network selection cannot overwrite a precise Sky channel", () => {
  const merged = mergeExactBroadcasts(
    { channelName: "Sky Sports", territory: "GB", sourceType: "official-network-selection", destinationPrecision: "network" },
    { channelName: "Sky Sports Main Event", territory: "GB", sourceType: "official-broadcaster-schedule", destinationPrecision: "channel" }
  );
  assert.deepEqual(merged.map((item) => item.channelName), ["Sky Sports Main Event"]);
});

test("Premier League selection validates a network without inventing a subchannel", async () => {
  const html = script({ fixtures: [
    { homeTeam: "Crystal Palace", awayTeam: "Manchester City", kickoff: "2026-08-29T12:30:00Z", broadcaster: "Sky Sports" },
    { homeTeam: "Liverpool", awayTeam: "Nottingham Forest", kickoff: "2026-08-29T17:30:00Z", broadcaster: "TNT Sports" }
  ] });
  assert.deepEqual(parsePremierLeagueSelections(html).map((row) => row.channels), [["Sky Sports"], ["TNT Sports"]]);
  const candidates = await collect(premierLeagueAdapter, html);
  assert.equal(candidates[1].broadcasts[0].channelName, "TNT Sports");
  assert.equal(candidates[1].broadcasts[0].destinationPrecision, "network");
});

test("TNT parser retains only explicitly named event services", () => {
  const html = script({ fixture: { homeTeam: "Liverpool", awayTeam: "Nottingham Forest", kickoff: "2026-08-29T17:30:00Z", services: ["TNT Sports", "HBO Max"] } });
  assert.deepEqual(parseTntSportsSchedule(html)[0].channels, ["TNT Sports", "HBO Max"]);
});

test("beIN accepts only aligned LIVE matches and rejects replay programming", async () => {
  const live = { title: "Manchester City vs Bournemouth", competition: "Premier League", startDate: "2026-08-23T15:00:00Z", isLive: true };
  const rejected = [
    { ...live, title: `${live.title} Replay`, startDate: "2026-08-23T20:00:00Z" },
    { ...live, title: `${live.title} Highlights` },
    { ...live, title: `${live.title} Season Preview` },
    { ...live, startDate: "2025-08-23T15:00:00Z" },
    { ...live, isLive: false }
  ];
  const guide = script({ channels: [{ channelName: "beIN SPORTS 1", programmes: [live, ...rejected] }] });
  const rows = parseBeinMenaGuide(guide);
  assert.equal(rows.length, 2); // The old-season LIVE row is parsed, then safely rejected by event matching.
  const target = event("Premier League", "Manchester City", "Bournemouth", "2026-08-23T15:00:00Z");
  augmentWithOfficialRights([target], rights);
  resolveExactBroadcasts([target], await collect(beinMenaAdapter, guide));
  assert(target.broadcasts.length > 10);
  assert(target.broadcasts.every((item) => item.channelName === "beIN SPORTS 1"));
  assert(target.broadcasts.some((item) => item.territory === "MA"));
  assert(!target.broadcasts.some((item) => item.territory === "FR"));
});

test("LaLiga operator stays attached to its own exact fixture", async () => {
  const html = script({ fixtures: [
    { homeTeam: "FC Barcelona", awayTeam: "Athletic Club", kickoff: "2026-08-23T19:00:00Z", operator: "DAZN" },
    { homeTeam: "Celta", awayTeam: "Athletic Club", kickoff: "2026-08-24T19:00:00Z", operator: "Movistar LALIGA" }
  ] });
  assert.deepEqual(parseLaligaSchedule(html).map((row) => row.channels), [["DAZN"], ["Movistar LALIGA"]]);
  const targets = [event("LaLiga", "FC Barcelona", "Athletic Club", "2026-08-23T19:00:00Z"), event("LaLiga", "Celta Vigo", "Athletic Club", "2026-08-24T19:00:00Z")];
  augmentWithOfficialRights(targets, rights);
  resolveExactBroadcasts(targets, await collect(laligaAdapter, html));
  assert.deepEqual(targets[0].broadcasts.map((item) => item.channelName), ["DAZN"]);
  assert.deepEqual(targets[1].broadcasts.map((item) => item.channelName), ["Movistar LALIGA"]);
});

test("LaLiga semantic OPERADOR table keeps each operator in its own row", () => {
  const html = `<table>
    <thead><tr><th>FECHA</th><th>HORARIO</th><th>PARTIDO</th><th>OPERADOR</th></tr></thead>
    <tbody>
      <tr><td><time datetime="2026-08-23T17:00:00Z">23 AGO</time></td><td>19:00</td><td>Deportivo Alavés vs Getafe CF</td><td>DAZN</td></tr>
      <tr><td><time datetime="2026-08-24T19:00:00Z">24 AGO</time></td><td>21:00</td><td>Sevilla FC vs Rayo Vallecano</td><td>Movistar LALIGA</td></tr>
      <tr><td><time datetime="2026-08-25T19:00:00Z">25 AGO</time></td><td>21:00</td><td>FC Barcelona vs Athletic Club</td><td>DAZN</td></tr>
    </tbody>
  </table>`;
  const rows = parseLaligaSemanticTable(html);
  assert.deepEqual(rows.map((row) => [row.homeTeam, row.awayTeam, row.channels[0]]), [
    ["Deportivo Alavés", "Getafe CF", "DAZN"],
    ["Sevilla FC", "Rayo Vallecano", "Movistar LALIGA"],
    ["FC Barcelona", "Athletic Club", "DAZN"]
  ]);
  assert.deepEqual(parseLaligaSemanticTable("<table><tr><th>PARTIDO</th></tr><tr><td>A vs B</td></tr></table>"), []);
});

test("all-event service guarantees apply only in their valid competition cycle", () => {
  const current = event("LaLiga", "Barcelona", "Sevilla", "2026-09-01T19:00:00Z");
  const franceLaterCycle = event("LaLiga", "Barcelona", "Sevilla", "2028-09-01T19:00:00Z", "2028/29");
  const expired = event("LaLiga", "Barcelona", "Sevilla", "2029-09-01T19:00:00Z", "2029/30");
  attachAllEventDestinations([current, franceLaterCycle, expired], rights);
  assert.deepEqual(current.broadcasts.filter((item) => item.territory === "US").map((item) => item.channelName), ["ESPN+"]);
  assert.deepEqual(current.broadcasts.filter((item) => item.territory === "FR").map((item) => item.channelName).sort(), ["DAZN", "Disney+"]);
  assert(!current.broadcasts.some((item) => ["ABC", "ESPN", "ESPN2"].includes(item.channelName)));
  assert.deepEqual(franceLaterCycle.broadcasts.map((item) => item.channelName).sort(), ["DAZN", "Disney+"]);
  assert.equal(expired.broadcasts.length, 0);
});

test("Ligue 1 numbered channels remain distinct and coexist with the all-event service", async () => {
  const fixtures = [
    ["PSG", "Rennes", "Ligue 1+ 2"], ["Toulouse", "Lyon", "Ligue 1+ 3"], ["Nice", "Lorient", "Ligue 1+ 4"],
    ["ESTAC", "Paris FC", "Ligue 1+ 5"], ["Le Mans", "Brest", "Ligue 1+ 6"]
  ].map(([homeTeam, awayTeam, channel], index) => ({ homeTeam, awayTeam, startDate: `2026-08-${23 + index}T19:00:00Z`, channel, competition: "Ligue 1" }));
  assert.deepEqual(parseLigue1Schedule(script({ fixtures })).map((row) => row.channels[0]), fixtures.map((item) => item.channel));
  const target = event("Ligue 1", "PSG", "Rennes", "2026-08-23T19:00:00Z");
  augmentWithOfficialRights([target], rights);
  attachAllEventDestinations([target], rights);
  resolveExactBroadcasts([target], await collect(ligue1Adapter, script({ fixtures })));
  assert.deepEqual(target.broadcasts.map((item) => item.channelName).sort(), ["Ligue 1+", "Ligue 1+ 2"]);
});

test("Bundesliga emits nothing until an active broadcaster exists", async () => {
  const base = { homeTeam: "Bayern Munich", awayTeam: "RB Leipzig", startDate: "2026-08-28T18:30:00Z" };
  assert.equal(parseBundesligaSchedule(script({ fixtures: [base] })).length, 0);
  const active = { ...base, activeBroadcaster: "DAZN" };
  assert.deepEqual((await collect(bundesligaAdapter, script({ fixtures: [active] })))[0].broadcasts.map((item) => item.channelName), ["DAZN"]);
});

test("malformed payloads and source outages fail closed", async () => {
  assert.deepEqual(parseBeinMenaGuide("<html>not json</html>"), []);
  await assert.rejects(() => beinMenaAdapter.collect({ fetchText: async () => { throw new Error("offline"); }, verifiedAt: "2026-08-23" }), /offline/);
});
