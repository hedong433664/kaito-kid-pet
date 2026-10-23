<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PetSprite from './components/PetSprite.vue'
import type { PetSettings } from './env'

const desktopPet = window.desktopPet
const volume = ref(70)
const cloneMode = ref(false)
const squash = ref(1)
let currentSize = 100
const petButton = ref<HTMLButtonElement>()
const ready = ref(false)
const playing = ref(false)
const error = ref('')
const sprite = ref<InstanceType<typeof PetSprite>>()
let origin: { x: number; y: number; pointer: number } | undefined
let moved = false
let doubleClickDragged = false
function play() {
  if (!ready.value || playing.value) return
  error.value = ''
  sprite.value?.play()
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || origin) return
  origin = { x: event.screenX, y: event.screenY, pointer: event.pointerId }
  moved = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  desktopPet?.startDrag()
  sprite.value?.pressAt(event.clientX, event.clientY)
}
function moveDrag(event: PointerEvent) {
  if (!origin || event.pointerId !== origin.pointer) return
  if (Math.hypot(event.screenX - origin.x, event.screenY - origin.y) > 4) moved = true
  if (moved) desktopPet?.moveDrag()
}
function endDrag(event: PointerEvent) {
  if (!origin || event.pointerId !== origin.pointer) return
  origin = undefined
  sprite.value?.releasePress()
  desktopPet?.endDrag()
}
function handleClick(event: MouseEvent) {
  // Native dblclick arrives after both clicks; either gesture being a drag cancels it.
  if (event.detail === 1) doubleClickDragged = moved
  else doubleClickDragged ||= moved
}
function doubleClick() {
  if (doubleClickDragged || moved || !ready.value) return
  // Splitting is independent of the audio lock: a busy pet never restarts its transformation.
  if (cloneMode.value) desktopPet?.split()
  play()
}
function openMenu() {
  cancelDrag()
  desktopPet?.openMenu()
}
function cancelDrag() {
  const pointer = origin?.pointer
  origin = undefined
  moved = false
  sprite.value?.releasePress()
  if (pointer !== undefined) {
    if (petButton.value?.hasPointerCapture(pointer)) petButton.value.releasePointerCapture(pointer)
    desktopPet?.endDrag()
  }
}
function handleVisibility() {
  if (document.hidden) cancelDrag()
}
function applySettings(next: PetSettings) {
  if (next.size !== currentSize) cancelDrag()
  currentSize = next.size
  volume.value = next.volume
  cloneMode.value = next.cloneMode
}
watch([ready, playing, error], () => {
  desktopPet?.setPlaybackState({ ready: ready.value, busy: playing.value, error: error.value })
}, { immediate: true })
const unsubscribe: Array<() => void> = []
let disposed = false
onMounted(async () => {
  window.addEventListener('blur', cancelDrag)
  document.addEventListener('visibilitychange', handleVisibility)
  if (desktopPet) {
    unsubscribe.push(desktopPet.onSettingsChanged(applySettings), desktopPet.onPlayRequested(play),
      desktopPet.onMotionChanged((motion) => { squash.value = motion.squash }))
    const settings = await desktopPet.getSettings()
    if (!disposed) applySettings(settings)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('blur', cancelDrag)
  document.removeEventListener('visibilitychange', handleVisibility)
  disposed = true
  unsubscribe.forEach((remove) => remove())
  cancelDrag()
})
</script>

<template>
  <main class="pet-home" title="双击原声变身" @contextmenu.prevent="openMenu">
    <button ref="petButton" class="pet" :aria-busy="playing" :data-ready="ready"
      aria-label="双击原声变身" title="双击原声变身"
      @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag"
      @pointercancel="endDrag" @lostpointercapture="endDrag"
      @keydown.enter.prevent="play" @keydown.space.prevent="play"
      @click="handleClick" @dblclick="doubleClick">
      <span class="pet-motion" :style="{ transform: `scaleY(${squash})` }">
      <PetSprite ref="sprite" :volume="volume / 100" @ready="ready = $event" @busy="playing = $event" @error="error = $event" />
      </span>
    </button>
  </main>
</template>
