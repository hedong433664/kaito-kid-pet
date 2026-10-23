// All native coordinates are Electron screen DIPs, never renderer pixels.
function fitWindowSize(desired, area) {
  const scale = Math.min(1, area.width / desired.width, area.height / desired.height)
  return {
    width: Math.max(1, Math.round(desired.width * scale)),
    height: Math.max(1, Math.round(desired.height * scale)),
  }
}
function clampBounds(bounds, area) {
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y))),
    width: bounds.width,
    height: bounds.height,
  }
}
function resizedBounds(current, desired, area) {
  const size = fitWindowSize(desired, area)
  return clampBounds({
    x: current.x + (current.width - size.width) / 2,
    y: current.y + current.height - size.height,
    ...size,
  }, area)
}
function draggedBounds(session, cursor, desired, area) {
  const size = fitWindowSize(desired, area)
  return clampBounds({
    x: session.bounds.x + cursor.x - session.cursor.x,
    y: session.bounds.y + cursor.y - session.cursor.y,
    ...size,
  }, area)
}
module.exports = { fitWindowSize, resizedBounds, draggedBounds }
