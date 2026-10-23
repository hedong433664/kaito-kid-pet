import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayback, DURATION_MS, FRAME_COUNT, frameAt } from '../src/lib/playback.ts'

function fixture(play = () => Promise.resolve()) {
  let now = 0
  let finish
  const frames = []
  const states = []
  let plays = 0
  let pauses = 0
  let errors = 0
  const audio = { currentTime: 9, play: () => { plays++; return play() }, pause: () => { pauses++ } }
  const controller = createPlayback({
    audio, now: () => now,
    schedule: (callback, delay) => { assert.equal(delay, DURATION_MS); finish = callback; return 1 },
    cancel: () => { finish = undefined },
    onFrame: (frame) => frames.push(frame), onState: (busy) => states.push(busy), onError: () => errors++,
  })
  return { controller, audio, frames, states, advance: (ms) => { now = ms; controller.tick() },
    finish: () => finish?.(), plays: () => plays, pauses: () => pauses, errors: () => errors }
}

test('241 frames cover the native 24fps transformation without looping', () => {
  assert.equal(FRAME_COUNT, 241)
  for (let i = 0; i < FRAME_COUNT; i++) assert.equal(frameAt((i + 0.1) * DURATION_MS / FRAME_COUNT), i)
  assert.equal(frameAt(-1), 0)
  assert.equal(frameAt(DURATION_MS - 1), FRAME_COUNT - 1)
  assert.equal(frameAt(DURATION_MS), FRAME_COUNT - 1)
})
test('repeated clicks cannot restart audio or animation; completes at frame 1', async () => {
  const f = fixture()
  const first = f.controller.play()
  assert.equal(await f.controller.play(), false)
  assert.equal(await first, true)
  for (let i = 0; i < 30; i++) assert.equal(await f.controller.play(), false)
  assert.equal(f.plays(), 1)
  f.advance(DURATION_MS - 1)
  assert.equal(f.frames.at(-1), FRAME_COUNT - 1)
  f.advance(DURATION_MS)
  assert.equal(f.frames.at(-1), 0)
  assert.equal(f.audio.currentTime, 0)
  assert.deepEqual(f.states, [true, false])
  assert.equal(await f.controller.play(), true)
  assert.equal(f.plays(), 2)
})
test('timer completes even without rendering frames', async () => {
  const f = fixture()
  await f.controller.play()
  f.finish()
  assert.equal(f.frames.at(-1), 0)
  assert.equal(f.states.at(-1), false)
  assert.equal(f.pauses(), 1)
})
test('audio rejection unlocks playback for retry', async () => {
  const f = fixture(() => Promise.reject(new Error('audio unavailable')))
  assert.equal(await f.controller.play(), false)
  assert.equal(f.errors(), 1)
  assert.equal(f.states.at(-1), false)
  assert.equal(await f.controller.play(), false)
  assert.equal(f.plays(), 2)
})
test('pending audio keeps lock; disposal cancels the pending start', async () => {
  let resolve
  const f = fixture(() => new Promise((done) => { resolve = done }))
  const started = f.controller.play()
  assert.equal(await f.controller.play(), false)
  f.controller.stop()
  resolve()
  assert.equal(await started, false)
  assert.equal(f.states.at(-1), false)
  assert.equal(f.frames.at(-1), 0)
})
