/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/importSources.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyItem, isPublicAddress, parseGoogleMapsUrl } from "./importSources.ts";

test("classifyItem recognises each source", () => {
  const url = (u) => classifyItem({ kind: "url", url: u });
  assert.equal(url("https://www.tiktok.com/@a/video/123"), "tiktok");
  assert.equal(url("https://vm.tiktok.com/ZMabc/"), "tiktok");
  assert.equal(url("https://youtu.be/abc"), "youtube");
  assert.equal(url("https://www.youtube.com/shorts/abc"), "youtube");
  assert.equal(url("https://www.instagram.com/reel/abc/"), "instagram");
  assert.equal(url("https://maps.app.goo.gl/xyz"), "gmaps");
  assert.equal(url("https://www.google.com/maps/place/X/@1,2,15z"), "gmaps");
  assert.equal(url("https://example.com/blog"), "url");
  assert.equal(url("not a url"), "text");
  assert.equal(classifyItem({ kind: "text", text: "go to Nishiki" }), "text");
  assert.equal(classifyItem({ kind: "image", mediaType: "image/png", data: "" }), "image");
});

test("parseGoogleMapsUrl prefers the place pin over the viewport centre", () => {
  const u =
    "https://www.google.com/maps/place/teamLab+Planets+TOKYO/@35.6491,139.7898,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.64903!4d139.78993";
  assert.deepEqual(parseGoogleMapsUrl(u), { name: "teamLab Planets TOKYO", lat: 35.64903, lng: 139.78993 });
});

test("parseGoogleMapsUrl decodes names and falls back to the @ centre", () => {
  const u = "https://www.google.com/maps/place/Caf%C3%A9+de+Flore/@48.854,2.3326,17z";
  assert.deepEqual(parseGoogleMapsUrl(u), { name: "Café de Flore", lat: 48.854, lng: 2.3326 });
});

test("parseGoogleMapsUrl returns null for links it cannot read", () => {
  assert.equal(parseGoogleMapsUrl("https://maps.app.goo.gl/xyz"), null);
  assert.equal(parseGoogleMapsUrl("https://www.google.com/maps/@35,139,12z"), null);
  assert.equal(parseGoogleMapsUrl("garbage"), null);
});

test("isPublicAddress refuses private, loopback, link-local and mapped addresses", () => {
  for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "169.254.169.254", "0.0.0.0",
                    "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nonsense"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});
