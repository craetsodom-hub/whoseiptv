import assert from "node:assert/strict";
import test from "node:test";
import { buildFeed, parseUtcTimestamp, validateFeed } from "../scripts/feed-core.mjs";

const now = 1_800_000_000;

test("parses TheSportsDB UTC timestamps", () => {
  assert.equal(parseUtcTimestamp("2027-01-15 08:00:00"), 1_800_000_000);
  assert.equal(parseUtcTimestamp("1800000000"), 1_800_000_000);
  assert.equal(parseUtcTimestamp("invalid"), null);
});

test("merges territorial broadcasters for the same event", () => {
  const records = [
    {
      idEvent: "42",
      strSport: "Soccer",
      strEvent: "Home vs Away",
      strTimeStamp: "2027-01-15 08:00:00",
      strChannel: "BBC One",
      __territory: "GB"
    },
    {
      idEvent: "42",
      strSport: "Soccer",
      strEvent: "Home vs Away",
      strTimeStamp: "2027-01-15 08:00:00",
      strChannel: "M6",
      __territory: "FR"
    }
  ];
  const feed = buildFeed(records, { "BBC One": ["BBC 1"] }, now);

  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].broadcasts.length, 2);
  assert.deepEqual(feed.events[0].broadcasts[0].aliases, ["BBC 1"]);
  assert.equal(validateFeed(feed, now), true);
});

test("drops malformed, non-football, and out-of-window records", () => {
  const feed = buildFeed([
    { idEvent: "1", strSport: "Basketball", strEvent: "A vs B", strTimeStamp: "2027-01-15 08:00:00", strChannel: "TV", __territory: "US" },
    { idEvent: "2", strSport: "Soccer", strEvent: "A vs B", strTimeStamp: "invalid", strChannel: "TV", __territory: "US" },
    { idEvent: "3", strSport: "Soccer", strEvent: "A vs B", strTimeStamp: "2028-01-15 08:00:00", strChannel: "TV", __territory: "US" }
  ], {}, now);

  assert.deepEqual(feed.events, []);
});
