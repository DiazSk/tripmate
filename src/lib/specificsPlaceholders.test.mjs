import test from "node:test";
import assert from "node:assert/strict";
import { cityOf, specificsPlaceholders } from "./specificsPlaceholders.ts";

const poi = (name) => ({ name });

test("cityOf takes the first segment", () => {
  assert.equal(cityOf("Mumbai, India"), "Mumbai");
  assert.equal(cityOf(""), "");
});

test("occasion names the destination city, generic when empty", () => {
  assert.equal(specificsPlaceholders("Mumbai, India", [], false).purpose, "An anniversary, a first time in Mumbai, work and play");
  assert.equal(specificsPlaceholders("", [], false).purpose, "An anniversary, a first time in a new city, work and play");
});

test("must-see uses the first two POIs when available", () => {
  const pois = [poi("Gateway of India"), poi("Marine Drive"), poi("Elephanta")];
  assert.equal(specificsPlaceholders("Mumbai", pois, true).mustInclude, "Gateway of India, Marine Drive");
});

test("must-see falls back when POIs are absent, unavailable or too few", () => {
  const neutral = "A landmark, a market, a viewpoint";
  assert.equal(specificsPlaceholders("Mumbai", [], true).mustInclude, neutral);
  assert.equal(specificsPlaceholders("Mumbai", [poi("Gateway of India")], true).mustInclude, neutral);
  assert.equal(specificsPlaceholders("Mumbai", [poi("A"), poi("B")], false).mustInclude, neutral);
});
