export interface PetSettings { volume: number; size: number; cloneMode: boolean }
export interface PetMotion { squash: number }
export interface PlaybackState { ready: boolean; busy: boolean; error: string }
export interface DesktopPetAPI {
  getSettings: () => Promise<PetSettings>
  onSettingsChanged: (listener: (settings: PetSettings) => void) => () => void
  onPlayRequested: (listener: () => void) => () => void
  setPlaybackState: (state: PlaybackState) => void
  split: () => void
  onMotionChanged: (listener: (motion: PetMotion) => void) => () => void
  openMenu: () => void
  startDrag: () => void
  moveDrag: () => void
  endDrag: () => void
}
declare global {
  interface Window { desktopPet?: DesktopPetAPI }
}
