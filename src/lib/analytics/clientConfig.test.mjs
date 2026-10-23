import test from "node:test";
import assert from "node:assert/strict";
import { consentPromptVisible, internalParam, maskAttribute, posthogInitOptions, scrubEvent, scrubPath, scrubUrl, viaParam } from "./clientConfig.ts";

test("posthogInitOptions holds exactly the pinned values", () => {
  const { session_recording: rec, ...rest } = posthogInitOptions({ host: "http://localhost:3399" });
  assert.equal(rec.maskAttributeFn, maskAttribute);
  assert.deepEqual({ ...rest, session_recording: { ...rec, maskAttributeFn: "fn" } }, {
    api_host: "http://localhost:3399",
    persistence: "localStorage+cookie",
    capture_pageview: "history_change",
    person_profiles: "always",
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      maskAttributeFn: "fn",
      captureCanvas: { recordCanvas: false },
    },
    capture_exceptions: true,
  });
});

test("viaParam accepts a short word and rejects markup, long values and the empty string", () => {
  assert.equal(viaParam("?via=linkedin"), "linkedin");
  assert.equal(viaParam("?x=1&via=friends-2026"), "friends-2026");
  assert.equal(viaParam("?via=" + "a".repeat(24)), "a".repeat(24));
  assert.equal(viaParam("?via=" + "a".repeat(25)), null);
  assert.equal(viaParam("?via=%3Cscript%3E"), null);
  assert.equal(viaParam("?via=a%20b"), null);
  assert.equal(viaParam("?via="), null);
  assert.equal(viaParam(""), null);
});

test("internalParam is true only for internal=1", () => {
  assert.equal(internalParam("?internal=1"), true);
  assert.equal(internalParam("?a=b&internal=1"), true);
  assert.equal(internalParam("?internal=true"), false);
  assert.equal(internalParam("?internal=0"), false);
  assert.equal(internalParam(""), false);
});

test("consentPromptVisible is true only when neither the server nor this device has an answer", () => {
  assert.equal(consentPromptVisible(null, null), true);
  assert.equal(consentPromptVisible(true, null), false);
  assert.equal(consentPromptVisible(false, null), false);
  assert.equal(consentPromptVisible(null, true), false);
  assert.equal(consentPromptVisible(null, false), false);
  assert.equal(consentPromptVisible(false, true), false);
});

test("scrubPath swaps a share token and a trip id for the route pattern and leaves other routes alone", () => {
  assert.equal(scrubPath("/s/abc123DEF"), "/s/:token");
  assert.equal(scrubPath("/trip/0b1c-22"), "/trip/:id");
  assert.equal(scrubPath("/trip/0b1c-22/print"), "/trip/:id/print");
  assert.equal(scrubPath("/trip/latest"), "/trip/latest");
  assert.equal(scrubPath("/trips"), "/trips");
  assert.equal(scrubPath("/profile"), "/profile");
  assert.equal(scrubPath("/"), "/");
});

test("scrubUrl scrubs the path, keeps origin and query, and passes a non-URL through", () => {
  assert.equal(scrubUrl("https://tripmate.app/s/SECRET?via=x"), "https://tripmate.app/s/:token?via=x");
  assert.equal(scrubUrl("http://localhost:3300/trip/9f8e7d"), "http://localhost:3300/trip/:id");
  assert.equal(scrubUrl("not a url"), "not a url");
});

test("scrubEvent drops the title, scrubs url and path properties, person bags and snapshot hrefs", () => {
  const ev = scrubEvent({
    event: "$pageview",
    properties: {
      title: "Kyoto in spring · TripMate",
      $current_url: "http://localhost:3300/trip/abc",
      $pathname: "/trip/abc",
      $session_entry_url: "http://localhost:3300/s/tok",
      $set: { $current_url: "http://localhost:3300/trip/abc" },
      $set_once: { $initial_current_url: "http://localhost:3300/s/tok", $initial_pathname: "/s/tok" },
      $snapshot_data: [{ type: 4, data: { href: "http://localhost:3300/trip/abc" } }, { type: 3 }],
      keep: "me",
    },
  });
  assert.equal(ev.properties.title, undefined);
  assert.equal(ev.properties.$current_url, "http://localhost:3300/trip/:id");
  assert.equal(ev.properties.$pathname, "/trip/:id");
  assert.equal(ev.properties.$session_entry_url, "http://localhost:3300/s/:token");
  assert.equal(ev.properties.$set.$current_url, "http://localhost:3300/trip/:id");
  assert.equal(ev.properties.$set_once.$initial_current_url, "http://localhost:3300/s/:token");
  assert.equal(ev.properties.$set_once.$initial_pathname, "/s/:token");
  assert.equal(ev.properties.$snapshot_data[0].data.href, "http://localhost:3300/trip/:id");
  assert.equal(ev.properties.keep, "me");
  assert.equal(scrubEvent(null), null);
});

test("maskAttribute keeps rendering attributes and stars out everything that can carry words", () => {
  assert.equal(maskAttribute("class", "pb-field is-on"), "pb-field is-on");
  assert.equal(maskAttribute("style", "color:red"), "color:red");
  assert.equal(maskAttribute("placeholder", "An allergy"), "**********");
  assert.equal(maskAttribute("aria-label", "Close"), "*****");
  assert.equal(maskAttribute("value", "peanuts"), "*******");
  assert.equal(maskAttribute("href", "/trip/abc"), "*********");
  assert.equal(maskAttribute("data-day-title", "Kyoto"), "*****");
  assert.equal(maskAttribute("src", "/api/place-photo?q=Kyoto"), "*".repeat(24));
  assert.equal(maskAttribute("stroke-width", "2"), "2");
});

test("maskAttribute strips url() from style and _cssText but keeps the rest, passes rr_* and still masks title and alt", () => {
  assert.equal(maskAttribute("style", "color:red;background-image:url(/api/place-photo?q=Kyoto);top:0"), "color:red;background-image:url();top:0");
  assert.equal(maskAttribute("style", `background:url("https://upload.wikimedia.org/a b.jpg") no-repeat, url('x.png')`), "background:url() no-repeat, url()");
  assert.equal(maskAttribute("_cssText", ".a{background:url(/x.png)}@font-face{src:url(/f.woff2)}"), ".a{background:url()}@font-face{src:url()}");
  assert.equal(maskAttribute("rr_width", "320px"), "320px");
  assert.equal(maskAttribute("rr_scrollTop", "40"), "40");
  assert.equal(maskAttribute("rr_dataURL", "data:image/png;base64,AAAA"), "*".repeat(26));
  assert.equal(maskAttribute("title", "Kyoto"), "*****");
  assert.equal(maskAttribute("alt", "Kyoto"), "*****");
});

test("scrubEvent also scrubs the previous pageview's path and the referrer", () => {
  const ev = scrubEvent({ event: "$pageview", properties: { $prev_pageview_pathname: "/trip/abc/print", $referrer: "http://localhost:3300/s/tok" } });
  assert.equal(ev.properties.$prev_pageview_pathname, "/trip/:id/print");
  assert.equal(ev.properties.$referrer, "http://localhost:3300/s/:token");
});
