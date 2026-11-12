import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { validateProject } from '../../shared/project'
import type { Api, ImportProgress, MediaInfo, OpenedProject, SavedProject, SttEvent, TranslateProgress } from '../../shared/types'

const sttListeners = new Set<(event: SttEvent) => void>()
const progressListeners = new Set<(fraction: number) => void>()
const importListeners = new Set<(event: ImportProgress) => void>()
const translateListeners = new Set<(event: TranslateProgress) => void>()
const closeListeners = new Set<() => void>()
const subscribe = <T>(listeners: Set<T>, listener: T) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const playable = (media: MediaInfo): MediaInfo => ({ ...media, url: convertFileSrc(media.url, 'media') })
const opened = (project: OpenedProject | null): OpenedProject | null =>
  project ? { ...project, project: validateProject(project.project), media: playable(project.media) } : null

export const api: Api = {
  pickMedia: () => invoke('pick_media'),
  pickImportDirectory: (initial) => invoke('pick_import_directory', { initial }),
  importVideo: (url, targetDir) => invoke('import_video', { url, targetDir }),
  cancelImportVideo: () => invoke('cancel_import_video'),
  onImportProgress: (listener) => subscribe(importListeners, listener),
  openMedia: async (path) => playable(await invoke<MediaInfo>('open_media', { path })),
  loadPeaks: async (path) => {
    // Rust sends binary IPC, avoiding a large JSON array for long recordings.
    const bytes = await invoke<ArrayBuffer | number[]>('load_peaks', { path })
    const peaks = Array.isArray(bytes) ? Uint8Array.from(bytes) : new Uint8Array(bytes)
    return peaks.length ? peaks : null
  },
  pickSrt: () => invoke('pick_srt'),
  listProjectSubtitles: (projectPath) => invoke('list_project_subtitles', { projectPath }),
  readProjectSrt: (projectPath, path) => invoke('read_project_srt', { projectPath, path }),
  saveSrt: (content, path, defaultPath) => invoke('save_srt', { content, path, defaultPath }),
  pickExportPath: (defaultPath) => invoke('pick_export_path', { defaultPath }),
  confirm: (message, detail) => invoke('confirm', { message, detail: detail ?? null }),
  loadProject: async (mediaPath) => {
    const project = await invoke<SavedProject | null>('load_project', { mediaPath })
    return project ? validateProject(project) : null
  },
  pickProject: async () => opened(await invoke<OpenedProject | null>('pick_project')),
  openLaunchProject: async () => opened(await invoke<OpenedProject | null>('open_launch_project')),
  saveProject: (project, path, defaultPath) => invoke('save_project', { project, path, defaultPath }),
  autosaveProject: (mediaPath, project) => invoke('autosave_project', { mediaPath, project }),
  loadSettings: () => invoke('load_settings'),
  saveSettings: (settings) => invoke('save_settings', { settings }),
  startStt: (mediaPath, options, hotwords) => invoke('start_stt', { mediaPath, options, hotwords }),
  cancelStt: () => invoke('cancel_stt'),
  onSttEvent: (listener) => subscribe(sttListeners, listener),
  startExport: (request) => invoke('start_export', { request }),
  cancelExport: () => invoke('cancel_export'),
  startAgentTranslate: (request) => invoke('start_agent_translate', { request }),
  cancelAgentTranslate: () => invoke('cancel_agent_translate'),
  onTranslateProgress: (listener) => subscribe(translateListeners, listener),
  onProgress: (listener) => subscribe(progressListeners, listener),
  sentenceBoundaries: (words) => invoke('sentence_boundaries', { words }),
  listFonts: () => invoke('list_fonts'),
  onCloseRequested: (listener) => subscribe(closeListeners, listener),
  closeWindow: () => invoke('close_window')
}

/** Install native listeners before mounting the editor so immediate job errors cannot be missed. */
export async function initializeNativeApi(): Promise<void> {
  await Promise.all([
    listen<SttEvent>('stt-event', ({ payload }) => sttListeners.forEach((listener) => listener(payload))),
    listen<number>('progress', ({ payload }) => progressListeners.forEach((listener) => listener(payload))),
    listen<ImportProgress>('import-progress', ({ payload }) => importListeners.forEach((listener) => listener(payload))),
    listen<TranslateProgress>('translate-progress', ({ payload }) => translateListeners.forEach((listener) => listener(payload))),
    getCurrentWindow().onCloseRequested((event) => {
      if (closeListeners.size === 0) return
      event.preventDefault()
      closeListeners.forEach((listener) => listener())
    })
  ])
  window.api = api
}
