const { contextBridge, ipcRenderer } = require('electron')
function subscribe(channel, listener) {
  const handler = (_event, value) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
contextBridge.exposeInMainWorld('desktopPet', {
  getSettings: () => ipcRenderer.invoke('pet:get-settings'),
  onSettingsChanged: (listener) => subscribe('pet:settings-changed', listener),
  split: () => ipcRenderer.send('pet:split'),
  onMotionChanged: (listener) => subscribe('pet:motion', listener),
  onPlayRequested: (listener) => subscribe('pet:play', listener),
  setPlaybackState: (state) => ipcRenderer.send('pet:playback-state', state),
  openMenu: () => ipcRenderer.send('pet:open-menu'),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  moveDrag: () => ipcRenderer.send('pet:drag-move'),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
})
