import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelLeftEdgePx, panelBiasDirection } from './mapRenderer.ts';

test('journal framing uses the right-hand visible width and reverses the camera bias', () => {
  globalThis.window = { innerWidth: 1440 };
  globalThis.document = { querySelector: () => ({ dataset: { journal: 'true' }, classList: { contains: () => false }, getBoundingClientRect: () => ({ left: 0, right: 720 }) }) };
  try {
    assert.equal(panelLeftEdgePx(true, 1440), 720);
    assert.equal(panelBiasDirection(), -1);
    assert.equal(panelLeftEdgePx(false, 1440), 1440);
    window.innerWidth = 800;
    assert.equal(panelLeftEdgePx(true, 800), 800);
    assert.equal(panelBiasDirection(), 1);
  } finally { delete globalThis.window; delete globalThis.document; }
});

test('collapsed journals and legacy right panels retain their framing', () => {
  globalThis.window = { innerWidth: 1440 };
  let collapsed = false;
  const panel = { dataset: {}, classList: { contains: () => collapsed }, getBoundingClientRect: () => ({ left: 900, right: 1420 }) };
  globalThis.document = { querySelector: () => panel };
  try {
    assert.equal(panelLeftEdgePx(true, 1440), 900);
    assert.equal(panelBiasDirection(), 1);
    panel.dataset.journal = 'true'; collapsed = true;
    assert.equal(panelLeftEdgePx(true, 1440), 1440);
    assert.equal(panelBiasDirection(), 1);
  } finally { delete globalThis.window; delete globalThis.document; }
});
