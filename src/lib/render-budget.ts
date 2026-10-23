export const LOOKAHEAD = 7
export const DECODE_CONCURRENCY = 2
const SOURCE_WIDTH = 1280
const SOURCE_HEIGHT = 720

// Match the native client area and display density, never upscale beyond the source.
export function rasterSize(cssWidth: number, cssHeight: number, dpr: number) {
  const width = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 462
  const height = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 260
  const density = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const scale = Math.min(density, SOURCE_WIDTH / width, SOURCE_HEIGHT / height)
  return {
    width: Math.max(1, Math.min(SOURCE_WIDTH, Math.ceil(width * scale))),
    height: Math.max(1, Math.min(SOURCE_HEIGHT, Math.ceil(height * scale))),
  }
}
export function displayFramePath(frame: number, width: number, height: number) {
  const tier = width <= 360 && height <= 203 ? 'display-360/'
    : width <= 640 && height <= 360 ? 'display-640/'
    : width <= 960 && height <= 540 ? 'display-960/' : ''
  return `kid/${tier}kid_${frame + 1}.webp`
}
