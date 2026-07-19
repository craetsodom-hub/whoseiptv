import assert from "node:assert/strict";
import test from "node:test";
import { parseNbaSchedulePage } from "../scripts/official-nba.mjs";

const now = Math.floor(Date.parse("2026-07-19T12:00:00Z") / 1000);

test("parses official NBA page data into a confirmed basketball event", () => {
  const data = {
    props: { pageProps: { gameCardFeed: { modules: [{ cards: [{ cardData: {
      gameId: "123",
      homeTeam: { teamId: "1610612760", teamName: "Thunder" },
      awayTeam: { teamId: "1610612751", teamName: "Nets" },
      gameTimeUtc: "2026-07-19T20:30:00Z",
      cardHat: "2026 NBA Summer League",
      broadcasters: { nationalBroadcasters: [{ broadcasterDisplayName: "ESPN" }] }
    } }] }] } } }
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  const events = parseNbaSchedulePage(html, now, { ESPN: ["ESPN HD"] });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Nets vs Thunder");
  assert.equal(events[0].sport, "basketball");
  assert.equal(events[0].homeTeam.badgeUrl, "https://cdn.nba.com/logos/nba/1610612760/primary/L/logo.svg");
  assert.equal(events[0].awayTeam.badgeUrl, "https://cdn.nba.com/logos/nba/1610612751/primary/L/logo.svg");
  assert.equal(events[0].broadcasts[0].territory, "US");
  assert.deepEqual(events[0].broadcasts[0].aliases, ["ESPN HD"]);
});

test("drops official games without a named broadcaster", () => {
  const data = {
    props: { pageProps: { gameCardFeed: { modules: [{ cards: [{ cardData: {
      gameId: "124",
      homeTeam: { teamName: "Home" },
      awayTeam: { teamName: "Away" },
      gameTimeUtc: "2026-07-19T20:30:00Z",
      broadcasters: { nationalBroadcasters: [] }
    } }] }] } } }
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  assert.deepEqual(parseNbaSchedulePage(html, now), []);
});
