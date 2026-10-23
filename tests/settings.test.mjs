import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { DEFAULT_SETTINGS, normalizeSettings, windowSize } = require('../electron/settings.cjs')

test('tray settings retain defaults, reject invalid values and clamp ranges', () => {
  assert.deepEqual(normalizeSettings(undefined), { volume: 70, size: 100, cloneMode: false })
  assert.deepEqual(normalizeSettings({ volume: 120, size: 10 }), { volume: 100, size: 60, cloneMode: false })
  assert.deepEqual(normalizeSettings({ volume: -10, size: 999 }), { volume: 0, size: 160, cloneMode: false })
  assert.deepEqual(normalizeSettings({ volume: NaN, size: Infinity }), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ volume: '20', size: null }), DEFAULT_SETTINGS)
})
test('partial settings changes preserve other settings and custom values', () => {
  assert.deepEqual(normalizeSettings({ volume: 25 }, { volume: 70, size: 135 }), { volume: 25, size: 135, cloneMode: false })
  assert.deepEqual(normalizeSettings({ size: 150 }, { volume: 25, size: 135, cloneMode: false }), { volume: 25, size: 150, cloneMode: false })
})
test('image-only window has no previous toolbar or speech space', () => {
  assert.deepEqual(windowSize(100), { width: 462, height: 260 })
  assert.deepEqual(windowSize(60), { width: 277, height: 156 })
  assert.deepEqual(windowSize(160), { width: 740, height: 416 })
})
