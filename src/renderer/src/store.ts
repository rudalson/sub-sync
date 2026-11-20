import { create } from 'zustand'
import { buildAss } from '../../shared/ass'
import {
  applyDictionary,
  mergeWithNext,
  moveEdge,
  parseDictionary,
  removeClip,
  setClipDuration,
  setClipText,
  splitClip,
  type Edge
} from '../../shared/edits'
import {
  allWords,
  buildProject,
  clipsFromTranscript,
  defaultProjectPath,
  groupSentences,
  mergeSettings,
  overlaySrt,
  stripExtension
} from '../../shared/pipeline'
import { DEFAULT_SETTINGS } from '../../shared/project'
import { addDictionaryTerms, applyCorrections, describeCorrections, refineRequest, type Correction } from '../../shared/refine'
import { joinWords, segmentWords } from '../../shared/segment'
import {
  agentSplitRequest,
  longSentenceSpans,
  mergeSplitEnds,
  validateSentenceEnds,
  type SentenceBoundaryOptions
} from '../../shared/sentenceBoundary'
import { serializeSrt } from '../../shared/srt'
import { closeSubtitleGaps } from '../../shared/timing'
import { transcriptionRecord } from '../../shared/transcription'
import { applyTranslations, glossaryTerms, translationCues, translationTarget } from '../../shared/translate'
import { parseVideoUrl } from '../../shared/videoImport'
import { pickFace } from '../../shared/fonts'
import type { Clip, FontFace, MediaInfo, OpenedProject, ProjectFile, ProjectSubtitle, SavedProject, Settings, TranscriptionRecord, TranslateCue, VideoInfo, Word } from '../../shared/types'
import { captionFont, loadFonts } from './fonts'
import { restorePlayback, usePlayback } from './player'

const api = window.api
const HISTORY_LIMIT = 100

let restoringProject = false
let savingProject = false

/**
 * Korean finished by an interrupted agent translation, kept for the same English source so the
 * next run only sends what is left. Lives for the session; a changed source starts over.
 */
let translationDraft: { key: string; done: Map<number, string> } | null = null

function translationDraftFor(cues: TranslateCue[]) {
  const key = JSON.stringify(cues)
  if (translationDraft?.key !== key) translationDraft = { key, done: new Map() }
  return translationDraft
}

/** How many cues an earlier, interrupted run already translated for this source. */
export function resumableTranslations(cues: TranslateCue[]): number {
  return translationDraft?.key === JSON.stringify(cues) ? translationDraft.done.size : 0
}

export type DialogName = 'import' | 'oneShot' | 'stt' | 'settings' | 'export' | 'sentenceBoundary' | 'agentTranslate' | 'refine' | 'projectInfo'

/** How one step of work ended; `detail` is a short line for the one-shot checklist. */
export interface StepEnd {
  end: 'done' | 'failed' | 'cancelled' | 'skipped'
  detail?: string
}

export type PipelineStepKey = 'import' | 'transcribe' | 'refine' | 'group' | 'translate'
export type PipelineStepState = 'pending' | 'running' | StepEnd['end']

export interface PipelineStep {
  key: PipelineStepKey
  label: string
  state: PipelineStepState
  detail?: string
  startedAt?: number
  endedAt?: number
}

/** The 영상 한번에 run: each toolbar step in order, shown as a checklist while it runs. */
export interface Pipeline {
  steps: PipelineStep[]
  /** Set once the run stops, whether every step finished or not. */
  outcome: 'done' | 'failed' | 'cancelled' | null
}

export const PIPELINE_STEPS: { key: PipelineStepKey; label: string }[] = [
  { key: 'import', label: '영상 가져오기' },
  { key: 'transcribe', label: '자막 생성' },
  { key: 'refine', label: '영어 다듬기' },
  { key: 'group', label: '문장으로 묶기' },
  { key: 'translate', label: 'Agent 번역' }
]

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** Corrections the agent proposed for `source`, waiting for review. */
export interface Refinement {
  source: Clip[]
  corrections: Correction[]
  /** Terms the agent found the video uses. */
  terms: string[]
  /** Edits dropped as unusable, here or by the agent's checks, and stretches left unchecked. */
  dropped: number
  failed: number
}

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
  /** What the page of a video imported from a URL said about it; saved in the project. */
  videoInfo: VideoInfo | null
  /** What produced the recognised words; saved in the project. */
  transcription: TranscriptionRecord | null
  projectPath: string | null
  projectSubtitles: ProjectSubtitle[]
  projectDirty: boolean
  mediaSession: number
  settings: Settings
  dialog: DialogName | null
  importError: string | null
  job: Job | null
  message: string | null
  dragHint: DragHint | null
  follow: boolean
  refinement: Refinement | null
  pipeline: Pipeline | null

  init(): Promise<void>
  setDialog(dialog: DialogName | null): void
  setMessage(message: string | null): void
  setDragHint(hint: DragHint | null): void
  setFollow(follow: boolean): void
  updateSettings(change: Partial<Settings>): void

  openMedia(): Promise<void>
  importVideo(url: string, targetDir: string): Promise<boolean>
  openProject(): Promise<void>
  saveProject(saveAs?: boolean): Promise<void>
  closeWindow(): Promise<void>
  loadSrt(path?: string): Promise<void>
  saveSrt(saveAs?: boolean): Promise<void>
  transcribe(): Promise<void>
  recut(): Promise<void>
  applySentenceBoundary(sourceClips: Clip[], sentenceEnds: number[], options?: SentenceBoundaryOptions): boolean
  applyDictionaryNow(): void
  exportVideo(): Promise<void>
  startAgentTranslate(): Promise<StepEnd>
  /** Asks the agent to correct the recognised English; the result opens for review. */
  startRefine(): Promise<void>
  /** Applies the chosen corrections as one undo step and adds `terms` to the word dictionary. */
  applyRefinement(chosen: Correction[], terms: string[]): void
  dismissRefinement(): void
  /**
   * 영상 한번에: imports the URL, then makes, cleans up, groups and translates its subtitles without stopping.
   * The clean-up's corrections are all applied (each step stays one undo step); the agent splits sentences left too long.
   */
  runOneShot(url: string, targetDir: string): Promise<void>
  /** Closes the checklist of a finished one-shot run. */
  closePipeline(): void

  beginEdit(): void
  undo(): void
  redo(): void
  editText(index: number, text: string): void
  dragEdge(index: number, edge: Edge, time: number): void
  /** One undoable step per call; the next clip's start (or the video's end) is the limit. */
  setDuration(index: number, seconds: number): void
  split(index: number, word: number): void
  merge(index: number): void
  remove(index: number): void
}

async function fontLineRatio(style: Settings['style'], face: FontFace | null): Promise<number> {
  const { fontFamily, fontWeight } = captionFont(style, face)
  const font = `${fontWeight} 100px ${fontFamily}`
  // The preview may not have drawn a caption yet; measure the face itself, not a fallback.
  await document.fonts.load(font, '가A').catch(() => [])
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return 1
  context.font = font
  const metrics = context.measureText('가')
  return (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / 100 || 1
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const useStore = create<State>((set, get) => {
  /** Applies an edit as one undo step. */
  const commit = (clips: Clip[]) =>
    set((state) => ({ clips, past: [...state.past, state.clips].slice(-HISTORY_LIMIT), future: [] }))

  async function refreshProjectSubtitles() {
    const { media, projectPath, mediaSession } = get()
    if (!media) return
    const anchor = projectPath ?? media.path
    let projectSubtitles: ProjectSubtitle[] = []
    try {
      projectSubtitles = await api.listProjectSubtitles(anchor)
    } catch {
      // Companion discovery must not prevent editing when the folder is unavailable.
    }
    const current = get()
    if (current.mediaSession === mediaSession && (current.projectPath ?? current.media?.path) === anchor) {
      set({ projectSubtitles })
    }
  }

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
        videoInfo: full?.videoInfo ?? null,
        transcription: full?.transcription ?? null,
        projectPath,
        projectSubtitles: [],
        projectDirty: !projectPath || !full || full.media.path !== media.path || (!full.waveform && peaks !== null),
        mediaSession: get().mediaSession + 1,
        settings: full ? mergeSettings(full.settings) : get().settings,
        follow: playback.follow,
        dialog: null,
        dragHint: null,
        refinement: null,
        message: project ?'프로젝트를 복원했습니다. 음성 인식 없이 편집을 이어갈 수 있습니다.' : null
      })
    } finally {
      restoringProject = false
    }
    await refreshProjectSubtitles()
  }

  /** Opens a project from the picker or from the launch arguments; both may ask for a moved video first. */
  async function openProjectFrom(source: () => Promise<OpenedProject | null>) {
    if (get().job) return
    try {
      await flushAutosave()
      const opened = await source()
      if (!opened) return
      set({ job: { label: '프로젝트 불러오는 중', progress: null } })
      try {
        await applyProject(opened.media, opened.project, opened.path)
      } finally {
        set({ job: null })
      }
    } catch (error) {
      set({ message: `프로젝트를 열 수 없습니다: ${errorText(error)}` })
    }
  }

  /** Also tells the language Whisper heard, which decides whether the English steps can follow. */
  async function runTranscription(): Promise<StepEnd & { language?: string }> {
    const { media, settings, clips } = get()
    if (!media) return { end: 'failed', detail: '열린 영상이 없습니다.' }
    const { hotwords } = parseDictionary(settings.dictionary)
    const words: Word[] = []
    const startedAt = new Date()

    return new Promise((resolve) => {
      let finished = false
      const finish = (message: string | null, result: StepEnd & { language?: string }) => {
        if (finished) return
        finished = true
        unsubscribe()
        set({ job: null, message })
        resolve(result)
      }
      const fail = (message: string) => finish(`음성 인식 실패: ${message}`, { end: 'failed', detail: message })
      const cancel = () => {
        void api.cancelStt()
        finish(null, { end: 'cancelled' })
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
            fail(event.message)
            break
          case 'done': {
            const next = clipsFromTranscript(words, clips, get().settings)
            commit(next)
            set({ transcription: transcriptionRecord(event, settings.stt, startedAt, new Date()) })
            const done = `자막 ${next.length}개 생성 완료 (${event.device === 'cuda' ? 'GPU' : 'CPU'})`
            finish(done, { end: 'done', detail: done, language: event.language })
            break
          }
        }
      })
      setJob('음성 인식 준비 중', null)
      void api.startStt(media.path, settings.stt, hotwords).catch((error) => fail(errorText(error)))
    })
  }

  /** Checked before anything starts, so the form can say what is wrong. */
  function checkImport(url: string, targetDir: string): { url: string } | { error: string } {
    try {
      const normalized = parseVideoUrl(url)
      if (!targetDir.trim()) throw new Error('영상을 저장할 폴더를 선택해 주세요.')
      return { url: normalized }
    } catch (error) {
      return { error: errorText(error) }
    }
  }

  async function importFrom(url: string, targetDir: string): Promise<StepEnd> {
    if (get().job) return { end: 'failed', detail: '다른 작업이 진행 중입니다.' }
    const checked = checkImport(url, targetDir)
    if ('error' in checked) {
      set({ importError: checked.error })
      return { end: 'failed', detail: checked.error }
    }
    let cancelled = false
    let downloading = true
    let nativeStarted = false
    const requestCancel = () => {
      void api.cancelImportVideo().catch((error) => set({ importError: errorText(error) }))
    }
    const cancel = () => {
      cancelled = true
      set({ job: { label: '가져오기 취소 중', progress: null } })
      if (nativeStarted) requestCancel()
    }
    const unsubscribe = api.onImportProgress((event) => {
      nativeStarted = true
      if (cancelled && downloading) requestCancel()
      else if (downloading) set({ job: { ...event, cancel } })
    })
    set({ importError: null, job: { label: '영상 URL 확인 중', progress: null, cancel } })
    try {
      await flushAutosave()
      if (cancelled) return { end: 'cancelled' }
      const { path, info } = await api.importVideo(checked.url, targetDir)
      if (cancelled) return { end: 'cancelled' }
      downloading = false
      set({ job: { label: '가져온 영상 준비 중', progress: null } })
      const media = await api.openMedia(path)
      const project = await api.loadProject(path)
      await flushAutosave()
      await applyProject(media, project, null)
      // Saved with the project right away, so the clean-up still has it after a restart.
      if (info) set({ videoInfo: info })
      set({ message: `영상을 가져왔습니다: ${path}` })
      return { end: 'done', detail: baseName(path) }
    } catch (error) {
      if (cancelled) return { end: 'cancelled' }
      set({ importError: `영상 가져오기 실패: ${errorText(error)}` })
      return { end: 'failed', detail: errorText(error) }
    } finally {
      unsubscribe()
      set({ job: null })
    }
  }

  /** Runs the agent clean-up as a job and hands back what it proposes, without applying anything. */
  async function requestRefinement(): Promise<StepEnd & { refinement?: Refinement }> {
    const { media, clips, job, settings, mediaSession, videoInfo } = get()
    if (job || !media) return { end: 'failed', detail: '다른 작업이 진행 중입니다.' }
    const request = refineRequest(clips, media.path, settings.dictionary, videoInfo)
    if (request.words.length === 0) {
      const detail = '단어 정보가 없어 영어 대사를 다듬을 수 없습니다. 음성 인식을 먼저 실행해 주세요.'
      set({ message: detail })
      return { end: 'skipped', detail }
    }
    const unsubscribe = api.onRefineProgress((event) => {
      if (get().mediaSession !== mediaSession) return
      set((state) => (state.job ? { job: { ...state.job, label: event.label, progress: event.progress } } : {}))
    })
    let cancelled = false
    const cancel = () => {
      cancelled = true
      void api.cancelAgentRefine()
    }
    set({ dialog: null, refinement: null, job: { label: '영어 다듬기 준비 중', progress: null, cancel } })
    try {
      const result = await api.startAgentRefine(request)
      if (get().mediaSession !== mediaSession) return { end: 'cancelled' }
      const { corrections, skipped } = describeCorrections(clips, result.edits)
      return {
        end: 'done',
        refinement: { source: clips, corrections, terms: result.terms, dropped: result.rejected + skipped, failed: result.failed }
      }
    } catch (error) {
      if (get().mediaSession !== mediaSession) return { end: 'cancelled' }
      set({
        message: cancelled
          ? '영어 다듬기를 취소했습니다. 자막은 인식된 그대로입니다.'
          : `영어 다듬기 실패: ${errorText(error)} 자막은 인식된 그대로 두었습니다.`
      })
      return cancelled ? { end: 'cancelled' } : { end: 'failed', detail: errorText(error) }
    } finally {
      unsubscribe()
      if (get().mediaSession === mediaSession) set({ job: null })
    }
  }

  /** 문장으로 묶기 with its defaults; sentences pySBD leaves too long go to the agent before the result is applied. */
  async function groupIntoSentences(): Promise<StepEnd> {
    const { clips, mediaSession } = get()
    const words = allWords(clips)
    if (words.length === 0) return { end: 'skipped', detail: '단어 정보가 없습니다.' }
    let cancelled = false
    set({ job: { label: '문장 경계 분석 중', progress: null } })
    try {
      let ends = await api.sentenceBoundaries(words.map((word) => word.text))
      validateSentenceEnds(words.length, ends)
      const spans = longSentenceSpans(words, ends)
      let note = ''
      if (spans.length > 0) {
        const cancel = () => {
          cancelled = true
          void api.cancelAgentSplit()
        }
        set({ job: { label: `Agent가 긴 문장 ${spans.length}개를 나누는 중`, progress: null, cancel } })
        try {
          const results = await api.agentSplitSentences(agentSplitRequest(words, spans))
          ends = mergeSplitEnds(ends, spans, results)
          note = ` · 긴 문장 ${spans.length}개를 Agent가 나눔`
        } catch (error) {
          if (cancelled) return { end: 'cancelled' }
          note = ` · 긴 문장은 나누지 못함 (${errorText(error)})`
        }
      }
      if (get().clips !== clips || get().mediaSession !== mediaSession) return { end: 'cancelled' }
      const grouped = groupSentences(clips, ends).clips
      commit(grouped)
      set({ message: `문장 단위로 자막 ${grouped.length}개를 적용했습니다.` })
      return { end: 'done', detail: `문장 ${grouped.length}개${note}` }
    } catch (error) {
      return { end: 'failed', detail: errorText(error) }
    } finally {
      if (get().mediaSession === mediaSession) set({ job: null })
    }
  }

  return {
    media: null,
    peaks: null,
    clips: [],
    past: [],
    future: [],
    srtPath: null,
    videoInfo: null,
    transcription: null,
    projectPath: null,
    projectSubtitles: [],
    projectDirty: false,
    mediaSession: 0,
    settings: DEFAULT_SETTINGS,
    dialog: null,
    importError: null,
    job: null,
    message: null,
    dragHint: null,
    follow: true,
    refinement: null,
    pipeline: null,

    async init() {
      const saved = await api.loadSettings()
      if (get().mediaSession === 0) set({ settings: mergeSettings(saved) })
      api.onProgress((progress) => {
        const job = get().job
        if (job) set({ job: { ...job, progress } })
      })
      // A project double-clicked in Explorer starts the app with its path; open it like Ctrl+O would.
      await openProjectFrom(api.openLaunchProject)
    },

    setDialog: (dialog) => set({ dialog, ...(dialog === 'import' || dialog === 'oneShot' ? { importError: null } : {}) }),
    setMessage: (message) => set({ message }),
    setDragHint: (dragHint) => set({ dragHint }),
    setFollow: (follow) => set({ follow }),

    updateSettings(change) {
      const settings = { ...get().settings, ...change }
      set({ settings })
      void api.saveSettings(settings)
    },

    importVideo: async (url, targetDir) => (await importFrom(url, targetDir)).end === 'done',

    async openMedia() {
      if (get().job) return
      try {
        const path = await api.pickMedia()
        if (!path) return
        set({ job: { label: '영상 준비 중', progress: null } })
        try {
          await flushAutosave()
          const media = await api.openMedia(path)
          const project = await api.loadProject(path)
          await applyProject(media, project, null)
        } finally {
          set({ job: null })
        }
      } catch (error) {
        set({ message: `영상을 열 수 없습니다: ${errorText(error)}` })
      }
    },

    openProject: () => openProjectFrom(api.pickProject),

    async saveProject(saveAs = false) {
      const state = get()
      if (!state.media || state.job || savingProject) return
      savingProject = true
      try {
        // A protected video folder must not prevent saving a named project in another folder.
        await flushAutosave().catch(() => {})
        const project = projectSnapshot(get())!
        const defaultPath = state.projectPath ?? defaultProjectPath(state.media.path)
        const targetPath = saveAs ? null : state.projectPath
        const path = await api.saveProject(project, targetPath, defaultPath)
        if (path && get().mediaSession === state.mediaSession) {
          const current = get()
          const playback = usePlayback.getState()
          const dirty = current.clips !== project.clips || current.settings !== project.settings ||
            current.peaks !== state.peaks || current.srtPath !== project.srtPath ||
            (current.videoInfo ?? undefined) !== project.videoInfo ||
            (current.transcription ?? undefined) !== project.transcription ||
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
          await refreshProjectSubtitles()
        }
      } catch (error) {
        set({ message: `프로젝트 저장 실패: ${errorText(error)}` })
      } finally {
        savingProject = false
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

    async loadSrt(path) {
      const { media, projectPath, mediaSession, job: previousJob } = get()
      if (previousJob || (path && !media)) return
      const job: Job = { label: '자막 불러오는 중', progress: null }
      set({ job })
      try {
        const file = path
          ? await api.readProjectSrt(projectPath ?? media!.path, path)
          : await api.pickSrt()
        if (!file || get().mediaSession !== mediaSession) return
        const result = overlaySrt(get().clips, file.content)
        commit(result.clips)
        set({ srtPath: file.path, message: `자막 ${result.cues}개를 불러왔습니다.` })
      } catch (error) {
        if (get().mediaSession === mediaSession) {
          set({ message: `자막 불러오기 실패: ${errorText(error)}` })
          if (path) await refreshProjectSubtitles()
        }
      } finally {
        if (get().job === job) set({ job: null })
      }
    },

    async saveSrt(saveAs = false) {
      const { clips, srtPath, media } = get()
      if (clips.length === 0) return
      const fallback = media ? `${stripExtension(media.path)}.srt` : 'subtitles.srt'
      const path = await api.saveSrt(serializeSrt(clips), saveAs ? null : srtPath, srtPath ?? fallback)
      if (path) {
        set({ srtPath: path, message: `저장했습니다: ${path}` })
        await refreshProjectSubtitles()
      }
    },

    async transcribe() {
      const { clips } = get()
      set({ dialog: null })
      if (allWords(clips).length > 0) {
        const proceed = await api.confirm('음성 인식을 다시 실행할까요?', '현재 자막은 새 인식 결과로 바뀝니다. 실행 취소로 되돌릴 수 있습니다.')
        if (!proceed) return
      }
      // Recognition only: the English clean-up is its own toolbar command.
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
      commit(closeSubtitleGaps(segmentWords(words, settings.segment)))
    },

    applySentenceBoundary(sourceClips, sentenceEnds, options = {}) {
      if (get().clips !== sourceClips) {
        set({ message: '미리보기 후 자막이 변경되었습니다. 문장을 다시 분석해 주세요.' })
        return false
      }
      try {
        const { clips } = groupSentences(sourceClips, sentenceEnds, options)
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
        const face = pickFace(await loadFonts(), settings.style.font, settings.style.weight)
        const ass = buildAss(clips, settings.style, media.width, media.height, await fontLineRatio(settings.style, face), face)
        await api.startExport({ mediaPath: media.path, outputPath, ass, duration: media.duration, fontFamily: face ? settings.style.font : undefined })
        set({ message: `내보냈습니다: ${outputPath}` })
      } catch (error) {
        set({ message: errorText(error) })
      } finally {
        set({ job: null })
      }
    },

    async startAgentTranslate() {
      const { media, projectPath, clips, job, settings, mediaSession, projectSubtitles } = get()
      if (job || !media || clips.length === 0) return { end: 'failed', detail: '번역할 자막이 없습니다.' }
      const cues = translationCues(clips)
      if (cues.length === 0) {
        set({ dialog: null, message: '번역할 영어 자막이 없습니다.' })
        return { end: 'skipped', detail: '번역할 영어 자막이 없습니다.' }
      }
      const targetPath = translationTarget(stripExtension(projectPath ?? media.path))
      const fileName = targetPath.split(/[\\/]/).pop()
      const exists = projectSubtitles.some((subtitle) => subtitle.path.toLowerCase() === targetPath.toLowerCase())
      if (exists && !(await api.confirm(`${fileName} 파일을 새 번역으로 덮어쓸까요?`, '기존 한국어 자막은 사라집니다. 편집 화면의 자막은 실행 취소로 되돌릴 수 있습니다.'))) {
        return { end: 'cancelled', detail: `${fileName} 파일을 덮어쓰지 않았습니다.` }
      }
      if (get().job || get().mediaSession !== mediaSession) return { end: 'cancelled' }

      const draft = translationDraftFor(cues)
      const unsubscribe = api.onTranslateProgress((event) => {
        for (const line of event.translations) draft.done.set(line.id, line.text)
        if (get().mediaSession !== mediaSession) return
        set((state) => (state.job ? { job: { ...state.job, label: event.label, progress: event.progress } } : {}))
      })
      let cancelled = false
      const cancel = () => {
        cancelled = true
        void api.cancelAgentTranslate()
      }
      set({ dialog: null, job: { label: 'Agent 번역 준비 중', progress: draft.done.size / cues.length, cancel } })

      try {
        const translations = await api.startAgentTranslate({
          cues,
          done: [...draft.done].map(([id, text]) => ({ id, text })),
          glossary: glossaryTerms(settings.dictionary)
        })
        if (get().mediaSession !== mediaSession) return { end: 'cancelled' }
        translationDraft = null
        const translated = applyTranslations(get().clips, clips, translations)
        commit(translated)
        // Written as a companion of the project, so the language buttons can switch back to it.
        const path = await api.saveSrt(serializeSrt(translated), targetPath, targetPath)
        set({ srtPath: path ?? targetPath, message: `Agent 번역을 마치고 저장했습니다: ${fileName}` })
        await refreshProjectSubtitles()
        return { end: 'done', detail: `자막 ${cues.length}개 · ${fileName} 저장` }
      } catch (error) {
        if (get().mediaSession !== mediaSession) return { end: 'cancelled' }
        const kept = draft.done.size > 0 && draft.done.size < cues.length
          ? ` 번역한 ${draft.done.size}/${cues.length}개는 기억해 두었다가 다시 시작하면 이어서 번역합니다.`
          : ''
        set({ message: `Agent 번역 실패: ${errorText(error)}${kept}` })
        return { end: cancelled ? 'cancelled' : 'failed', detail: `${errorText(error)}${kept}` }
      } finally {
        unsubscribe()
        if (get().mediaSession === mediaSession) set({ job: null })
      }
    },

    async startRefine() {
      const { refinement } = await requestRefinement()
      if (!refinement) return
      if (refinement.corrections.length === 0) {
        const unchecked = refinement.failed > 0 ? ` 일부 구간(${refinement.failed}곳)은 응답을 받지 못해 그대로 두었습니다.` : ''
        set({ message: `영어 다듬기: 고칠 곳을 찾지 못했습니다.${unchecked}` })
        return
      }
      set({ refinement, dialog: 'refine' })
    },

    applyRefinement(chosen, terms) {
      const { refinement, clips, settings } = get()
      if (!refinement) return
      if (clips !== refinement.source) {
        set({ refinement: null, dialog: null, message: '교정을 검토하는 동안 자막이 바뀌어 적용하지 않았습니다. 영어 다듬기를 다시 실행해 주세요.' })
        return
      }
      if (chosen.length > 0) commit(applyCorrections(clips, chosen))
      if (terms.length > 0) get().updateSettings({ dictionary: addDictionaryTerms(settings.dictionary, terms) })
      const added = terms.length > 0 ? `, 단어 사전에 용어 ${terms.length}개 추가` : ''
      set({ refinement: null, dialog: null, message: `영어 대사 ${chosen.length}곳을 다듬었습니다${added}.` })
    },

    dismissRefinement: () => set({ refinement: null, dialog: null }),

    async runOneShot(url, targetDir) {
      if (get().job || (get().pipeline && !get().pipeline!.outcome)) return
      const checked = checkImport(url, targetDir)
      if ('error' in checked) {
        set({ importError: checked.error })
        return
      }
      set({
        dialog: null,
        importError: null,
        pipeline: { steps: PIPELINE_STEPS.map(({ key, label }) => ({ key, label, state: 'pending' })), outcome: null }
      })
      const update = (key: PipelineStepKey, change: Partial<PipelineStep>) => set((state) => state.pipeline
        ? { pipeline: { ...state.pipeline, steps: state.pipeline.steps.map((step) => step.key === key ? { ...step, ...change } : step) } }
        : {})
      const run = async <T extends StepEnd>(key: PipelineStepKey, work: () => Promise<T>): Promise<T> => {
        update(key, { state: 'running', startedAt: Date.now() })
        let result: T
        try {
          result = await work()
        } catch (error) {
          result = { end: 'failed', detail: errorText(error) } as T
        }
        update(key, { state: result.end, detail: result.detail, endedAt: Date.now() })
        return result
      }
      const stop = (outcome: NonNullable<Pipeline['outcome']>) => {
        let finished: Pipeline | null = null
        set((state) => {
          if (!state.pipeline) return {}
          finished = {
            outcome,
            steps: state.pipeline.steps.map((step) => step.state === 'pending' ? { ...step, state: 'skipped' } : step)
          }
          return { pipeline: finished }
        })
        const notice = finished ? pipelineNotification(finished) : null
        if (notice) void api.notify?.(notice.title, notice.body).catch(() => {})
      }
      const halted = (result: StepEnd) => result.end === 'cancelled' ? 'cancelled' : 'failed'

      const imported = await run('import', () => importFrom(checked.url, targetDir))
      if (imported.end !== 'done') return stop(halted(imported))

      const recognised = await run('transcribe', async (): Promise<StepEnd & { language?: string }> => {
        if (allWords(get().clips).length > 0 &&
          !(await api.confirm('이 영상에는 이미 자막이 있습니다. 음성 인식을 다시 실행할까요?', '현재 자막은 새 인식 결과로 바뀝니다. 실행 취소로 되돌릴 수 있습니다.'))) {
          return { end: 'cancelled', detail: '기존 자막을 그대로 두었습니다.' }
        }
        return runTranscription()
      })
      if (recognised.end !== 'done') return stop(halted(recognised))
      if (recognised.language !== 'en') {
        const detail = '영어 대사가 아니라 건너뛰었습니다.'
        for (const key of ['refine', 'group', 'translate'] as const) update(key, { state: 'skipped', detail })
        return stop('done')
      }

      // Unattended: every correction goes in, the dictionary is left as it is.
      const refined = await run('refine', async (): Promise<StepEnd> => {
        const { refinement, ...result } = await requestRefinement()
        if (!refinement) return result
        const unchecked = refinement.failed > 0 ? ` · 응답 없는 구간 ${refinement.failed}곳은 그대로` : ''
        if (refinement.corrections.length === 0) return { end: 'done', detail: `고칠 곳 없음${unchecked}` }
        if (get().clips !== refinement.source) return { end: 'cancelled' }
        commit(applyCorrections(refinement.source, refinement.corrections))
        const words = refinement.corrections.filter((correction) => correction.kind === 'word').length
        const style = refinement.corrections.length - words
        set({ message: `영어 대사 ${refinement.corrections.length}곳을 다듬었습니다.` })
        return { end: 'done', detail: `단어 ${words}곳 · 문장부호·대소문자 ${style}곳 고침${unchecked}` }
      })
      // A failed clean-up leaves the words as heard; grouping and translating still work on them.
      if (refined.end === 'cancelled') return stop('cancelled')

      const grouped = await run('group', groupIntoSentences)
      if (grouped.end === 'cancelled') return stop('cancelled')

      const translated = await run('translate', () => get().startAgentTranslate())
      // Reaching the end is 'done' even when a middle step failed; the checklist shows which one.
      stop(translated.end === 'cancelled' ? 'cancelled' : 'done')
    },

    closePipeline() {
      if (get().pipeline?.outcome) set({ pipeline: null })
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
    setDuration(index, seconds) {
      const { clips, media } = get()
      const next = setClipDuration(clips, index, seconds, media?.duration)
      if (next !== clips) commit(next)
    },
    split: (index, word) => commit(splitClip(get().clips, index, word)),
    merge: (index) => commit(mergeWithNext(get().clips, index)),
    remove: (index) => commit(removeClip(get().clips, index))
  }
})

function projectSnapshot(state: State, playback = usePlayback.getState()): ProjectFile | null {
  if (!state.media) return null
  return buildProject({
    media: state.media,
    clips: state.clips,
    settings: state.settings,
    peaks: state.peaks,
    playback: { time: playback.time, rate: playback.rate, follow: state.follow },
    srtPath: state.srtPath,
    videoInfo: state.videoInfo,
    transcription: state.transcription
  })
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
    state.follow === previous.follow && state.srtPath === previous.srtPath && state.videoInfo === previous.videoInfo &&
    state.transcription === previous.transcription) return
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

function formatElapsed(from: number, to: number) {
  const seconds = Math.max(0, Math.round((to - from) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Desktop notification copy for a finished or halted one-shot run; user cancellations stay quiet. */
export function pipelineNotification(pipeline: Pipeline): { title: string; body: string } | null {
  if (!pipeline.outcome || pipeline.outcome === 'cancelled') return null
  const doneCount = pipeline.steps.filter((step) => step.state === 'done').length
  const failedSteps = pipeline.steps.filter((step) => step.state === 'failed')
  const first = pipeline.steps.find((step) => step.startedAt)?.startedAt
  const last = Math.max(...pipeline.steps.map((step) => step.endedAt ?? 0))
  const duration = first && last >= first ? formatElapsed(first, last) : null
  const videoName = pipeline.steps.find((step) => step.key === 'import' && step.state === 'done')?.detail

  const title = pipeline.outcome === 'failed'
    ? '영상 한번에 중단됨'
    : failedSteps.length > 0 ? '영상 한번에 완료 (일부 단계 실패)' : '영상 한번에 완료'

  const lines: string[] = []
  if (videoName) lines.push(videoName)
  if (pipeline.outcome === 'failed' && failedSteps[0]) {
    const failed = failedSteps[0]
    const reason = failed.detail ? `: ${failed.detail}` : ''
    lines.push(`${failed.label} 실패${reason}${duration ? ` · ${duration}` : ''}`)
  } else {
    const failedNote = failedSteps.length > 0 ? ` (${failedSteps.map((step) => step.label).join(', ')} 실패)` : ''
    lines.push(`${doneCount}/${pipeline.steps.length} 단계 완료${failedNote}${duration ? ` · ${duration}` : ''}`)
  }
  return { title, body: lines.join('\n') }
}
