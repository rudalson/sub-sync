import { create } from 'zustand'
import { buildAss } from '../../shared/ass'
import {
  applyDictionary,
  mergeWithNext,
  moveEdge,
  parseDictionary,
  removeClip,
  setClipText,
  splitClip,
  type Edge
} from '../../shared/edits'
import { overlayCues } from '../../shared/overlay'
import { joinWords, segmentWords } from '../../shared/segment'
import { parseSrt, serializeSrt } from '../../shared/srt'
import type { Clip, MediaInfo, Settings, Word } from '../../shared/types'

const api = window.api
const HISTORY_LIMIT = 100

export const DEFAULT_SETTINGS: Settings = {
  stt: { model: 'large-v3-turbo', language: 'en', device: 'auto' },
  segment: { maxChars: 84, maxDuration: 8, splitOnSentence: true, maxGap: 0.8 },
  style: { font: 'Malgun Gothic', sizePct: 5, marginPct: 6, box: true },
  dictionary: ''
}

export type DialogName = 'stt' | 'recut' | 'export' | 'dictionary'

interface Job {
  label: string
  progress: number | null
  cancel?: () => void
}

interface DragHint {
  x: number
  y: number
  label: string
}

interface State {
  media: MediaInfo | null
  peaks: Uint8Array | null
  clips: Clip[]
  past: Clip[][]
  future: Clip[][]
  srtPath: string | null
  settings: Settings
  dialog: DialogName | null
  job: Job | null
  message: string | null
  dragHint: DragHint | null
  follow: boolean

  init(): Promise<void>
  setDialog(dialog: DialogName | null): void
  setMessage(message: string | null): void
  setDragHint(hint: DragHint | null): void
  setFollow(follow: boolean): void
  updateSettings(change: Partial<Settings>): void

  openMedia(): Promise<void>
  loadSrt(): Promise<void>
  saveSrt(saveAs?: boolean): Promise<void>
  transcribe(): Promise<void>
  recut(): Promise<void>
  applyDictionaryNow(): void
  exportVideo(): Promise<void>

  beginEdit(): void
  undo(): void
  redo(): void
  editText(index: number, text: string): void
  dragEdge(index: number, edge: Edge, time: number): void
  split(index: number, word: number): void
  merge(index: number): void
  remove(index: number): void
}

function fontLineRatio(font: string): number {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return 1
  context.font = `bold 100px "${font}"`
  const metrics = context.measureText('가')
  return (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / 100 || 1
}

const allWords = (clips: Clip[]): Word[] => clips.flatMap((clip) => clip.words)
const stripExtension = (path: string) => path.replace(/\.[^./\\]+$/, '')
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const useStore = create<State>((set, get) => {
  /** Applies an edit as one undo step. */
  const commit = (clips: Clip[]) =>
    set((state) => ({ clips, past: [...state.past, state.clips].slice(-HISTORY_LIMIT), future: [] }))

  async function runTranscription() {
    const { media, settings, clips } = get()
    if (!media) return
    const dictionary = parseDictionary(settings.dictionary)
    const words: Word[] = []

    await new Promise<void>((resolve) => {
      const finish = (message: string | null = null) => {
        unsubscribe()
        set({ job: null, message })
        resolve()
      }
      const cancel = () => {
        void api.cancelStt()
        finish()
      }
      const setJob = (label: string, progress: number | null) => set({ job: { label, progress, cancel } })

      const unsubscribe = api.onSttEvent((event) => {
        switch (event.type) {
          case 'status':
            setJob(event.message, get().job?.progress ?? null)
            break
          case 'progress':
            setJob(get().job?.label ?? '음성 인식 중', event.duration ? event.seconds / event.duration : null)
            break
          case 'segment':
            words.push(...event.words)
            break
          case 'reset':
            words.length = 0
            break
          case 'error':
            finish(`음성 인식 실패: ${event.message}`)
            break
          case 'done': {
            const hasOnlySubtitles = clips.length > 0 && allWords(clips).length === 0
            const next = hasOnlySubtitles ? overlayCues(words, clips) : segmentWords(words, get().settings.segment)
            commit(applyDictionary(next, dictionary))
            finish(`자막 ${next.length}개 생성 완료 (${event.device === 'cuda' ? 'GPU' : 'CPU'})`)
            break
          }
        }
      })
      setJob('음성 인식 준비 중', null)
      void api.startStt(media.path, settings.stt, dictionary.hotwords)
    })
  }

  return {
    media: null,
    peaks: null,
    clips: [],
    past: [],
    future: [],
    srtPath: null,
    settings: DEFAULT_SETTINGS,
    dialog: null,
    job: null,
    message: null,
    dragHint: null,
    follow: true,

    async init() {
      const saved = await api.loadSettings()
      set({ settings: { ...DEFAULT_SETTINGS, ...saved } })
      api.onProgress((progress) => {
        const job = get().job
        if (job) set({ job: { ...job, progress } })
      })
    },

    setDialog: (dialog) => set({ dialog }),
    setMessage: (message) => set({ message }),
    setDragHint: (dragHint) => set({ dragHint }),
    setFollow: (follow) => set({ follow }),

    updateSettings(change) {
      const settings = { ...get().settings, ...change }
      set({ settings })
      void api.saveSettings(settings)
    },

    async openMedia() {
      const path = await api.pickMedia()
      if (!path) return
      set({ job: { label: '영상 준비 중', progress: null } })
      try {
        const media = await api.openMedia(path)
        const project = await api.loadProject(path)
        set({ media, peaks: null, clips: project?.clips ?? [], past: [], future: [], srtPath: null, message: null, job: null })
        const peaks = await api.loadPeaks(path)
        if (get().media?.path === path) set({ peaks })
      } catch (error) {
        set({ message: `영상을 열 수 없습니다: ${errorText(error)}`, job: null })
      }
    },

    async loadSrt() {
      const file = await api.pickSrt()
      if (!file) return
      const cues = parseSrt(file.content)
      if (cues.length === 0) {
        set({ message: 'SRT에서 자막을 찾지 못했습니다.' })
        return
      }
      commit(overlayCues(allWords(get().clips), cues))
      set({ srtPath: file.path, message: `자막 ${cues.length}개를 불러왔습니다.` })
    },

    async saveSrt(saveAs = false) {
      const { clips, srtPath, media } = get()
      if (clips.length === 0) return
      const fallback = media ? `${stripExtension(media.path)}.srt` : 'subtitles.srt'
      const path = await api.saveSrt(serializeSrt(clips), saveAs ? null : srtPath, srtPath ?? fallback)
      if (path) set({ srtPath: path, message: `저장했습니다: ${path}` })
    },

    async transcribe() {
      const { clips } = get()
      set({ dialog: null })
      if (allWords(clips).length > 0) {
        const proceed = await api.confirm('음성 인식을 다시 실행할까요?', '현재 자막은 새 인식 결과로 바뀝니다. 실행 취소로 되돌릴 수 있습니다.')
        if (!proceed) return
      }
      await runTranscription()
    },

    async recut() {
      const { clips, settings } = get()
      set({ dialog: null })
      const words = allWords(clips)
      if (words.length === 0) {
        set({ message: '단어 정보가 없어 자막을 다시 자를 수 없습니다. 음성 인식을 먼저 실행해 주세요.' })
        return
      }
      const edited = clips.some((clip) => clip.text !== joinWords(clip.words))
      if (edited) {
        const proceed = await api.confirm('수정한 자막 내용이 사라집니다.', '다시 자르면 인식된 영어 원문으로 되돌아갑니다. 실행 취소로 되돌릴 수 있습니다.')
        if (!proceed) return
      }
      commit(segmentWords(words, settings.segment))
    },

    applyDictionaryNow() {
      const { clips, settings } = get()
      commit(applyDictionary(clips, parseDictionary(settings.dictionary)))
      set({ dialog: null })
    },

    async exportVideo() {
      const { media, clips, settings } = get()
      if (!media) return
      set({ dialog: null })
      const outputPath = await api.pickExportPath(`${stripExtension(media.path)}.subtitled.mp4`)
      if (!outputPath) return
      set({ job: { label: '영상 내보내는 중', progress: 0, cancel: () => void api.cancelExport() } })
      try {
        const ass = buildAss(clips, settings.style, media.width, media.height, fontLineRatio(settings.style.font))
        await api.startExport({ mediaPath: media.path, outputPath, ass, duration: media.duration })
        set({ message: `내보냈습니다: ${outputPath}` })
      } catch (error) {
        set({ message: errorText(error) })
      } finally {
        set({ job: null })
      }
    },

    beginEdit: () => set((state) => ({ past: [...state.past, state.clips].slice(-HISTORY_LIMIT), future: [] })),

    undo() {
      const { past, clips, future } = get()
      const previous = past.at(-1)
      if (previous) set({ clips: previous, past: past.slice(0, -1), future: [clips, ...future] })
    },

    redo() {
      const { past, clips, future } = get()
      const [next, ...rest] = future
      if (next) set({ clips: next, past: [...past, clips], future: rest })
    },

    editText: (index, text) => set((state) => ({ clips: setClipText(state.clips, index, text) })),
    dragEdge: (index, edge, time) => set((state) => ({ clips: moveEdge(state.clips, index, edge, time) })),
    split: (index, word) => commit(splitClip(get().clips, index, word)),
    merge: (index) => commit(mergeWithNext(get().clips, index)),
    remove: (index) => commit(removeClip(get().clips, index))
  }
})

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Word anchors exist only here, not in SRT, so every change is written next to the video. */
useStore.subscribe((state, previous) => {
  if (state.clips === previous.clips || !state.media) return
  const { media } = state
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void api.saveProject(media.path, { version: 1, mediaSize: media.size, clips: useStore.getState().clips })
  }, 800)
})
