import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichTeamBadges } from "../scripts/team-badges.mjs";

test("enriches only missing badges from trusted TheSportsDB artwork", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whoseiptv-badges-"));
  const details = new Map([["event", { idHomeTeam: "10", idAwayTeam: "20", strHomeTeamBadge: null, strAwayTeamBadge: null }]]);
  const result = await enrichTeamBadges({
    detailsByEvent: details,
    cachePath: join(directory, "cache.json"),
    nowMilliseconds: 1_000,
    fetchJson: async (id) => ({ teams: [{ strBadge: id === "10" ? "https://r2.thesportsdb.com/images/home.png" : "https://example.com/untrusted.png" }] })
  });
  assert.equal(result.resolved, 1);
  assert.equal(details.get("event").strHomeTeamBadge, "https://r2.thesportsdb.com/images/home.png");
  assert.equal(details.get("event").strAwayTeamBadge, null);
  assert.equal(JSON.parse(await readFile(join(directory, "cache.json"), "utf8")).version, 1);
});
