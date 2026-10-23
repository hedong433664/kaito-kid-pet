import test from 'node:test'
import assert from 'node:assert/strict'
import { rasterSize, displayFramePath, LOOKAHEAD, DECODE_CONCURRENCY } from '../src/lib/render-budget.ts'
import { spriteFixture } from './helpers/sprite-fixture.mjs'

test('raster size follows window dimensions and DPI with a native-resolution ceiling', () => {
  assert.deepEqual(rasterSize(462, 260, 1.5), { width: 693, height: 390 })
  assert.deepEqual(rasterSize(462, 260, 2), { width: 924, height: 520 })
  assert.deepEqual(rasterSize(740, 416, 2), { width: 1280, height: 720 })
  assert.deepEqual(rasterSize(1280, 720, 4), { width: 1280, height: 720 })
  assert.deepEqual(rasterSize(NaN, 0, Infinity), { width: 462, height: 260 })
  assert.ok(LOOKAHEAD + 2 <= 10)
  assert.equal(DECODE_CONCURRENCY, 2)
})
test('choose a suitable landscape display tier without upscaling', () => {
  assert.equal(displayFramePath(0, 277, 156), 'kid/display-360/kid_1.webp')
  assert.equal(displayFramePath(49, 462, 260), 'kid/display-640/kid_50.webp')
  assert.equal(displayFramePath(49, 693, 390), 'kid/display-960/kid_50.webp')
  assert.equal(displayFramePath(240, 1280, 720), 'kid/kid_241.webp')
})
test('startup and rolling playback stay within a nine-frame live cache and two decoders', async () => {
  const f = spriteFixture(); f.mount(); await f.settle()
  assert.equal(f.element.width, 693); assert.equal(f.element.height, 390)
  assert.equal(f.stats().count, 1)
  assert.ok(f.contextOptions.every((options) => options.willReadFrequently === true))
  assert.ok(f.requests.every((r) => r.url.includes('display-960/')))
  f.play(); await f.settle()
  for (let time = 34; time <= 1800; time += 34) {
    await f.tick(time)
    assert.ok(f.stats().count <= 9)
    assert.ok(f.stats().wanted <= 9)
    assert.ok(f.stats().pending <= 2)
  }
  assert.ok(f.peakActive() <= 2)
  assert.ok(f.bitmaps.filter((b) => !b.closed).length <= 9)
  assert.ok(f.bitmaps.filter((b) => b.closed).length > 30)
  f.unmount()
  assert.ok(f.bitmaps.every((b) => b.closed))
  assert.equal(f.element.width, 1)
})
test('window resize and display-density change release old generations without restarting audio', async () => {
  const f = spriteFixture(); f.mount(); await f.settle(); f.play(); await f.settle(); await f.tick(500)
  const old = [...f.bitmaps]
  f.element.clientWidth = 740; f.element.clientHeight = 416
  f.context.syncRaster(); await f.settle()
  assert.equal(f.element.width, 1110); assert.equal(f.element.height, 624)
  assert.ok(old.every((b) => b.closed))
  assert.match(f.requests.at(-1).url, /^\/kid\/kid_\d+\.webp$/)
  f.context.window.devicePixelRatio = 2
  f.context.densityChanged(); await f.settle()
  assert.equal(f.element.width, 1280); assert.equal(f.element.height, 720)
  assert.match(f.requests.at(-1).url, /^\/kid\/kid_\d+\.webp$/)
  assert.equal(f.plays(), 1)
  assert.equal(f.stats().active, true)
  assert.equal(f.stats().ready, true)
  f.unmount()
  assert.ok(f.observers.every((o) => o.disconnected))
})
test('late decode from an old size is closed and never installed into the new cache', async () => {
  const f = spriteFixture({ deferred: true }); f.mount(); await f.settle()
  f.run('void playback.play()'); await f.settle()
  assert.equal(f.active(), 2)
  f.element.clientWidth = 277; f.element.clientHeight = 156
  f.context.syncRaster()
  assert.ok(f.requests.every((r) => r.signal.aborted))
  assert.equal(f.active(), 2, 'old and new generations must share the concurrency cap')
  f.deferred = false
  for (const waiter of f.waiters.splice(0)) waiter.resolve()
  await f.settle()
  assert.ok(f.bitmaps.slice(0, 2).every((b) => b.closed))
  assert.ok(f.bitmaps.filter((b) => !b.closed).every((b) => b.width === 416 && b.height === 234))
  assert.equal(f.stats().failed, false)
  assert.equal(f.stats().ready, true)
  assert.ok(f.peakActive() <= 2)
  f.unmount()
})
test('aborted stale decode errors are ignored but current material errors still surface', async () => {
  const f = spriteFixture({ deferred: true }); f.mount(); await f.settle()
  f.element.clientWidth = 277; f.context.syncRaster(); f.deferred = false
  for (const waiter of f.waiters.splice(0)) waiter.reject()
  await f.settle()
  assert.equal(f.stats().failed, false)
  assert.equal(f.events.filter(([name]) => name === 'error').length, 0)
  f.unmount()
  const missing = spriteFixture({ missing: true }); missing.mount(); await missing.settle()
  assert.equal(missing.stats().failed, true)
  assert.ok(missing.events.some(([name]) => name === 'error'))
  missing.unmount()
})
test('unmount aborts pending work, closes late bitmaps and never refills the cache', async () => {
  const f = spriteFixture({ deferred: true }); f.mount(); await f.settle()
  f.unmount()
  for (const waiter of f.waiters.splice(0)) waiter.resolve()
  await f.settle()
  assert.ok(f.requests.every((r) => r.signal.aborted))
  assert.ok(f.bitmaps.every((b) => b.closed))
  assert.equal(f.stats().count, 0); assert.equal(f.stats().pending, 0)
})
test('press uses display-sized pixels and releases its auxiliary canvas after spring-back', async () => {
  const f = spriteFixture(); f.mount(); await f.settle()
  f.api().pressAt(231, 130)
  assert.equal(f.run('patchCanvas.width'), 693)
  assert.equal(f.run('patchCanvas.height'), 390)
  f.api().releasePress(); await f.tick(800)
  assert.equal(f.run('patchCanvas'), undefined)
  f.unmount()
})
