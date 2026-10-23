import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const { createLaunch, sampleLaunch, MAX_CLONES } = require('../electron/clone-motion.cjs')
const { normalizeSettings } = require('../electron/settings.cjs')

test('launch stays horizontally inside the work area and finishes on a common floor', () => {
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1600, y: -200, width: 1600, height: 900 },
    { x: 0, y: 0, width: 100, height: 100 },
  ]) for (const random of [() => 0, () => 0.5, () => 0.999]) {
    const plan = createLaunch({ x: area.x + 20, y: area.y + 30, width: 191, height: 260 }, area, random)
    for (let ms = 0; ms <= plan.duration; ms += 8) {
      const { bounds } = sampleLaunch(plan, ms)
      assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width)
      assert.ok(bounds.y + bounds.height <= area.y + area.height)
    }
    const final = sampleLaunch(plan, plan.duration + 100)
    assert.equal(final.bounds.y + final.bounds.height, area.y + area.height)
    assert.equal(final.squash, 1)
    assert.equal(final.done, true)
  }
})
test('launch rises about half a screen and can travel above the display before landing', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  for (const random of [() => 0, () => 0.5, () => 1]) {
    const plan = createLaunch({ x: 300, y: 40, width: 191, height: 260 }, area, random)
    const peak = sampleLaunch(plan, -plan.velocity / 1600 * 1000)
    assert.ok(Math.abs(plan.y - peak.bounds.y - area.height * (0.45 + random() * 0.1)) <= 0.5)
    assert.ok(peak.bounds.y < area.y, 'peak must not be clipped to the screen top')
    const landed = sampleLaunch(plan, plan.duration)
    assert.equal(landed.bounds.y + landed.bounds.height, area.y + area.height)
    assert.equal(landed.done, true)
  }
})
test('horizontal launch spans a large screen fraction and spreads landings instead of clamping them together', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  for (const x of [0, 300, 864, 1729]) {
    const landings = new Set()
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      const plan = createLaunch({ x, y: 500, width: 191, height: 260 }, area, () => value)
      const span = Math.abs(plan.landingX - plan.x)
      assert.ok(span >= area.width / 3)
      assert.ok(span <= area.width * 2 / 3)
      assert.ok(plan.landingX >= 0 && plan.landingX + plan.width <= area.width)
      landings.add(Math.round(plan.landingX))
    }
    assert.ok(landings.size >= 4, 'random launches must not all pile up at the same edge')
  }
})
test('flight lifts then falls, bounces twice with decreasing height and fully settles', () => {
  const plan = createLaunch({ x: 300, y: 300, width: 191, height: 260 }, { x: 0, y: 0, width: 1920, height: 1040 }, () => 0.5)
  assert.ok(sampleLaunch(plan, 50).bounds.y < plan.y)
  const impact = plan.flightSeconds * 1000
  assert.equal(sampleLaunch(plan, impact).bounds.y, plan.floor)
  assert.ok(sampleLaunch(plan, impact).squash < 1)
  const firstPeak = sampleLaunch(plan, impact + plan.bounceSeconds * 500).bounds.y
  const secondPeak = sampleLaunch(plan, impact + plan.bounceSeconds * 1250).bounds.y
  assert.ok(firstPeak < secondPeak && secondPeak < plan.floor)
  assert.equal(sampleLaunch(plan, plan.duration).done, true)
  assert.deepEqual(sampleLaunch(plan, 1e6).bounds, sampleLaunch(plan, plan.duration).bounds)
})
test('clone mode defaults off, validates booleans and preserves partial settings', () => {
  assert.equal(normalizeSettings({}).cloneMode, false)
  assert.equal(normalizeSettings({ cloneMode: 'true' }).cloneMode, false)
  assert.equal(normalizeSettings({ cloneMode: true }).cloneMode, true)
  assert.equal(normalizeSettings({ volume: 10 }, { volume: 70, size: 100, cloneMode: true }).cloneMode, true)
})

async function fleetFixture() {
  let now = 0, nextId = 1, latestMenu
  const intervals = new Map()
  const timeouts = new Map()
  const ipcMain = new EventEmitter()
  ipcMain.handle = (channel, handler) => ipcMain.on(channel, handler)
  const windows = []
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.id = nextId++; this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
      this.visible = false; this.top = options.alwaysOnTop; this.dead = false; this.sent = []
      this.webContents = new EventEmitter()
      this.webContents.mainFrame = { url: 'pet://app/index.html' }
      this.webContents.send = (channel, value) => this.sent.push({ channel, value })
      this.webContents.setWindowOpenHandler = () => {}
      windows.push(this)
    }
    loadURL() { this.webContents.emit('did-start-loading'); return Promise.resolve() }
    getContentBounds() { return { ...this.bounds } }
    setContentBounds(bounds) { this.bounds = { ...bounds } }
    isDestroyed() { return this.dead }
    isAlwaysOnTop() { return this.top }
    setAlwaysOnTop(value) { this.top = value }
    show() { this.visible = true; this.emit('show') }
    showInactive() { this.show() }
    hide() { this.visible = false; this.emit('hide') }
    center() { this.bounds.x = 400; this.bounds.y = 200 }
    destroy() { this.dead = true; this.visible = false; this.emit('closed') }
  }
  class FakeTray extends EventEmitter {
    isDestroyed() { return false }
    setToolTip() {}
    setContextMenu(menu) { latestMenu = menu }
  }
  const app = new EventEmitter()
  Object.assign(app, { isPackaged: true, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getPath: () => '/profile', quit: () => { app.emit('before-quit'); for (const w of windows) if (!w.dead) w.destroy() } })
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const screen = new EventEmitter()
  Object.assign(screen, { getPrimaryDisplay: () => ({ workArea: area }), getDisplayMatching: () => ({ workArea: area }),
    getDisplayNearestPoint: () => ({ workArea: area }), getCursorScreenPoint: () => ({ x: 200, y: 200 }) })
  const Menu = { buildFromTemplate: (template) => ({ template, popup: ({ window }) => { latestMenu = { template, owner: window } } }) }
  const electron = { app, BrowserWindow: FakeWindow, ipcMain, Menu, Tray: FakeTray, screen,
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, net: {}, nativeImage: {} }
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : name === 'node:fs' ? { readFileSync: () => { throw new Error('new profile') }, mkdirSync() {}, writeFileSync() {}, renameSync() {} }
      : name.startsWith('./') ? require(`../electron/${name.slice(2)}`) : require(name),
    __dirname: new URL('../electron', import.meta.url).pathname, process: { platform: 'win32' }, console, URL,
    performance: { now: () => now },
    setTimeout: (fn, delay) => { const id = { unref() {} }; timeouts.set(id, { fn, at: now + delay }); return id },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn) => { const id = Symbol(); intervals.set(id, fn); return id }, clearInterval: (id) => intervals.delete(id),
  })
  vm.runInContext(readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8'), context)
  await new Promise((resolve) => setImmediate(resolve))
  const emit = (window, channel, value, frame = window.webContents.mainFrame) => ipcMain.emit(channel, { sender: window.webContents, senderFrame: frame }, value)
  const state = (window, next = {}) => emit(window, 'pet:playback-state', { ready: true, busy: false, error: '', ...next })
  const menu = (label) => latestMenu.template.find((item) => item.label?.startsWith(label))
  const ready = (window, stateFirst = false) => {
    if (stateFirst) state(window)
    window.emit('ready-to-show')
    if (!stateFirst) state(window)
  }
  const update = (next) => { context.next = next; vm.runInContext('updateSettings(next)', context) }
  const split = (window) => { now += 401; emit(window, 'pet:split') }
  const advance = (ms) => { now += ms; for (const fn of [...intervals.values()]) fn();
    for (const [id, timer] of [...timeouts]) if (timer.at <= now) { timeouts.delete(id); timer.fn() } }
  return { context, app, windows, emit, state, ready, menu, update, split, advance, intervals,
    count: () => vm.runInContext('cloneCount()', context), menuOwner: () => latestMenu.owner }
}

test('clone waits for renderer AND native readiness, starts music once, then aligns to floor', async () => {
  for (const stateFirst of [false, true]) {
    const f = await fleetFixture(), root = f.windows[0]
    f.ready(root); f.update({ cloneMode: true }); f.split(root)
    const child = f.windows[1]
    assert.equal(f.count(), 1)
    assert.equal(child.visible, false)
    if (stateFirst) { f.state(child); assert.equal(child.visible, false); child.emit('ready-to-show') }
    else { child.emit('ready-to-show'); assert.equal(child.visible, false); f.state(child) }
    assert.equal(child.visible, true)
    assert.equal(child.sent.filter((s) => s.channel === 'pet:play').length, 1)
    f.state(child, { busy: true }); f.state(child, { busy: false })
    assert.equal(child.sent.filter((s) => s.channel === 'pet:play').length, 1)
    f.advance(5000)
    assert.equal(child.bounds.y + child.bounds.height, 1040)
    assert.equal(f.intervals.size, 0)
    assert.equal(child.options.webPreferences.autoplayPolicy, 'no-user-gesture-required')
  }
})
test('split has mode guard, trusted-frame validation, cooldown and a hard 10-clone cap including loading windows', async () => {
  const f = await fleetFixture(), root = f.windows[0]
  f.ready(root); f.split(root); assert.equal(f.count(), 0)
  f.update({ cloneMode: true })
  f.emit(root, 'pet:split', undefined, { url: 'pet://app/index.html' }); assert.equal(f.count(), 0)
  root.webContents.mainFrame.url = 'https://evil.example/'
  f.split(root); assert.equal(f.count(), 0)
  root.webContents.mainFrame.url = 'pet://app/index.html'
  f.split(root); f.emit(root, 'pet:split'); assert.equal(f.count(), 1)
  for (let i = 0; i < 20; i++) f.split(root)
  assert.equal(f.count(), MAX_CLONES)
  f.menu('清空分身').click()
  assert.equal(f.count(), 0); assert.equal(root.dead, false)
  assert.ok(f.windows.slice(1).every((w) => w.dead))
  f.split(root); assert.equal(f.count(), 1)
})
test('clones split too, right-click menu belongs to that clone and clear stops in-flight audio/windows', async () => {
  const f = await fleetFixture(), root = f.windows[0]
  f.ready(root); f.update({ cloneMode: true }); f.split(root)
  const child = f.windows[1]; f.ready(child)
  f.emit(child, 'pet:open-menu'); assert.equal(f.menuOwner(), child)
  const before = root.sent.filter((s) => s.channel === 'pet:play').length
  f.menu('变身一次').click()
  assert.equal(root.sent.filter((s) => s.channel === 'pet:play').length, before + 1)
  assert.equal(child.sent.filter((s) => s.channel === 'pet:play').length, 2)
  f.split(child); assert.equal(f.count(), 2)
  f.menu('清空分身').click()
  assert.equal(f.intervals.size, 0)
  assert.equal(f.count(), 0)
  // Delayed readiness after clear must never resurrect a window.
  f.ready(f.windows[2]); assert.equal(f.windows[2].visible, false)
})
test('settings, topmost and visibility are shared; resize/drag cancels flight without shifting size', async () => {
  const f = await fleetFixture(), root = f.windows[0]
  f.ready(root); f.update({ cloneMode: true }); f.split(root)
  const child = f.windows[1]; f.ready(child)
  f.update({ volume: 20, size: 60 })
  for (const window of [root, child]) {
    assert.equal(window.bounds.width, 277); assert.equal(window.bounds.height, 156)
    assert.equal(window.sent.filter((s) => s.channel === 'pet:settings-changed').at(-1).value.volume, 20)
  }
  assert.equal(child.bounds.y + child.bounds.height, 1040)
  f.menu('始终置顶').click({ checked: false })
  assert.equal(root.top, false); assert.equal(child.top, false)
  f.menu('隐藏桌宠').click(); assert.equal(root.visible, false); assert.equal(child.visible, false)
  f.split(root); assert.equal(f.count(), 1)
  f.menu('显示桌宠').click(); assert.equal(root.visible, true); assert.equal(child.visible, true)
  f.split(child); const other = f.windows[2]; f.ready(other)
  assert.equal(other.top, false)
  f.emit(other, 'pet:drag-start'); assert.equal(f.intervals.size, 1, 'press alone must not freeze a flying pet')
  f.emit(other, 'pet:drag-move'); assert.equal(f.intervals.size, 0); assert.equal(other.bounds.width, 277)
  f.app.quit(); assert.ok(f.windows.every((w) => w.dead))
})
test('failed clone material loads release their reserved slot', async () => {
  const f = await fleetFixture(), root = f.windows[0]
  f.ready(root); f.update({ cloneMode: true }); f.split(root)
  f.state(f.windows[1], { ready: false, error: 'missing media' })
  assert.equal(f.count(), 0)
  f.split(root); assert.equal(f.count(), 1)
  f.windows[2].webContents.emit('did-fail-load', {}, -105)
  assert.equal(f.count(), 0)
  f.split(root); f.advance(15_001)
  assert.equal(f.count(), 0, 'stalled loading releases its reserved slot')
})

test('hiding during preparation defers clone entrance and music until shown again', async () => {
  const f = await fleetFixture(), root = f.windows[0]
  f.ready(root); f.update({ cloneMode: true }); f.split(root)
  const child = f.windows[1]
  f.menu('隐藏桌宠').click()
  f.ready(child)
  assert.equal(child.visible, false)
  assert.equal(child.sent.filter((s) => s.channel === 'pet:play').length, 0)
  f.advance(20_000)
  assert.equal(child.dead, false)
  f.menu('显示桌宠').click()
  assert.equal(child.visible, true)
  assert.equal(child.sent.filter((s) => s.channel === 'pet:play').length, 1)
})

test('menu plays every ready instance, even if its owner is busy, without restarting busy pets or splitting', async () => {
  const f = await fleetFixture(), root = f.windows[0]
  f.ready(root); f.update({ cloneMode: true })
  for (let i = 0; i < 3; i++) f.split(root)
  const [busyChild, idleChild, loadingChild] = f.windows.slice(1)
  f.ready(busyChild); f.ready(idleChild)
  f.state(root, { busy: true }); f.state(busyChild, { busy: true })
  f.emit(busyChild, 'pet:open-menu')
  assert.equal(f.menu('变身一次').enabled, true)
  const count = (w) => w.sent.filter((s) => s.channel === 'pet:play').length
  const before = f.windows.map(count)
  f.menu('变身一次').click()
  assert.deepEqual(f.windows.map(count), [before[0], before[1], before[2] + 1, before[3]])
  assert.equal(f.count(), 3, 'global menu playback never creates another clone')
  f.state(idleChild, { busy: true })
  assert.equal(f.menu('变身一次').enabled, false)
  f.state(root); f.state(busyChild); f.state(idleChild)
  const readyBefore = f.windows.map(count)
  f.menu('变身一次').click()
  assert.deepEqual(f.windows.map(count), [readyBefore[0] + 1, readyBefore[1] + 1, readyBefore[2] + 1, readyBefore[3]])
  f.ready(loadingChild)
  assert.equal(count(loadingChild), 1, 'loading clone starts once upon readiness, not an extra queued replay')
})
test('global playback restores hidden pets and does not double-play a prepared clone entrance', async () => {
  const f = await fleetFixture(), root = f.windows[0]
  f.ready(root); f.update({ cloneMode: true }); f.split(root)
  const child = f.windows[1]
  f.menu('隐藏桌宠').click(); f.ready(child)
  f.menu('变身一次').click()
  for (const pet of [root, child]) {
    assert.equal(pet.visible, true)
    assert.equal(pet.sent.filter((s) => s.channel === 'pet:play').length, 1)
  }
})
