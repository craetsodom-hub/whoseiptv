import test from "node:test";
import assert from "node:assert/strict";
import rights from "../config/official-event-broadcasters.json" with { type: "json" };
import { augmentWithOfficialRights, validateOfficialRightsConfig } from "../scripts/official-rights.mjs";

test("official rights map contains exactly 30 validated territories", () => {
  assert.equal(validateOfficialRightsConfig(rights), true);
});

test("rights are added only to World Cup events", () => {
  const events = [
    { competition: "FIFA World Cup 2026", broadcasts: [] },
    { competition: "International Friendly", broadcasts: [] }
  ];
  augmentWithOfficialRights(events, rights);
  assert.equal(events[0].broadcasts.length >= 30, true);
  assert.equal(events[1].broadcasts.length, 0);
  assert.equal(events[0].broadcasts.every((broadcast) => broadcast.confirmed), true);
});
