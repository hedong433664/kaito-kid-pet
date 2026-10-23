import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { spriteFixture } from './helpers/sprite-fixture.mjs'
import { DURATION_MS } from '../src/lib/playback.ts'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
function appFixture() {
  let plays = 0, menus = 0, splits = 0, drags = 0, presses = 0, releases = 0
  const script = appSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const context = vm.createContext({
    window: { desktopPet: { startDrag() {}, moveDrag() { drags++ }, endDrag() {}, openMenu() { menus++ }, split() { splits++ } } },
    ref: (value) => ({ value }), watch() {}, onMounted() {}, onBeforeUnmount() {},
  })
  vm.runInContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  context.fakeSprite = { play() { plays++ }, pressAt() { presses++ }, releasePress() { releases++ } }
  vm.runInContext('sprite.value = fakeSprite; ready.value = true', context)
  function gesture(detail, drag = false) {
    context.startDrag({ button: 0, pointerId: 1, screenX: 0, screenY: 0, clientX: 30, clientY: 40,
      currentTarget: { setPointerCapture() {} } })
    if (drag) context.moveDrag({ pointerId: 1, screenX: 10, screenY: 0 })
    context.endDrag({ pointerId: 1, type: 'pointerup' })
    context.handleClick({ detail })
    if (detail === 2) context.doubleClick()
  }
  return { context, gesture, stats: () => ({ plays, menus, splits, drags, presses, releases }) }
}

test('single click only presses; double click plays and busy state rejects repeats', () => {
  const f = appFixture()
  f.gesture(1)
  assert.equal(f.stats().plays, 0)
  f.gesture(2)
  assert.equal(f.stats().plays, 1)
  assert.equal(f.stats().presses, 2)
  vm.runInContext('playing.value = true', f.context)
  f.gesture(1); f.gesture(2)
  assert.equal(f.stats().plays, 1)
})
test('split mode double-click creates once and plays; busy double-click splits without restarting audio', () => {
  const f = appFixture()
  vm.runInContext('cloneMode.value = true', f.context)
  f.gesture(1)
  assert.equal(f.stats().splits, 0)
  f.gesture(2)
  assert.equal(f.stats().splits, 1)
  assert.equal(f.stats().plays, 1)
  vm.runInContext('playing.value = true', f.context)
  f.gesture(1); f.gesture(2)
  assert.equal(f.stats().splits, 2)
  assert.equal(f.stats().plays, 1)
  f.gesture(1, true); f.gesture(2)
  assert.equal(f.stats().splits, 2)
})
test('dragging either click cannot trigger playback and a fresh double click works', () => {
  for (const firstDrag of [true, false]) {
    const f = appFixture()
    f.gesture(1, firstDrag); f.gesture(2, !firstDrag)
    assert.equal(f.stats().plays, 0)
    assert.equal(f.stats().drags, 1)
    f.gesture(1); f.gesture(2)
    assert.equal(f.stats().plays, 1)
  }
})
test('right click opens the desktop menu without playing or deforming', () => {
  const f = appFixture()
  f.context.startDrag({ button: 2 })
  f.context.openMenu()
  assert.equal(f.stats().menus, 1)
  assert.equal(f.stats().plays, 0)
  assert.equal(f.stats().presses, 0)
  assert.match(appSource, /@contextmenu.prevent="openMenu"/)
  assert.doesNotMatch(appSource, /@pointerenter|@pointerleave|previewFrame/)
  assert.match(appSource, /title="双击原声变身"/)
})
test('standby always holds frame 1 silently, including after a full transformation', async () => {
  const f = spriteFixture(); f.mount(); await f.settle()
  assert.equal(f.frames.at(-1), 0)
  assert.equal(f.stats().count, 1)
  assert.equal(f.run('request'), 0, 'static standby must not keep a RAF loop alive')
  for (const time of [3000, 5000, 15000, 60000]) await f.tick(time)
  assert.ok(f.frames.every((frame) => frame === 0))
  assert.equal(f.plays(), 0)
  f.play(); f.play(); await f.settle()
  assert.equal(f.plays(), 1)
  await f.tick(60501)
  assert.equal(f.frames.at(-1), 12)
  await f.tick(60000 + DURATION_MS)
  assert.equal(f.frames.at(-1), 0)
  await f.tick(90000)
  assert.equal(f.frames.at(-1), 0)
  assert.equal(f.stats().count, 1)
  assert.equal(f.run('request'), 0)
  f.unmount()
})
