import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, SttEvent } from '../shared/types'

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: Api = {
  pickMedia: () => ipcRenderer.invoke('pick-media'),
  openMedia: (path) => ipcRenderer.invoke('open-media', path),
  loadPeaks: (path) => ipcRenderer.invoke('load-peaks', path),
  pickSrt: () => ipcRenderer.invoke('pick-srt'),
  saveSrt: (content, path, defaultPath) => ipcRenderer.invoke('save-srt', content, path, defaultPath),
  pickExportPath: (defaultPath) => ipcRenderer.invoke('pick-export-path', defaultPath),
  confirm: (message, detail) => ipcRenderer.invoke('confirm', message, detail),
  loadProject: (mediaPath) => ipcRenderer.invoke('load-project', mediaPath),
  pickProject: () => ipcRenderer.invoke('pick-project'),
  saveProject: (project, path, defaultPath) => ipcRenderer.invoke('save-project', project, path, defaultPath),
  autosaveProject: (mediaPath, project) => ipcRenderer.invoke('autosave-project', mediaPath, project),
  onCloseRequested: (listener) => subscribe('close-requested', listener),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  startStt: (mediaPath, options, hotwords) => ipcRenderer.invoke('start-stt', mediaPath, options, hotwords),
  cancelStt: () => ipcRenderer.invoke('cancel-stt'),
  onSttEvent: (listener) => subscribe<SttEvent>('stt-event', listener),
  startExport: (request) => ipcRenderer.invoke('start-export', request),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  onProgress: (listener) => subscribe<number>('progress', listener)
}

contextBridge.exposeInMainWorld('api', api)
