const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, protocol, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { DEFAULT_SETTINGS, normalizeSettings, windowSize } = require('./settings.cjs')
const { pathToFileURL } = require('node:url')
const { fitWindowSize, resizedBounds, draggedBounds } = require('./geometry.cjs')
const { createLaunch, sampleLaunch, MAX_CLONES, SPLIT_COOLDOWN_MS } = require('./clone-motion.cjs')

const DEV_URL = 'http://127.0.0.1:5174'
let petWindow
let tray
let quitting = false
let hidden = false
let motionTimer
let settings = { ...DEFAULT_SETTINGS }
let storedSettings = false
// Reserve a slot at window creation, including clones still loading offscreen.
const pets = new Map()
const emptyPlayback = () => ({ ready: false, busy: false, error: '' })
const cloneCount = () => [...pets.values()].filter((pet) => pet.clone).length

function settingsPath() { return path.join(app.getPath('userData'), 'kid-settings.json') }
function loadSettings() {
  try {
    settings = normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
    storedSettings = true
  } catch { /* A new profile starts with the default settings. */ }
}
function refreshMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
}
function send(pet, channel, value) {
  if (!pet.window.isDestroyed()) pet.window.webContents.send(channel, value)
}
function stopMotion(pet) {
  pet.flight = undefined
  send(pet, 'pet:motion', { squash: 1 })
  if (![...pets.values()].some((item) => item.flight) && motionTimer) {
    clearInterval(motionTimer)
    motionTimer = undefined
  }
}
function landPet(pet) {
  const bounds = pet.window.getContentBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const next = resizedBounds(bounds, windowSize(settings.size), area)
  next.y = area.y + area.height - next.height
  pet.window.setContentBounds(next)
}
function resizePets() {
  for (const pet of pets.values()) {
    const flying = !!pet.flight || pet.pendingLaunch
    stopMotion(pet)
    pet.dragSession = undefined
    const bounds = pet.window.getContentBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    pet.window.setContentBounds(resizedBounds(bounds, windowSize(settings.size), area))
    if (flying && !pet.pendingLaunch) landPet(pet)
  }
}
function updateSettings(next) {
  const previousSize = settings.size
  settings = normalizeSettings(next, settings)
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    const temporary = `${settingsPath()}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(settings), 'utf8')
    fs.renameSync(temporary, settingsPath())
    storedSettings = true
  } catch (error) { console.warn('Unable to persist pet settings:', error.message) }
  if (settings.size !== previousSize) resizePets()
  for (const pet of pets.values()) send(pet, 'pet:settings-changed', { ...settings })
  refreshMenu()
}
protocol.registerSchemesAsPrivileged([
  { scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])
function petFor(event) {
  const pet = [...pets.values()].find((item) => item.window.webContents === event.sender)
  if (!pet || pet.window.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return undefined
  try {
    const url = new URL(event.senderFrame.url)
    if (app.isPackaged ? url.protocol !== 'pet:' || url.host !== 'app' : url.origin !== DEV_URL) return undefined
    return pet
  } catch { return undefined }
}
function animatePets() {
  const now = performance.now()
  for (const pet of pets.values()) {
    if (!pet.flight || pet.window.isDestroyed()) continue
    const motion = sampleLaunch(pet.flight.plan, now - pet.flight.started)
    // Pin content size on every move: setPosition can accumulate fractional-DPI rounding.
    pet.window.setContentBounds(motion.bounds)
    send(pet, 'pet:motion', { squash: motion.squash })
    if (motion.done) stopMotion(pet)
  }
}
function launchWhenReady(pet) {
  if (pet.shownReady && pet.state.ready && pet.loadingTimer) {
    clearTimeout(pet.loadingTimer)
    pet.loadingTimer = undefined
  }
  if (hidden || !pet.pendingLaunch || !pet.shownReady || !pet.state.ready || pet.state.error || pet.window.isDestroyed()) return
  pet.pendingLaunch = false // A ready-state update must never replay the entrance/music.
  const bounds = pet.window.getContentBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const plan = createLaunch({ ...bounds, ...fitWindowSize(windowSize(settings.size), area) }, area)
  pet.flight = { plan, started: performance.now() }
  pet.window.setContentBounds(sampleLaunch(plan, 0).bounds)
  if (!hidden) pet.window.showInactive()
  send(pet, 'pet:play')
  if (!motionTimer) motionTimer = setInterval(animatePets, 16)
}
function createWindow(source) {
  const clone = !!source
  const area = clone ? screen.getDisplayMatching(source.window.getContentBounds()).workArea : screen.getPrimaryDisplay().workArea
  const petSize = fitWindowSize(windowSize(settings.size), area)
  const initial = clone
    ? resizedBounds(source.window.getContentBounds(), petSize, area)
    : { x: area.x + area.width - petSize.width - 24, y: area.y + area.height - petSize.height - 24, ...petSize }
  const window = new BrowserWindow({
    ...initial,
    useContentSize: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: petWindow?.isAlwaysOnTop() ?? true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      // A newly-created clone has no DOM user activation; only bundled local media is allowed.
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  // Pin initial client geometry as well as every motion frame on fractional-DPI displays.
  window.setContentBounds(initial)
  const pet = { window, clone, state: emptyPlayback(), shownReady: false, pendingLaunch: clone,
    flight: undefined, dragSession: undefined, loadingTimer: undefined, lastSplit: -Infinity }
  pets.set(window.id, pet)
  if (clone) {
    pet.loadingTimer = setTimeout(() => {
      if (!window.isDestroyed() && pet.pendingLaunch && (!pet.shownReady || !pet.state.ready)) window.destroy()
    }, 15_000)
    pet.loadingTimer.unref?.()
  }
  if (!clone) petWindow = window
  window.once('ready-to-show', () => {
    pet.shownReady = true
    if (clone) launchWhenReady(pet)
    else if (!hidden) window.show()
  })
  window.on('close', (event) => {
    if (!quitting && !clone) { event.preventDefault(); hidePets() }
  })
  window.on('closed', () => {
    if (pet.loadingTimer) clearTimeout(pet.loadingTimer)
    pets.delete(window.id)
    stopMotion(pet)
    if (!clone) petWindow = undefined
    refreshMenu()
  })
  window.on('show', refreshMenu)
  window.on('hide', refreshMenu)
  window.webContents.on('did-start-loading', () => {
    pet.state = emptyPlayback()
    pet.dragSession = undefined
    stopMotion(pet)
    refreshMenu()
  })
  window.webContents.on('render-process-gone', () => {
    if (clone) window.destroy()
  })
  window.webContents.on('did-fail-load', (_event, code) => {
    if (clone && code !== -3) window.destroy()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  void window.loadURL(app.isPackaged ? 'pet://app/index.html' : DEV_URL).catch((error) => {
    console.warn('Unable to load pet:', error.message)
    if (clone && !window.isDestroyed()) window.destroy()
  })
  refreshMenu()
  return pet
}
function showPet() {
  hidden = false
  if (!petWindow) createWindow()
  for (const pet of pets.values()) {
    if (pet.pendingLaunch) launchWhenReady(pet)
    else pet.window.show()
  }
}
function hidePets() {
  hidden = true
  for (const pet of pets.values()) {
    if (pet.flight) { stopMotion(pet); landPet(pet) }
    pet.window.hide()
  }
}
function clearClones() {
  for (const pet of [...pets.values()]) {
    if (pet.clone) pet.window.destroy() // Destroy immediately, also stopping audio/loading/flight.
  }
  refreshMenu()
}
function splitPet(pet) {
  if (!settings.cloneMode || !pet.state.ready || hidden || quitting || cloneCount() >= MAX_CLONES) return
  const now = performance.now()
  if (now - pet.lastSplit < SPLIT_COOLDOWN_MS) return
  pet.lastSplit = now
  createWindow(pet)
}
function canPlayPet(pet) {
  return !pet.window.isDestroyed() && !pet.pendingLaunch && pet.state.ready && !pet.state.busy
}
function playAllPets() {
  // Snapshot before showPet: a hidden, prepared clone starts its own entrance/music on show.
  const targets = [...pets.values()].filter(canPlayPet)
  if (!targets.length) return
  showPet()
  for (const pet of targets) if (canPlayPet(pet)) send(pet, 'pet:play')
}
function menuTemplate(target = pets.get(petWindow?.id)) {
  const state = target?.state ?? emptyPlayback()
  const volumes = [...new Set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, settings.volume])].sort((a, b) => a - b)
  const sizes = [...new Set([60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, settings.size])].sort((a, b) => a - b)
  return [
    { label: state.error || (state.busy ? '正在变身…' : state.ready ? '怪盗基德已就绪' : '正在准备动画…'), enabled: false },
    { label: '变身一次', enabled: [...pets.values()].some(canPlayPet), click: playAllPets },
    { type: 'separator' },
    { label: '双击分身', type: 'checkbox', checked: settings.cloneMode,
      click: (item) => updateSettings({ cloneMode: item.checked }) },
    { label: `清空分身（${cloneCount()}/${MAX_CLONES}）`, enabled: cloneCount() > 0, click: clearClones },
    { type: 'separator' },
    { label: `音量：${settings.volume}%`, submenu: volumes.map((volume) => ({
      label: volume === 0 ? '静音（0%）' : `${volume}%`, type: 'radio', checked: settings.volume === volume,
      click: () => updateSettings({ volume }),
    })) },
    { label: `大小：${settings.size}%`, submenu: sizes.map((size) => ({
      label: `${size}%`, type: 'radio', checked: settings.size === size,
      click: () => updateSettings({ size }),
    })) },
    { type: 'separator' },
    { label: '始终置顶', type: 'checkbox', checked: petWindow?.isAlwaysOnTop() ?? true,
      click: (item) => { for (const pet of pets.values()) pet.window.setAlwaysOnTop(item.checked); refreshMenu() } },
    { label: hidden ? '显示桌宠' : '隐藏桌宠', click: () => hidden ? showPet() : hidePets() },
    { label: '重置位置', click: () => { showPet(); if (target && !target.window.isDestroyed()) { stopMotion(target); target.window.center() } } },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ]
}
function createTray() {
  const iconFile = process.platform === 'win32' ? 'tray.ico' : 'tray.png'
  let icon = path.join(__dirname, iconFile)
  if (process.platform === 'darwin') {
    const source = nativeImage.createFromPath(icon)
    const menuBarIcon = nativeImage.createEmpty()
    for (const scaleFactor of [1, 2]) {
      menuBarIcon.addRepresentation({ scaleFactor,
        buffer: source.resize({ width: 18 * scaleFactor, height: 18 * scaleFactor, quality: 'best' }).toPNG() })
    }
    icon = menuBarIcon
  }
  tray = new Tray(icon)
  tray.setToolTip('kaito-kid-pet · 右键打开操作菜单')
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
  tray.on('click', showPet)
}
function registerIpc() {
  ipcMain.handle('pet:get-settings', (event) => {
    if (!petFor(event)) return { ...DEFAULT_SETTINGS }
    if (!storedSettings) updateSettings()
    return { ...settings }
  })
  ipcMain.on('pet:playback-state', (event, state) => {
    const pet = petFor(event)
    if (!pet || !state || typeof state.ready !== 'boolean' || typeof state.busy !== 'boolean' || typeof state.error !== 'string') return
    const next = { ready: state.ready, busy: state.busy, error: state.error.slice(0, 160) }
    if (JSON.stringify(next) === JSON.stringify(pet.state)) return
    pet.state = next
    if (pet.clone && pet.pendingLaunch && next.error) { pet.window.destroy(); return }
    launchWhenReady(pet)
    refreshMenu()
  })
  ipcMain.on('pet:split', (event) => { const pet = petFor(event); if (pet) splitPet(pet) })
  ipcMain.on('pet:open-menu', (event) => {
    const pet = petFor(event)
    if (!pet) return
    pet.dragSession = undefined
    Menu.buildFromTemplate(menuTemplate(pet)).popup({ window: pet.window })
  })
  ipcMain.on('pet:drag-start', (event) => {
    const pet = petFor(event)
    if (!pet) return
    pet.dragSession = { cursor: screen.getCursorScreenPoint(), bounds: pet.window.getContentBounds() }
  })
  ipcMain.on('pet:drag-move', (event) => {
    const pet = petFor(event)
    if (!pet?.dragSession) return
    if (pet.flight) stopMotion(pet)
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    const bounds = draggedBounds(pet.dragSession, cursor, windowSize(settings.size), area)
    pet.window.setContentBounds(bounds)
  })
  ipcMain.on('pet:drag-end', (event) => { const pet = petFor(event); if (pet) pet.dragSession = undefined })
}
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showPet)
  app.on('before-quit', () => {
    quitting = true
    if (motionTimer) clearInterval(motionTimer)
    motionTimer = undefined
  })
  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide()
    loadSettings()
    protocol.handle('pet', (request) => {
      const url = new URL(request.url)
      const root = path.resolve(__dirname, '../dist')
      let file
      try { file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`) }
      catch { return new Response('Bad request', { status: 400 }) }
      if (url.host !== 'app' || !file.startsWith(`${root}${path.sep}`)) {
        return new Response('Forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(file).toString())
    })
    registerIpc()
    createWindow()
    createTray()
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, resizePets)
  })
  app.on('activate', showPet)
}
