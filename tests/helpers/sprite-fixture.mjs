import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createPlayback, FRAME_COUNT } from '../../src/lib/playback.ts'
import * as press from '../../src/lib/press-effect.ts'
import * as budget from '../../src/lib/render-budget.ts'

export function spriteFixture({ deferred = false, missing = false } = {}) {
  let now = 0, mounted, unmount, exposed, plays = 0, active = 0, peakActive = 0
  const frames = [], events = [], requests = [], bitmaps = [], waiters = [], observers = [], contextOptions = []
  const mainContext = { clearRect() {}, drawImage(bitmap) { frames.push(bitmap.frame) }, putImageData() {} }
  const element = { clientWidth: 462, clientHeight: 260, width: 300, height: 150, getContext: (_type, options) => { contextOptions.push(options); return mainContext },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: element.clientWidth, height: element.clientHeight }) }
  const media = []
  const fixture = { deferred }
  const context = vm.createContext({
    ...press, ...budget, createPlayback, FRAME_COUNT, AbortController,
    ResizeObserver: class { constructor(fn) { this.fn = fn; observers.push(this) } observe() {} disconnect() { this.disconnected = true } },
    defineProps: () => ({ volume: 0.7 }), defineEmits: () => (...args) => events.push(args),
    defineExpose: (api) => { exposed = api }, ref: (value) => ({ value }), watch() {},
    onMounted: (fn) => { mounted = fn }, onBeforeUnmount: (fn) => { unmount = fn },
    performance: { now: () => now }, window: {
      devicePixelRatio: 1.5, addEventListener() {}, removeEventListener() {},
      matchMedia: () => { const query = { matches: false, addEventListener() {}, removeEventListener() {} }; media.push(query); return query },
    },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {},
    Audio: class { currentTime = 0; play() { plays++; return Promise.resolve() } pause() {} removeAttribute() {} load() {} },
    fetch: async (url, { signal }) => { requests.push({ url, signal }); return { ok: !missing, blob: async () => Number(url.match(/kid_(\d+)/)[1]) - 1 } },
    createImageBitmap: (frame, options) => {
      active++; peakActive = Math.max(peakActive, active)
      return new Promise((resolve, reject) => {
        const complete = () => {
          active--
          const bitmap = { frame, ...options, width: options.resizeWidth, height: options.resizeHeight, closed: false, close() { this.closed = true } }
          bitmaps.push(bitmap); resolve(bitmap)
        }
        if (fixture.deferred) waiters.push({ resolve: complete, reject: () => { active--; reject(new Error('decode rejected')) } })
        else complete()
      })
    },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {},
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }) }) }) },
    ImageData: class { constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4) } },
    fakeCanvas: element,
  })
  const source = readFileSync(new URL('../../src/components/PetSprite.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '').replaceAll('import.meta.env.BASE_URL', "'/'")
  vm.runInContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  vm.runInContext('canvas.value = fakeCanvas', context)
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  Object.assign(fixture, { context, element, frames, events, requests, bitmaps, waiters, observers, media, contextOptions, settle,
    mount: () => mounted(), unmount: () => unmount(), play: () => exposed.play(), api: () => exposed,
    run: (code) => vm.runInContext(code, context), plays: () => plays, active: () => active, peakActive: () => peakActive,
    tick: async (time) => { now = time; context.tick(time); await settle() },
    stats: () => vm.runInContext('({ count: images.size, pending: pending.size, wanted: wanted.size, rasterWidth, rasterHeight, ready, active, failed })', context),
  })
  return fixture
}
