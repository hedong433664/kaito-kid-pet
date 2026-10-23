import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasPressPoint, pressedSourcePoint, pressDownAmount, releaseAmount, PRESS_RADIUS, PRESS_SETTLE_MS, RELEASE_SETTLE_MS } from '../src/lib/press-effect.ts'

test('press deformation has bounded support: pixels at and outside radius stay unchanged', () => {
  for (const amount of [-0.25, 0.15, 1, 1.1]) {
    for (const [x, y] of [[140, 0], [0, -140], [150, 20], [-200, 200]]) {
      assert.deepEqual(pressedSourcePoint(x, y, 0, 0, amount), { x, y })
    }
  }
})
test('zero pressure is exactly the original image mapping', () => {
  for (const [x, y] of [[270, 370], [300, 400], [150, 300]]) {
    assert.deepEqual(pressedSourcePoint(x, y, 270, 370, 0), { x, y })
  }
})
test('press changes nearby samples without a discontinuity at the radius', () => {
  assert.notDeepEqual(pressedSourcePoint(300, 390, 270, 370, 1), { x: 300, y: 390 })
  const p = pressedSourcePoint(PRESS_RADIUS - 0.001, 0, 0, 0, 1)
  assert.ok(Math.abs(p.x - (PRESS_RADIUS - 0.001)) < 0.001)
  assert.ok(Math.abs(p.y) < 0.001)
})
test('local press sampling remains inside its bounded patch', () => {
  for (const amount of [-0.25, 0.15, 1.1]) {
    for (let y = -PRESS_RADIUS; y <= PRESS_RADIUS; y += 5) for (let x = -PRESS_RADIUS; x <= PRESS_RADIUS; x += 5) {
      const p = pressedSourcePoint(x, y, 0, 0, amount)
      assert.ok(Math.abs(p.x) <= PRESS_RADIUS + 1)
      assert.ok(Math.abs(p.y) <= PRESS_RADIUS + 1)
    }
  }
})
test('press settles and release overshoots with damping before exactly returning to zero', () => {
  assert.equal(pressDownAmount(0), 0)
  assert.equal(pressDownAmount(PRESS_SETTLE_MS), 1)
  assert.equal(releaseAmount(0), 1)
  assert.ok(releaseAmount(100) < 0, 'release should slightly overshoot rather than stop abruptly')
  assert.ok(Math.abs(releaseAmount(400)) < Math.abs(releaseAmount(100)))
  assert.equal(releaseAmount(RELEASE_SETTLE_MS), 0)
  assert.equal(releaseAmount(10_000), 0)
})
test('press center follows the displayed image at every pet size', () => {
  for (const scale of [0.6, 1, 1.6]) {
    const rect = { left: 120, top: 80, width: 640 * scale, height: 360 * scale }
    const point = canvasPressPoint(rect.left + 320 * scale, rect.top + 180 * scale, rect)
    assert.ok(Math.abs(point.x - 320) < 1e-8)
    assert.ok(Math.abs(point.y - 180) < 1e-8)
  }
})
test('letterboxing is accounted for and invalid pointer coordinates are ignored', () => {
  const rect = { left: 10, top: 20, width: 100, height: 200 }
  const center = canvasPressPoint(60, 120, rect)
  assert.ok(Math.abs(center.x - 320) < 1e-8)
  assert.ok(Math.abs(center.y - 180) < 1e-8)
  assert.equal(canvasPressPoint(11, 21, rect), undefined)
  assert.equal(canvasPressPoint(NaN, 120, rect), undefined)
  assert.equal(canvasPressPoint(60, 120, { ...rect, width: 0 }), undefined)
})
