const DEFAULT_SETTINGS = Object.freeze({ volume: 70, size: 100, cloneMode: false })
function normalizeSettings(value, fallback = DEFAULT_SETTINGS) {
  const clamp = (next, current, min, max) => typeof next === 'number' && Number.isFinite(next)
    ? Math.max(min, Math.min(max, Math.round(next))) : current
  return {
    cloneMode: typeof value?.cloneMode === 'boolean' ? value.cloneMode : (fallback.cloneMode ?? false),
    volume: clamp(value?.volume, fallback.volume, 0, 100),
    size: clamp(value?.size, fallback.size, 60, 160),
  }
}
function windowSize(size) {
  const scale = normalizeSettings({ size }).size / 100
  return { width: Math.round(260 * 1280 / 720 * scale), height: Math.round(260 * scale) }
}
module.exports = { DEFAULT_SETTINGS, normalizeSettings, windowSize }
