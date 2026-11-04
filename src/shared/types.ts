export interface Word {
  text: string
  start: number
  end: number
  prob?: number
}

/** One subtitle. `words` are the recognised speech anchors and survive any change to `text`. */
export interface Clip {
  id: string
  start: number
  end: number
  text: string
  words: Word[]
}

export interface Cue {
  start: number
  end: number
  text: string
}

export interface SegmentOptions {
  maxChars: number
  maxDuration: number
  splitOnSentence: boolean
  maxGap: number
}

export interface SubtitleStyle {
  font: string
  sizePct: number
  marginPct: number
  box: boolean
}

export interface SttOptions {
  model: string
  language: string
  device: 'auto' | 'cuda' | 'cpu'
}

export interface Settings {
  stt: SttOptions
  segment: SegmentOptions
  style: SubtitleStyle
  dictionary: string
}

export interface MediaInfo {
  path: string
  url: string
  size: number
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

export interface ProjectFile {
  version: 1
  mediaSize: number
  clips: Clip[]
}

export type SttEvent =
  | { type: 'status'; message: string; device: string | null }
  | { type: 'progress'; seconds: number; duration: number }
  | { type: 'segment'; words: Word[] }
  | { type: 'reset' }
  | { type: 'done'; language: string; device: string }
  | { type: 'error'; message: string }

export interface ExportRequest {
  mediaPath: string
  outputPath: string
  ass: string
  duration: number
}

export interface SrtFile {
  path: string
  content: string
}

export interface Api {
  pickMedia(): Promise<string | null>
  openMedia(path: string): Promise<MediaInfo>
  loadPeaks(path: string): Promise<Uint8Array | null>
  pickSrt(): Promise<SrtFile | null>
  saveSrt(content: string, path: string | null, defaultPath: string): Promise<string | null>
  pickExportPath(defaultPath: string): Promise<string | null>
  confirm(message: string, detail?: string): Promise<boolean>
  loadProject(mediaPath: string): Promise<ProjectFile | null>
  saveProject(mediaPath: string, project: ProjectFile): Promise<void>
  loadSettings(): Promise<Partial<Settings>>
  saveSettings(settings: Settings): Promise<void>
  startStt(mediaPath: string, options: SttOptions, hotwords: string): Promise<void>
  cancelStt(): Promise<void>
  onSttEvent(listener: (event: SttEvent) => void): () => void
  startExport(request: ExportRequest): Promise<void>
  cancelExport(): Promise<void>
  onProgress(listener: (fraction: number) => void): () => void
}
