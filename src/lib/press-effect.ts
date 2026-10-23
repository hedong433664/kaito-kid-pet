export const PRESS_RADIUS = 68
export const PRESS_STRENGTH = 0.68
export const PRESS_SETTLE_MS = 320
export const RELEASE_SETTLE_MS = 720

export function pressedSourcePoint(x: number, y: number, centerX: number, centerY: number, amount: number, radius = PRESS_RADIUS) {
  const dx = x - centerX
  const dy = y - centerY
  const distance = Math.hypot(dx, dy)
  if (radius <= 0 || distance >= radius || amount === 0) return { x, y }
  const falloff = (1 - distance / radius) ** 2
  const scale = 1 + PRESS_STRENGTH * amount * falloff
  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale - radius * 0.055 * amount * falloff,
  }
}
export function pressDownAmount(elapsed: number) {
  if (elapsed <= 0) return 0
  if (elapsed >= PRESS_SETTLE_MS) return 1
  return 1 - Math.exp(-elapsed / 40) * Math.cos(elapsed / 42)
}
export function releaseAmount(elapsed: number) {
  if (elapsed <= 0) return 1
  if (elapsed >= RELEASE_SETTLE_MS) return 0
  return Math.exp(-elapsed / 135) * Math.cos(elapsed / 34)
}
export function canvasPressPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return undefined
  const scale = Math.min(rect.width / 640, rect.height / 360)
  const x = (clientX - rect.left - (rect.width - 640 * scale) / 2) / scale
  const y = (clientY - rect.top - (rect.height - 360 * scale) / 2) / scale
  if (x < 0 || x > 640 || y < 0 || y > 360) return undefined
  return { x, y }
}
