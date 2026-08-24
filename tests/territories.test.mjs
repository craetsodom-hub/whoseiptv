import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedTerritory, territoryKind } from "../scripts/territories.mjs";

test("accepts current ISO alpha-2 territories", () => {
  for (const territory of ["DE", "FR", "GB", "ES", "US"]) assert.equal(isSupportedTerritory(territory), true);
});

test("rejects obsolete and arbitrary two-letter territories", () => {
  for (const territory of ["CS", "DD", "EU", "UK", "ZZ"]) {
    assert.equal(isSupportedTerritory(territory), false);
    assert.equal(territoryKind(territory), "invalid-or-legacy");
  }
});

test("supports Kosovo only as an explicit non-ISO extension", () => {
  assert.equal(isSupportedTerritory("XK"), true);
  assert.equal(territoryKind("XK"), "intentional-kosovo-extension");
});
