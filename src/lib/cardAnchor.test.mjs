/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/cardAnchor.test.mjs
 *
 * The card's geometry is the half of an anchored card that fails silently — it just looks slightly
 * wrong at some pan positions on some screens. These are the cases a browser will not tell you
 * about until somebody complains that "the card sits funny sometimes". */
import test from "node:test";
import assert from "node:assert/strict";

import { OFFSCREEN_MARGIN_PX, anchorCard } from "./cardAnchor.ts";

const CARD = { width: 340, height: 420 };
/** A 1440x900 viewport with the search panel on the left and the itinerary panel on the right. */
const CLEAR = { left: 376, right: 1080, top: 56, bottom: 884 };

test("with room on every side, the card is centred above its pin", () => {
  const p = anchorCard({ x: 700, y: 600 }, CARD, CLEAR);
  assert.equal(p.x, 700 - CARD.width / 2);
  assert.equal(p.above, true);
  assert.ok(p.y + CARD.height < 600, "card sits above the pin");
  // Tail in the middle, because the card did not have to move off the pin.
  assert.equal(p.tailX, CARD.width / 2);
});

test("a pin near the search panel clamps right and the tail points exactly at it", () => {
  const p = anchorCard({ x: CLEAR.left + 40, y: 600 }, CARD, CLEAR);
  assert.equal(p.x, CLEAR.left, "clamped to the clear rect, not centred off-screen");
  assert.equal(p.tailX, 40, "tail still points at the pin");
  assert.ok(p.tailX < CARD.width / 2, "tail moved left of centre");
});

test("a pin under the itinerary panel clamps left and the tail points exactly at it", () => {
  const p = anchorCard({ x: CLEAR.right - 40, y: 600 }, CARD, CLEAR);
  assert.equal(p.x, CLEAR.right - CARD.width);
  assert.equal(p.tailX, CARD.width - 40);
  assert.ok(p.tailX > CARD.width / 2, "tail moved right of centre");
});

test("closer to the edge than the tail inset, the tail stops rather than reaching the corner", () => {
  // The last few pixels are the trade this makes deliberately: the tail stops pointing precisely so
  // that it never becomes a spike on the card's own rounded corner, where it reads as damage.
  const left = anchorCard({ x: CLEAR.left + 4, y: 600 }, CARD, CLEAR);
  assert.equal(left.x, CLEAR.left);
  assert.ok(left.tailX > 4, "tail did not follow the pin all the way into the corner");
  assert.ok(left.tailX <= 24);

  const right = anchorCard({ x: CLEAR.right - 4, y: 600 }, CARD, CLEAR);
  assert.ok(right.tailX < CARD.width - 4);
  assert.ok(right.tailX >= CARD.width - 24);
});

test("a pin near the top flips the card below it rather than under the navbar", () => {
  const p = anchorCard({ x: 700, y: 100 }, CARD, CLEAR);
  assert.equal(p.above, false);
  assert.ok(p.y > 100, "card sits below the pin");
  assert.ok(p.y >= CLEAR.top);
});

test("the tail never reaches the card's own corner, however hard it is clamped", () => {
  // Walk the pin across the whole rect and well past both edges.
  for (let x = CLEAR.left - OFFSCREEN_MARGIN_PX; x <= CLEAR.right + OFFSCREEN_MARGIN_PX; x += 7) {
    const p = anchorCard({ x, y: 600 }, CARD, CLEAR);
    if (!p) continue;
    assert.ok(p.tailX >= 0 && p.tailX <= CARD.width, `tail ${p.tailX} outside the card at x=${x}`);
    assert.ok(p.tailX >= 20 && p.tailX <= CARD.width - 20, `tail ${p.tailX} in the corner at x=${x}`);
  }
});

test("the card stays inside the clear rect everywhere it is shown", () => {
  for (let x = CLEAR.left - 200; x <= CLEAR.right + 200; x += 11) {
    for (let y = CLEAR.top - 200; y <= CLEAR.bottom + 200; y += 13) {
      const p = anchorCard({ x, y }, CARD, CLEAR);
      if (!p) continue;
      assert.ok(p.x >= CLEAR.left, `x ${p.x} left of the rect at ${x},${y}`);
      assert.ok(p.x + CARD.width <= CLEAR.right, `x ${p.x} right of the rect at ${x},${y}`);
      assert.ok(p.y >= CLEAR.top, `y ${p.y} above the rect at ${x},${y}`);
      assert.ok(p.y + CARD.height <= CLEAR.bottom, `y ${p.y} below the rect at ${x},${y}`);
    }
  }
});

test("a pin well outside the rect is refused, because project() never refuses for us", () => {
  assert.equal(anchorCard({ x: 700, y: -400 }, CARD, CLEAR), null);
  assert.equal(anchorCard({ x: -900, y: 600 }, CARD, CLEAR), null);
  assert.equal(anchorCard({ x: 4000, y: 600 }, CARD, CLEAR), null);
  // Just inside the margin still places, so panning does not blink the card away early.
  assert.ok(anchorCard({ x: CLEAR.left - OFFSCREEN_MARGIN_PX + 1, y: 600 }, CARD, CLEAR));
});

test("a clear rect narrower than the card pins to its left edge rather than off-screen", () => {
  // Happens on a small laptop with both panels open. Readable failure, not a card at x = -30.
  const narrow = { left: 400, right: 700, top: 56, bottom: 884 };
  const p = anchorCard({ x: 550, y: 600 }, CARD, narrow);
  assert.equal(p.x, narrow.left);
});
