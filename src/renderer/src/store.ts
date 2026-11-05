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
import { DEFAULT_SETTINGS } from '../../shared/project'
import { joinWords, segmentWords } from '../../shared/segment'
import { reconstructSentencesWithPreservation, type SentenceBoundaryOptions } from '../../shared/sentenceBoundary'
import { parseSrt, serializeSrt } from '../../shared/srt'
import { PEAKS_PER_SECOND, type Clip, type MediaInfo, type ProjectFile, type SavedProject, type Settings, type Word } from '../../shared/types'
import { restorePlayback, usePlayback } from './player'

const api = window.api
const HISTORY_LIMIT = 100

let restoringProject = false

export type DialogName = 'stt' | 'recut' | 'export' | 'dictionary' | 'sentenceBoundary'

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
  projectPath: string | null
  projectDirty: boolean
  mediaSession: number
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
  openProject(): Promise<void>
  saveProject(saveAs?: boolean): Promise<void>
  closeWindow(): Promise<void>
  loadSrt(): Promise<void>
  saveSrt(saveAs?: boolean): Promise<void>
  transcribe(): Promise<void>
  recut(): Promise<void>
  applySentenceBoundary(sourceClips: Clip[], sentenceEnds: number[], options?: SentenceBoundaryOptions): boolean
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

  async function applyProject(media: MediaInfo, project: SavedProject | null, projectPath: string | null) {
    const full = project?.version === 2 ? project : null
    if (full && (Math.abs(full.media.duration - media.duration) > 0.1 || full.media.width !== media.width || full.media.height !== media.height)) {
      throw new Error('저장된 프로젝트와 영상 정보가 다릅니다. 원본 영상을 확인해 주세요.')
    }
    const peaks = full?.waveform ? Uint8Array.from(full.waveform.peaks) : media.hasAudio ? await api.loadPeaks(media.path) : null
    const playback = full?.playback ?? { time: 0, rate: 1, follow: true }
    restoringProject = true
    try {
      restorePlayback(playback, media.duration)
      set({
        media,
        peaks,
        clips: project?.clips ?? [],
        past: [],
        future: [],
        srtPath: full?.srtPath ?? null,
        projectPath,
        projectDirty: !projectPath || !full || full.media.path !== media.path || (!full.waveform && peaks !== null),
        mediaSession: get().mediaSession + 1,
        settings: full?.settings ?? get().settings,
        follow: playback.follow,
        dialog: null,
        dragHint: null,
        message: project ? '프로젝트를 복원했습니다. 음성 인식 없이 편집을 이어갈 수 있습니다.' : null
      })
    } finally {
      restoringProject = false
    }
  }

  async function runTranscription() {
    const { media, settings, clips } = get()
    if (!media) return
    const dictionary = parseDictionary(settings.dictionary)
    const words: Word[] = []

    await new Promise<void>((resolve) => {
      let finished = false
      const finish = (message: string | null = null) => {
        if (finished) return
        finished = true
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
      void api.startStt(media.path, settings.stt, dictionary.hotwords).catch((error) => finish(`음성 인식 실패: ${errorText(error)}`))
    })
  }

  return {
    media: null,
    peaks: null,
    clips: [],
    past: [],
    future: [],
    srtPath: null,
    projectPath: null,
    projectDirty: false,
    mediaSession: 0,
    settings: DEFAULT_SETTINGS,
    dialog: null,
    job: null,
    message: null,
    dragHint: null,
    follow: true,

    async init() {
      const saved = await api.loadSettings()
      if (get().mediaSession === 0) set({ settings: {
        ...DEFAULT_SETTINGS, ...saved,
        stt: { ...DEFAULT_SETTINGS.stt, ...saved.stt },
        segment: { ...DEFAULT_SETTINGS.segment, ...saved.segment },
        style: { ...DEFAULT_SETTINGS.style, ...saved.style }
      } })
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
      if (get().job) return
      set({ job: { label: '영상 준비 중', progress: null } })
      try {
        const path = await api.pickMedia()
        if (!path) return
        await flushAutosave()
        const media = await api.openMedia(path)
        const project = await api.loadProject(path)
        await applyProject(media, project, null)
      } catch (error) {
        set({ message: `영상을 열 수 없습니다: ${errorText(error)}` })
      } finally {
        set({ job: null })
      }
    },

    async openProject() {
      if (get().job) return
      set({ job: { label: '프로젝트 불러오는 중', progress: null } })
      try {
        await flushAutosave()
        const opened = await api.pickProject()
        if (opened) await applyProject(opened.media, opened.project, opened.path)
      } catch (error) {
        set({ message: `프로젝트를 열 수 없습니다: ${errorText(error)}` })
      } finally {
        set({ job: null })
      }
    },

    async saveProject(saveAs = false) {
      const state = get()
      if (!state.media || state.job) return
      set({ job: { label: '프로젝트 저장 중', progress: null } })
      try {
        // A protected video folder must not prevent saving a named project in another folder.
        await flushAutosave().catch(() => {})
        const project = projectSnapshot(get())!
        const path = await api.saveProject(project, saveAs ? null : state.projectPath, state.projectPath ?? `${stripExtension(state.media.path)}.subsync.json`)
        if (path && get().mediaSession === state.mediaSession) {
          const current = get()
          const playback = usePlayback.getState()
          const dirty = current.clips !== project.clips || current.settings !== project.settings ||
            current.peaks !== state.peaks || current.srtPath !== project.srtPath ||
            playback.time !== project.playback.time || playback.rate !== project.playback.rate ||
            current.follow !== project.playback.follow
          if (!dirty) {
            clearTimeout(saveTimer)
            pendingSave = null
            autosaveWrite = autosaveWrite.catch(() => {})
          }
          set({
            projectPath: path,
            projectDirty: dirty,
            message: `프로젝트를 저장했습니다: ${path}`
          })
        }
      } catch (error) {
        set({ message: `프로젝트 저장 실패: ${errorText(error)}` })
      } finally {
        set({ job: null })
      }
    },

    async closeWindow() {
      const previousJob = get().job
      set({ job: { label: '편집 내용 자동 저장 중', progress: null } })
      try {
        if (get().projectDirty) scheduleAutosave(get())
        await flushAutosave()
      } catch (error) {
        set({ message: `자동 저장 실패: ${errorText(error)}` })
        const proceed = await api.confirm('자동 저장에 실패했습니다. 그래도 종료할까요?', '편집 내용을 보존하려면 취소한 뒤 프로젝트를 다른 위치에 저장해 주세요.')
        if (!proceed) {
          set({ job: previousJob })
          return
        }
      }
      await api.closeWindow()
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

    applySentenceBoundary(sourceClips, sentenceEnds, options = {}) {
      if (get().clips !== sourceClips) {
        set({ message: '미리보기 후 자막이 변경되었습니다. 문장을 다시 분석해 주세요.' })
        return false
      }
      try {
        const result = reconstructSentencesWithPreservation(sourceClips, sentenceEnds, options)
        if (!result.integrity.valid) throw new Error(result.integrity.error)
        const clips = result.sentences.map(({ id, start, end, text, words }) => ({ id, start, end, text, words }))
        commit(clips)
        set({ dialog: null, message: `문장 단위로 자막 ${clips.length}개를 적용했습니다.` })
        return true
      } catch (error) {
        set({ message: '적용 실패: ' + errorText(error) })
        return false
      }
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

function projectSnapshot(state: State, playback = usePlayback.getState()): ProjectFile | null {
  if (!state.media) return null
  const { url: _url, ...media } = state.media
  return {
    format: 'sub-sync', version: 2, media,
    clips: state.clips,
    waveform: state.peaks === null ? null : { samplesPerSecond: PEAKS_PER_SECOND, peaks: Array.from(state.peaks) },
    settings: state.settings,
    playback: { time: playback.time, rate: playback.rate, follow: state.follow },
    srtPath: state.srtPath
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let pendingSave: { state: State; playback: ReturnType<typeof usePlayback.getState> } | null = null
let autosaveWrite: Promise<void> = Promise.resolve()

function scheduleAutosave(state: State) {
  if (!state.media) return
  pendingSave = { state, playback: usePlayback.getState() }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void flushAutosave().catch((error) => useStore.getState().setMessage(`자동 저장 실패: ${errorText(error)}. 프로젝트 저장으로 다른 위치에 저장해 주세요.`))
  }, 800)
}

/** Finish the captured session before opening another video; never read the next session's clips in a delayed callback. */
export async function flushAutosave(): Promise<void> {
  clearTimeout(saveTimer)
  const pending = pendingSave
  if (pending) {
    pendingSave = null
    const project = projectSnapshot(pending.state, pending.playback)!
    autosaveWrite = autosaveWrite.catch(() => {}).then(() => api.autosaveProject(project.media.path, project)).catch((error) => {
      if (!pendingSave) pendingSave = pending
      throw error
    })
  }
  await autosaveWrite
}

useStore.subscribe((state, previous) => {
  if (restoringProject || state.mediaSession !== previous.mediaSession || !state.media) return
  if (state.clips === previous.clips && state.settings === previous.settings && state.peaks === previous.peaks &&
    state.follow === previous.follow && state.srtPath === previous.srtPath) return
  if (!state.projectDirty) useStore.setState({ projectDirty: true })
  scheduleAutosave(state)
})

usePlayback.subscribe((playback, previous) => {
  const state = useStore.getState()
  if (restoringProject || !state.media) return
  if (playback.time !== previous.time || playback.rate !== previous.rate) {
    if (!state.projectDirty) useStore.setState({ projectDirty: true })
    // Paused seeks and playback pauses persist the position without rewriting a large waveform on every frame.
    if (!playback.playing || playback.rate !== previous.rate) scheduleAutosave(state)
  } else if (previous.playing && !playback.playing) scheduleAutosave(state)
})
