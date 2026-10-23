// Native motion uses screen DIPs and elapsed time, not accumulated timer steps.
const GRAVITY = 1600
const MAX_CLONES = 10
const SPLIT_COOLDOWN_MS = 400
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function createLaunch(bounds, area, random = Math.random) {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const left = area.x
  const right = area.x + area.width - width
  const ceiling = area.y
  const floor = area.y + area.height - height
  const x = clamp(bounds.x, left, right)
  const y = clamp(bounds.y, ceiling, floor)
  const spaceLeft = x - left
  const spaceRight = right - x
  let direction = random() < 0.5 ? -1 : 1
  const minSpan = area.width / 3
  if ((direction < 0 ? spaceLeft : spaceRight) < minSpan) direction = spaceLeft > spaceRight ? -1 : 1
  const available = direction < 0 ? spaceLeft : spaceRight
  const maxDistance = Math.min(available, area.width * 2 / 3)
  const minDistance = Math.min(minSpan, maxDistance)
  // Randomize within the available range, rather than piling clamped landings at an edge.
  const distance = minDistance + random() * (maxDistance - minDistance)
  const landingX = clamp(x + direction * distance, left, right)
  // A high arc may leave the top of the display; gravity still returns it to the floor.
  const rise = area.height * (0.45 + random() * 0.1)
  const velocity = -Math.sqrt(2 * GRAVITY * rise)
  const flightSeconds = (-velocity + Math.sqrt(velocity ** 2 + 2 * GRAVITY * (floor - y))) / GRAVITY
  const bounceHeight = Math.min(18 + random() * 14, (floor - ceiling) * 0.15)
  const bounceSeconds = 2 * Math.sqrt(2 * bounceHeight / GRAVITY)
  return { x, y, width, height, floor, ceiling, landingX, velocity, flightSeconds,
    bounceHeight, bounceSeconds, duration: (flightSeconds + bounceSeconds * 1.5) * 1000 }
}

function sampleLaunch(plan, elapsedMs) {
  const t = Math.max(0, elapsedMs) / 1000
  let x = plan.landingX
  let y = plan.floor
  let squash = 1
  if (t < plan.flightSeconds) {
    x = plan.x + (plan.landingX - plan.x) * t / plan.flightSeconds
    y = plan.y + plan.velocity * t + 0.5 * GRAVITY * t * t
  } else {
    let sinceImpact = t - plan.flightSeconds
    for (const scale of [1, 0.5]) {
      const duration = plan.bounceSeconds * scale
      if (duration > 0 && sinceImpact < duration) {
        const phase = sinceImpact / duration
        y = plan.floor - plan.bounceHeight * scale ** 2 * 4 * phase * (1 - phase)
        squash = 1 - 0.12 * scale * Math.max(0, 1 - sinceImpact / 0.09)
        break
      }
      sinceImpact -= duration
    }
  }
  return {
    bounds: { x: Math.round(x), y: Math.round(Math.min(y, plan.floor)), width: plan.width, height: plan.height },
    squash, done: elapsedMs >= plan.duration,
  }
}
module.exports = { createLaunch, sampleLaunch, MAX_CLONES, SPLIT_COOLDOWN_MS }
