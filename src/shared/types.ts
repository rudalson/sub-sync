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
  /** CSS weight (100-900); the nearest installed face of `font` is used. */
  weight: number
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

export interface LegacyProjectFile {
  version: 1
  mediaSize: number
  clips: Clip[]
}

export const PEAKS_PER_SECOND = 100

/** A project references the original video; generated playback URLs are never persisted. */
export interface ProjectFile {
  format: 'sub-sync'
  version: 2
  media: Omit<MediaInfo, 'url'> & { relativePath?: string }
  clips: Clip[]
  waveform: { samplesPerSecond: typeof PEAKS_PER_SECOND; peaks: number[] } | null
  settings: Settings
  playback: { time: number; rate: number; follow: boolean }
  srtPath: string | null
}

export type SavedProject = ProjectFile | LegacyProjectFile

export interface OpenedProject {
  path: string
  project: SavedProject
  media: MediaInfo
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
  /** The family whose files libass receives, so the export finds fonts installed per user too. */
  fontFamily?: string
}

/** One installed face, found by the WebView through `local()` and by libass through its full name. */
export interface FontFace {
  weight: number
  postscript: string
  fullName: string
}

export interface FontFamily {
  family: string
  localName: string | null
  hangul: boolean
  weights: FontFace[]
}

export interface SrtFile {
  path: string
  content: string
}

export interface ProjectSubtitle {
  path: string
  language: string | null
}

export interface ImportProgress {
  label: string
  progress: number | null
}

/** One subtitle line for the translation agent: its position (1-based) and its text. */
export interface TranslateCue {
  id: number
  text: string
}

export interface TranslateRequest {
  /** English source, in subtitle order. */
  cues: TranslateCue[]
  /** Korean kept from an interrupted run; these cues are not sent again. */
  done: TranslateCue[]
  /** Terms the translation keeps exactly as written. */
  glossary: string[]
}

export interface TranslateProgress {
  label: string
  progress: number | null
  /** Cues finished by this step. */
  translations: TranslateCue[]
}

/** One over-long sentence for the agent: its words and the 1-based numbers of words followed by a pause. */
export interface SentenceSplitSpan {
  id: number
  words: string[]
  pauses: number[]
}

export interface SentenceSplitRequest {
  spans: SentenceSplitSpan[]
  /** A sentence longer than this is split again at a clause boundary. */
  maxWords: number
}

/** The last word number of each piece, ending with the span's word count. */
export interface SentenceSplitResult {
  id: number
  ends: number[]
}

/** The recognised English sent for clean-up: only word texts, never their timing. */
export interface RefineRequest {
  /** The open video; title, description and chapters saved beside it go along as hints. */
  mediaPath: string
  words: string[]
  /** 0-based indices of words the recogniser was unsure about. */
  uncertain: number[]
  glossary: string[]
}

/** Replace words `start` to `end` (0-based, exclusive) with `text`. */
export interface RefineEdit {
  start: number
  end: number
  text: string
}

export interface RefineResult {
  edits: RefineEdit[]
  /** Terms the agent found the video uses, as spelled there. */
  terms: string[]
  /** Edits dropped because they did not match the words or broke the rules. */
  rejected: number
  /** Stretches left as recognised because no usable answer came back. */
  failed: number
}

export interface RefineProgress {
  label: string
  progress: number | null
}

export interface Api {
  pickMedia(): Promise<string | null>
  pickImportDirectory(initial: string | null): Promise<string | null>
  importVideo(url: string, targetDir: string): Promise<string>
  cancelImportVideo(): Promise<void>
  onImportProgress(listener: (event: ImportProgress) => void): () => void
  openMedia(path: string): Promise<MediaInfo>
  loadPeaks(path: string): Promise<Uint8Array | null>
  pickSrt(): Promise<SrtFile | null>
  listProjectSubtitles(projectPath: string): Promise<ProjectSubtitle[]>
  readProjectSrt(projectPath: string, path: string): Promise<SrtFile>
  saveSrt(content: string, path: string | null, defaultPath: string): Promise<string | null>
  pickExportPath(defaultPath: string): Promise<string | null>
  confirm(message: string, detail?: string): Promise<boolean>
  loadProject(mediaPath: string): Promise<SavedProject | null>
  pickProject(): Promise<OpenedProject | null>
  /** The `.subsync` file the app was launched with (double-clicked in Explorer), handed over only once. */
  openLaunchProject(): Promise<OpenedProject | null>
  saveProject(project: ProjectFile, path: string | null, defaultPath: string): Promise<string | null>
  autosaveProject(mediaPath: string, project: ProjectFile): Promise<void>
  onCloseRequested(listener: () => void): () => void
  closeWindow(): Promise<void>
  loadSettings(): Promise<Partial<Settings>>
  saveSettings(settings: Settings): Promise<void>
  startStt(mediaPath: string, options: SttOptions, hotwords: string): Promise<void>
  cancelStt(): Promise<void>
  onSttEvent(listener: (event: SttEvent) => void): () => void
  startExport(request: ExportRequest): Promise<void>
  cancelExport(): Promise<void>
  startAgentTranslate(request: TranslateRequest): Promise<TranslateCue[]>
  cancelAgentTranslate(): Promise<void>
  onTranslateProgress(listener: (event: TranslateProgress) => void): () => void
  onProgress(listener: (fraction: number) => void): () => void
  sentenceBoundaries(words: string[]): Promise<number[]>
  agentSplitSentences(request: SentenceSplitRequest): Promise<SentenceSplitResult[]>
  cancelAgentSplit(): Promise<void>
  startAgentRefine(request: RefineRequest): Promise<RefineResult>
  cancelAgentRefine(): Promise<void>
  onRefineProgress(listener: (event: RefineProgress) => void): () => void
  listFonts(): Promise<FontFamily[]>
}
