export const FRAME_COUNT = 241
export const DURATION_MS = FRAME_COUNT / 24 * 1000
export function frameAt(elapsed: number) {
  return Math.min(FRAME_COUNT - 1, Math.max(0, Math.floor(elapsed / DURATION_MS * FRAME_COUNT)))
}

interface PlaybackOptions {
  audio: { play(): Promise<void>; pause(): void; currentTime: number }
  now: () => number
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  cancel: (id: ReturnType<typeof setTimeout>) => void
  onFrame: (frame: number) => void
  onState: (busy: boolean) => void
  onError: () => void
}

export function createPlayback(options: PlaybackOptions) {
  let busy = false
  let started: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  function stop() {
    generation++
    if (timer !== undefined) options.cancel(timer)
    timer = undefined
    options.audio.pause()
    options.audio.currentTime = 0
    started = undefined
    busy = false
    options.onFrame(0)
    options.onState(false)
  }
  async function play() {
    if (busy) return false
    busy = true // Acquire synchronously, including while audio.play() is pending.
    const current = ++generation
    options.onState(true)
    options.onFrame(0)
    options.audio.currentTime = 0
    try {
      await options.audio.play()
      if (current !== generation) return false
      started = options.now()
      timer = options.schedule(stop, DURATION_MS)
      return true
    } catch {
      if (current === generation) {
        stop()
        options.onError()
      }
      return false
    }
  }
  function tick() {
    if (started === undefined) return
    const elapsed = options.now() - started
    if (elapsed >= DURATION_MS) stop()
    else options.onFrame(frameAt(elapsed))
  }
  return { play, stop, tick }
}
