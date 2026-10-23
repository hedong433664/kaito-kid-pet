import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Windows tray ICO contains all eight transparent DPI sizes', async () => {
  const ico = await readFile(new URL('../electron/tray.ico', import.meta.url))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 8)
  const sizes = []
  for (let i = 0; i < 8; i++) {
    const entry = 6 + i * 16
    const width = ico[entry] || 256
    const height = ico[entry + 1] || 256
    assert.equal(width, height)
    assert.equal(ico.readUInt16LE(entry + 6), 32)
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    assert.ok(offset + length <= ico.length)
    const png = ico.subarray(offset, offset + length)
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.equal(png[25], 6, 'icon image must retain RGBA transparency')
    sizes.push(width)
  }
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 20, 24, 32, 48, 64, 128, 256])
})
test('PNG tray fallback is transparent and icons are included in packaging', async () => {
  const png = await readFile(new URL('../electron/tray.png', import.meta.url))
  assert.equal(png.readUInt32BE(16), 256)
  assert.equal(png.readUInt32BE(20), 256)
  assert.equal(png[25], 6)
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.build.files.includes('electron/**/*'))
})
