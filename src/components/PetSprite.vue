<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createPlayback, FRAME_COUNT } from '../lib/playback'
import { rasterSize, displayFramePath, LOOKAHEAD, DECODE_CONCURRENCY } from '../lib/render-budget'
import { canvasPressPoint, pressedSourcePoint, pressDownAmount, releaseAmount, PRESS_RADIUS, PRESS_SETTLE_MS } from '../lib/press-effect'

// Keep tiny animated surfaces CPU-backed instead of accumulating a large GPU image cache.
// This is per-canvas; Electron hardware acceleration remains enabled for window compositing.
const CANVAS_OPTIONS: CanvasRenderingContext2DSettings = { willReadFrequently: true }
const props = defineProps<{ volume: number }>()
const emit = defineEmits<{ ready: [value: boolean]; busy: [value: boolean]; error: [message: string] }>()
const canvas = ref<HTMLCanvasElement>()
const hasDrawn = ref(false)
const firstFrame = `${import.meta.env.BASE_URL}kid/display-360/kid_1.webp`
const audio = new Audio(`${import.meta.env.BASE_URL}kid/kid_transform.mp3`)
audio.preload = 'auto'
audio.loop = false
audio.volume = props.volume
// Frame 1 + current frame + seven-frame lookahead; at most two decodes in flight.
const images = new Map<number, ImageBitmap>()
const pending = new Map<number, AbortController>()
let rasterWidth = 0
let rasterHeight = 0
let generation = 0
let resizeObserver: ResizeObserver | undefined
let densityQuery: MediaQueryList | undefined
let wanted = new Set<number>()
let ready = false
let disposed = false
let failed = false
let request = 0
let drawn = -1
let target = 0
let active = false
let pressPoint: { x: number; y: number } | undefined
let pressAmount = 0
let pressPhase: 'down' | 'held' | 'up' | undefined
let pressStarted = 0
let releaseFrom = 0
let pressRevision = 0
let paintedPressRevision = -1
let reducedMotion: MediaQueryList | undefined
let patchCanvas: HTMLCanvasElement | undefined
let patchContext: CanvasRenderingContext2D | null = null
let patchCache: { bitmap: ImageBitmap; x: number; y: number; width: number; height: number; source: ImageData; output: ImageData } | undefined

function drawPressed(bitmap: ImageBitmap, context: CanvasRenderingContext2D) {
  // Render the unmodified frame first; only a small square around the press is warped.
  context.drawImage(bitmap, 0, 0, rasterWidth, rasterHeight)
  if (!pressPoint || pressAmount === 0) return
  const point = { x: pressPoint.x * rasterWidth / 640, y: pressPoint.y * rasterHeight / 360 }
  const radius = PRESS_RADIUS * Math.min(rasterWidth / 640, rasterHeight / 360)
  if (!patchCanvas || !patchContext) {
    patchCanvas = document.createElement('canvas')
    patchCanvas.width = rasterWidth
    patchCanvas.height = rasterHeight
    patchContext = patchCanvas.getContext('2d', CANVAS_OPTIONS)
  }
  if (!patchContext) return
  const left = Math.max(0, Math.floor(point.x - radius - 2))
  const top = Math.max(0, Math.floor(point.y - radius - 2))
  const width = Math.min(rasterWidth, Math.ceil(point.x + radius + 2)) - left
  const height = Math.min(rasterHeight, Math.ceil(point.y + radius + 2)) - top
  if (!patchCache || patchCache.bitmap !== bitmap || patchCache.x !== left || patchCache.y !== top || patchCache.width !== width || patchCache.height !== height) {
    patchContext.clearRect(0, 0, rasterWidth, rasterHeight)
    patchContext.drawImage(bitmap, 0, 0, rasterWidth, rasterHeight)
    patchCache = { bitmap, x: left, y: top, width, height,
      source: patchContext.getImageData(left, top, width, height), output: new ImageData(width, height) }
  }
  const input = patchCache.source.data
  const output = patchCache.output.data
  output.set(input)
  for (let y = 0; y < height; y++) {
    const dy = y + top - point.y
    for (let x = 0; x < width; x++) {
      const dx = x + left - point.x
      const distance = Math.hypot(dx, dy)
      if (distance >= radius) continue
      const sample = pressedSourcePoint(x + left, y + top, point.x, point.y, pressAmount, radius)
      const sx = Math.max(0, Math.min(width - 1, sample.x - left))
      const sy = Math.max(0, Math.min(height - 1, sample.y - top))
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
      const fx = sx - x0, fy = sy - y0
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
      const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4
      const c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4
      // Interpolate premultiplied color so transparent outlines do not get dark halos.
      const a00 = input[a + 3]! * w00, a10 = input[b + 3]! * w10
      const a01 = input[c + 3]! * w01, a11 = input[d + 3]! * w11
      const alpha = a00 + a10 + a01 + a11
      const index = (y * width + x) * 4
      const falloff = (1 - distance / radius) ** 2
      const shade = 1 + pressAmount * falloff * (0.38 * dy / radius - 0.06)
      for (let channel = 0; channel < 3; channel++) {
        output[index + channel] = alpha > 0
          ? (input[a + channel]! * a00 + input[b + channel]! * a10 + input[c + channel]! * a01 + input[d + channel]! * a11) / alpha * shade
          : 0
      }
      output[index + 3] = alpha
    }
  }
  context.putImageData(patchCache.output, left, top)
  // The radial falloff reaches zero at the boundary; no circular clip is used.
}
function drawBitmap(frame: number) {
  const bitmap = images.get(frame)
  if ((drawn === frame && paintedPressRevision === pressRevision) || !bitmap || disposed) return
  const context = canvas.value?.getContext('2d', CANVAS_OPTIONS)
  if (!context) return
  context.clearRect(0, 0, rasterWidth, rasterHeight)
  drawPressed(bitmap, context)
  drawn = frame
  paintedPressRevision = pressRevision
  hasDrawn.value = true
}
function renderPress() {
  if (disposed) return
  drawBitmap(images.has(target) ? target : drawn)
}
function pressAt(clientX: number, clientY: number) {
  const rect = canvas.value?.getBoundingClientRect()
  if (disposed || !rect) return
  const point = canvasPressPoint(clientX, clientY, rect)
  if (!point) return
  pressPoint = point
  patchCache = undefined
  pressStarted = performance.now()
  pressAmount = reducedMotion?.matches ? 1 : 0.15
  pressPhase = reducedMotion?.matches ? 'held' : 'down'
  pressRevision++
  renderPress()
  ensureTick()
}
function releasePress() {
  if (!pressPoint || pressPhase === 'up') return
  if (reducedMotion?.matches) {
    pressAmount = 0
    pressPoint = undefined
    pressPhase = undefined
    clearPatch()
    pressRevision++
    renderPress()
    return
  }
  releaseFrom = pressAmount
  pressStarted = performance.now()
  pressPhase = 'up'
  ensureTick()
}
function advancePress(now: number) {
  if (pressPhase !== 'down' && pressPhase !== 'up') return
  const elapsed = now - pressStarted
  pressAmount = pressPhase === 'down' ? 0.15 + 0.85 * pressDownAmount(elapsed) : releaseFrom * releaseAmount(elapsed)
  if (pressPhase === 'down' && elapsed >= PRESS_SETTLE_MS) pressPhase = 'held'
  if (pressPhase === 'up' && pressAmount === 0) {
    pressPhase = undefined
    pressPoint = undefined
    clearPatch()
  }
  pressRevision++
}

function clearPatch() {
  patchCache = undefined
  if (patchCanvas) { patchCanvas.width = 1; patchCanvas.height = 1 }
  patchCanvas = undefined
  patchContext = null
}
function syncRaster() {
  const element = canvas.value
  if (!element || disposed) return
  // clientWidth/Height are unaffected by the entrance squash transform.
  const next = rasterSize(element.clientWidth, element.clientHeight, window.devicePixelRatio)
  if (rasterWidth === next.width && rasterHeight === next.height) return
  const previous = images.get(drawn)
  rasterWidth = element.width = next.width
  rasterHeight = element.height = next.height
  clearPatch()
  const context = element.getContext('2d', CANVAS_OPTIONS)
  // Keep a scaled snapshot visible while the new generation is loading.
  if (previous && context) drawPressed(previous, context)
  drawn = -1
  paintedPressRevision = -1
  generation++
  for (const controller of pending.values()) controller.abort()
  for (const bitmap of images.values()) bitmap.close()
  images.clear()
  updateWindow(target)
}
function watchDensity() {
  densityQuery?.removeEventListener('change', densityChanged)
  densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  densityQuery.addEventListener('change', densityChanged)
}
function densityChanged() {
  syncRaster()
  watchDensity()
}
function updateWindow(frame: number) {
  if (disposed || failed) return
  target = frame
  wanted = new Set([0, frame])
  if (active) {
    for (let i = frame; i <= Math.min(FRAME_COUNT - 1, frame + LOOKAHEAD); i++) wanted.add(i)
  }
  for (const [index, controller] of pending) if (!wanted.has(index)) controller.abort()
  for (const [index, bitmap] of images) {
    if (!wanted.has(index)) { bitmap.close(); images.delete(index) }
  }
  pump()
}
function pump() {
  if (disposed || failed) return
  for (const frame of wanted) {
    if (pending.size >= DECODE_CONCURRENCY) break
    if (images.has(frame) || pending.has(frame)) continue
    const controller = new AbortController()
    pending.set(frame, controller)
    void loadFrame(frame, controller, generation, rasterWidth, rasterHeight)
  }
  if (!ready && target === 0 && Array.from(wanted).every((frame) => images.has(frame))) {
    ready = true
    emit('ready', true)
  }
}
async function loadFrame(frame: number, controller: AbortController, loadedGeneration: number, width: number, height: number) {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${displayFramePath(frame, width, height)}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`Missing frame ${frame + 1}`)
    const blob = await response.blob()
    if (disposed || controller.signal.aborted || loadedGeneration !== generation) return
    const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
    if (disposed || controller.signal.aborted || loadedGeneration !== generation || !wanted.has(frame)) bitmap.close()
    else {
      images.set(frame, bitmap)
      if (frame === target) drawBitmap(frame)
    }
  } catch {
    if (!disposed && !failed && !controller.signal.aborted && loadedGeneration === generation) {
      failed = true
      ready = false
      playback.stop()
      emit('ready', false)
      emit('error', '动画素材加载失败，请重新打开桌宠。')
    }
  } finally {
    pending.delete(frame)
    pump()
  }
}
function draw(frame: number) {
  if (disposed) return
  if (frame !== target || wanted.size === 0) updateWindow(frame)
  drawBitmap(frame)
}
const playback = createPlayback({
  audio,
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (id) => clearTimeout(id),
  onFrame: draw,
  onState: (busy) => {
    active = busy
    updateWindow(busy ? 0 : target)
    if (!busy) draw(0)
    if (busy) ensureTick()
    emit('busy', busy)
  },
  onError: () => emit('error', '原声播放失败，请检查音频文件后重试。'),
})
function ensureTick() {
  if (!disposed && !request) request = requestAnimationFrame(tick)
}
function tick(now: number) {
  request = 0
  advancePress(now)
  playback.tick()
  renderPress()
  if (active || pressPhase === 'down' || pressPhase === 'up') ensureTick()
}
function play() {
  if (ready && !disposed && !failed) void playback.play()
}
defineExpose({ play, pressAt, releasePress })
watch(() => props.volume, (value) => { audio.volume = value })
onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncRaster()
  resizeObserver = new ResizeObserver(syncRaster)
  if (canvas.value) resizeObserver.observe(canvas.value)
  window.addEventListener('resize', syncRaster)
  watchDensity()
  if (active || pressPhase === 'down' || pressPhase === 'up') ensureTick()
})
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(request)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', syncRaster)
  densityQuery?.removeEventListener('change', densityChanged)
  generation++
  for (const controller of pending.values()) controller.abort()
  clearPatch()
  playback.stop()
  audio.removeAttribute('src')
  audio.load()
  images.forEach((image) => image.close())
  images.clear()
  if (canvas.value) { canvas.value.width = 1; canvas.value.height = 1 }
})
</script>

<template>
  <span class="kid-sprite" aria-hidden="true">
    <img v-if="!hasDrawn" :src="firstFrame" alt="" draggable="false" />
    <canvas ref="canvas"></canvas>
  </span>
</template>

<style scoped>
.kid-sprite { display: block; position: relative; width: 100%; height: 100%; pointer-events: none; }
img, canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
</style>
