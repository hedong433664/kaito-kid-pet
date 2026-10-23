import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { FRAME_COUNT, DURATION_MS } from '../src/lib/playback.ts'
const assets = new URL('../public/kid/', import.meta.url)
const profiles = [[360, 203], [640, 360], [960, 540]]

function verifyImage(image, width, height, name) {
  assert.equal(image.subarray(0, 4).toString(), 'RIFF')
  assert.equal(image.subarray(8, 12).toString(), 'WEBP')
  assert.equal(image.readUInt32LE(4) + 8, image.length)
  assert.equal(image.toString('ascii', 12, 16), 'VP8X')
  assert.ok(image[20] & 0x10, `${name} must retain alpha`)
  assert.equal(image.readUIntLE(24, 3) + 1, width)
  assert.equal(image.readUIntLE(27, 3) + 1, height)
}

test('all 241 native 24fps transparent transformation frames, audio and metadata are bundled', async () => {
  const expected = Array.from({ length: FRAME_COUNT }, (_, i) => `kid_${i + 1}.webp`)
  expected.push('kid_transform.mp3', 'metadata.json', ...profiles.map(([width]) => `display-${width}`))
  assert.deepEqual((await readdir(assets)).sort(), expected.sort())
  const metadata = JSON.parse(await readFile(new URL('metadata.json', assets), 'utf8'))
  assert.equal(metadata.frames, FRAME_COUNT)
  assert.equal(metadata.fps, 24)
  assert.ok(Math.abs(metadata.durationMs - DURATION_MS) < 1e-6)
  assert.equal(metadata.idleFrame, 1)
  let total = 0
  for (let i = 1; i <= FRAME_COUNT; i++) {
    const image = await readFile(new URL(`kid_${i}.webp`, assets))
    verifyImage(image, 1280, 720, i); total += image.length
  }
  assert.ok(total < 64 * 1024**2)
  assert.ok((await readFile(new URL('kid_transform.mp3', assets))).length > 0)
})
test('each display tier contains the complete aligned transparent sequence', async () => {
  let total = 0
  for (const [width, height] of profiles) {
    const directory = new URL(`display-${width}/`, assets)
    const expected = Array.from({ length: FRAME_COUNT }, (_, i) => `kid_${i + 1}.webp`)
    assert.deepEqual((await readdir(directory)).sort(), expected.sort())
    for (const name of expected) {
      const image = await readFile(new URL(name, directory))
      verifyImage(image, width, height, name); total += image.length
    }
  }
  assert.ok(total < 64 * 1024**2)
})
