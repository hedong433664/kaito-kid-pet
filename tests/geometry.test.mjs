import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { fitWindowSize, resizedBounds, draggedBounds } = require('../electron/geometry.cjs')
const { windowSize } = require('../electron/settings.cjs')
const area = { x: 0, y: 0, width: 2048, height: 1112 }

test('resize keeps bottom center anchored without old transparent margins', () => {
  const old = { x: 500, y: 300, width: 462, height: 260 }
  assert.deepEqual(resizedBounds(old, windowSize(60), area), { x: 593, y: 404, width: 277, height: 156 })
  assert.deepEqual(resizedBounds(old, windowSize(160), area), { x: 361, y: 144, width: 740, height: 416 })
})
test('drag follows native DIP cursor deltas without changing the grab offset', () => {
  const session = { bounds: { x: 300, y: 400, width: 462, height: 260 }, cursor: { x: 340, y: 450 } }
  const result = draggedBounds(session, { x: 373, y: 477 }, windowSize(100), area)
  assert.deepEqual(result, { x: 333, y: 427, width: 462, height: 260 })
  assert.equal(373 - result.x, 40)
  assert.equal(477 - result.y, 50)
})
test('every move pins configured size instead of reusing DPI-rounded native dimensions', () => {
  for (const size of [60, 80, 100, 130, 160]) {
    const expected = windowSize(size)
    const session = { bounds: { x: 300, y: 400, width: expected.width + 1, height: expected.height + 1 }, cursor: { x: 340, y: 450 } }
    for (let i = 0; i < 500; i++) {
      const result = draggedBounds(session, { x: 340 + i % 100, y: 450 + i % 50 }, expected, area)
      assert.equal(result.width, expected.width)
      assert.equal(result.height, expected.height)
    }
  }
})
test('small size uses its own screen edge limits, not the old larger size', () => {
  const session = { bounds: { x: 300, y: 400, width: 740, height: 416 }, cursor: { x: 340, y: 450 } }
  const result = draggedBounds(session, { x: 3000, y: 3000 }, windowSize(60), area)
  assert.deepEqual(result, { x: 1771, y: 956, width: 277, height: 156 })
})
test('secondary monitor offsets and negative coordinates remain native DIPs', () => {
  const secondary = { x: -1920, y: -164, width: 1920, height: 1161 }
  const session = { bounds: { x: -1500, y: 100, width: 462, height: 260 }, cursor: { x: -1460, y: 150 } }
  assert.deepEqual(draggedBounds(session, { x: -1420, y: 170 }, windowSize(100), secondary), {
    x: -1460, y: 120, width: 462, height: 260,
  })
})
test('resize and drag clamp at all work-area edges', () => {
  const current = { x: 2000, y: 1100, width: 462, height: 260 }
  assert.deepEqual(resizedBounds(current, windowSize(160), area), { x: 1308, y: 696, width: 740, height: 416 })
  const session = { bounds: current, cursor: { x: 2010, y: 1110 } }
  assert.deepEqual(draggedBounds(session, { x: -999, y: -999 }, windowSize(60), area), { x: 0, y: 0, width: 277, height: 156 })
})
test('small work area fits the window proportionally', () => {
  assert.deepEqual(fitWindowSize(windowSize(160), { width: 100, height: 100 }), { width: 100, height: 56 })
})
