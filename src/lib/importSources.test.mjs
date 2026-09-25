/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/importSources.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyItem, isPublicAddress, parseGoogleMapsUrl, readLink, resolveFinalUrl } from "./importSources.ts";

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

/** A fake network: `routes` maps a URL to a Response or a function returning one; `ips` maps a host to an address. */
const fakeNet = (routes, ips = {}) => ({
  lookup: async (host) => ips[host] ?? "93.184.216.34",
  fetch: async (input) => {
    const url = String(input);
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return typeof r === "function" ? r() : r.clone();
  },
});
const redirect = (to) => new Response(null, { status: 302, headers: { location: to } });

test("readLink refuses http and private hosts", async () => {
  assert.equal(await readLink("http://example.com/", fakeNet({})), null);
  assert.equal(await readLink("https://internal.example/", fakeNet({}, { "internal.example": "10.0.0.5" })), null);
});

test("readLink refuses a redirect into the private network", async () => {
  const net = fakeNet(
    { "https://bit.ly/x": redirect("https://metadata.local/latest") },
    { "metadata.local": "169.254.169.254" }
  );
  assert.equal(await readLink("https://bit.ly/x", net), null);
});

test("readLink stops after 3 redirects", async () => {
  const net = fakeNet({
    "https://a.test/0": redirect("https://a.test/1"),
    "https://a.test/1": redirect("https://a.test/2"),
    "https://a.test/2": redirect("https://a.test/3"),
    "https://a.test/3": redirect("https://a.test/4"),
  });
  assert.equal(await readLink("https://a.test/0", net), null);
});

test("readLink reads a TikTok caption through oEmbed", async () => {
  const video = "https://www.tiktok.com/@a/video/1";
  const net = fakeNet({
    [`https://www.tiktok.com/oembed?url=${encodeURIComponent(video)}`]: new Response(
      JSON.stringify({ title: "Best ramen in Shibuya: Ichiran & Afuri" }),
      { headers: { "content-type": "application/json" } }
    ),
  });
  assert.deepEqual(await readLink(video, net), { title: "Best ramen in Shibuya: Ichiran & Afuri", text: "" });
});

test("readLink reads an ordinary page's title and og tags", async () => {
  const html = `<html><head><title>10 Kyoto cafés</title><meta property="og:description" content="Weekenders, % Arabica"></head></html>`;
  const net = fakeNet({ "https://blog.test/kyoto": new Response(html, { headers: { "content-type": "text/html" } }) });
  assert.deepEqual(await readLink("https://blog.test/kyoto", net), { title: "10 Kyoto cafés", text: "Weekenders, % Arabica" });
});

test("resolveFinalUrl follows a Maps short link to the place URL", async () => {
  const long = "https://www.google.com/maps/place/X/@1,2,15z";
  const net = fakeNet({ "https://maps.app.goo.gl/abc": redirect(long), [long]: () => new Response("ok") });
  assert.equal(await resolveFinalUrl("https://maps.app.goo.gl/abc", net), long);
});
