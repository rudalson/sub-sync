import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSrt } from '../src/shared/srt'
import { makeProject, media } from './fixtures/project'

const api = {
  pickMedia: vi.fn(), openMedia: vi.fn(), loadPeaks: vi.fn(), loadProject: vi.fn(),
  pickProject: vi.fn(), saveProject: vi.fn(), autosaveProject: vi.fn(),
  saveSettings: vi.fn(), loadSettings: vi.fn(), onProgress: vi.fn(),
  startStt: vi.fn(), onSttEvent: vi.fn(), saveSrt: vi.fn(), closeWindow: vi.fn(), confirm: vi.fn()
}

let useStore: typeof import('../src/renderer/src/store').useStore
let flushAutosave: typeof import('../src/renderer/src/store').flushAutosave
let usePlayback: typeof import('../src/renderer/src/player').usePlayback
let videoLoaded: typeof import('../src/renderer/src/player').videoLoaded

beforeAll(async () => {
  vi.stubGlobal('window', { api })
  ;({ useStore, flushAutosave } = await import('../src/renderer/src/store'))
  ;({ usePlayback, videoLoaded } = await import('../src/renderer/src/player'))
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  useStore.setState(useStore.getInitialState(), true)
  usePlayback.setState(usePlayback.getInitialState(), true)
  api.pickMedia.mockResolvedValue(media.path)
  api.openMedia.mockResolvedValue(media)
  api.loadProject.mockResolvedValue(null)
  api.loadPeaks.mockResolvedValue(Uint8Array.from(makeProject().waveform!.peaks))
  api.autosaveProject.mockResolvedValue(undefined)
  api.saveProject.mockResolvedValue('C:\\Projects\\편집.subsync.json')
  api.loadSettings.mockResolvedValue({})
  api.saveSettings.mockResolvedValue(undefined)
  api.closeWindow.mockResolvedValue(undefined)
})

afterEach(async () => {
  api.autosaveProject.mockResolvedValue(undefined)
  await flushAutosave().catch(() => {})
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('project editing session', () => {
  it('releases the progress overlay when starting the native STT process fails', async () => {
    await useStore.getState().openMedia()
    api.onSttEvent.mockReturnValue(vi.fn())
    api.startStt.mockRejectedValue(new Error('Python 환경이 없습니다.'))
    await useStore.getState().transcribe()
    expect(useStore.getState().job).toBeNull()
    expect(useStore.getState().message).toContain('Python 환경')
  })
  it('saves SRT with connected display timing while preserving editable speech anchors', async () => {
    await useStore.getState().openMedia()
    const clips = makeProject().clips
    clips[1] = { ...clips[1], start: 4, text: '다음 자막' }
    useStore.setState({ clips })
    api.saveSrt.mockResolvedValue('C:\\Videos\\원본.srt')
    await useStore.getState().saveSrt()
    const saved = parseSrt(api.saveSrt.mock.calls[0][0])
    expect(saved[0].end).toBe(4)
    expect(saved[1].start).toBe(4)
    expect(useStore.getState().clips).toBe(clips)
    expect(useStore.getState().clips[0].end).toBe(3.875)
    expect(useStore.getState().clips[0].words.at(-1)?.end).toBe(3.875)
  })

  it('saves all editing data separately from SRT, then overwrites or saves as requested', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    useStore.getState().editText(0, '최종 수정 자막')
    useStore.getState().dragEdge(0, { kind: 'between', word: 0 }, 2)
    useStore.getState().updateSettings(makeProject().settings)
    useStore.getState().setFollow(false)
    usePlayback.setState({ time: 42.625, rate: 1.25 })
    await useStore.getState().saveProject()

    const [project, path, defaultPath] = api.saveProject.mock.calls[0]
    expect(project).toMatchObject({
      version: 2, format: 'sub-sync', clips: [{ text: '최종 수정 자막' }, {}],
      waveform: makeProject().waveform, settings: makeProject().settings,
      playback: { time: 42.625, rate: 1.25, follow: false }
    })
    expect(project.clips[0].words[0].end).toBe(2)
    expect(project.clips[0].words[1].start).toBe(2)
    expect(project.media).not.toHaveProperty('url')
    expect(path).toBeNull()
    expect(defaultPath).toBe('C:\\Videos\\원본.subsync.json')
    expect(api.saveSrt).not.toHaveBeenCalled()
    expect(useStore.getState().projectDirty).toBe(false)

    await useStore.getState().saveProject()
    expect(api.saveProject.mock.calls[1][1]).toBe('C:\\Projects\\편집.subsync.json')
    await useStore.getState().saveProject(true)
    expect(api.saveProject.mock.calls[2][1]).toBeNull()
  })

  it('restores a saved project without STT or waveform extraction and resumes editing', async () => {
    await useStore.getState().openMedia()
    const previousSession = useStore.getState().mediaSession
    const project = makeProject()
    api.pickProject.mockResolvedValue({ path: 'C:\\Projects\\편집.subsync.json', media, project })
    api.loadPeaks.mockClear()
    await useStore.getState().openProject()

    const state = useStore.getState()
    expect(state.clips).toEqual(project.clips)
    expect(state.peaks).toEqual(Uint8Array.from(project.waveform!.peaks))
    expect(state.settings).toEqual(project.settings)
    expect(state.srtPath).toBe(project.srtPath)
    expect(state.follow).toBe(false)
    expect(state.past).toEqual([])
    expect(state.future).toEqual([])
    expect(state.mediaSession).toBe(previousSession + 1)
    expect(state.projectDirty).toBe(false)
    expect(api.loadPeaks).not.toHaveBeenCalled()
    expect(api.startStt).not.toHaveBeenCalled()
    expect(usePlayback.getState()).toMatchObject({ time: 42.625, rate: 1.25, playing: false })

    const video = { duration: 120, currentTime: 0, playbackRate: 1 } as HTMLVideoElement
    videoLoaded(video)
    expect(video.currentTime).toBe(42.625)
    expect(video.playbackRate).toBe(1.25)
    useStore.getState().beginEdit()
    useStore.getState().editText(0, '복원 후 수정')
    expect(useStore.getState().projectDirty).toBe(true)
    useStore.getState().undo()
    expect(useStore.getState().clips).toEqual(project.clips)
  })

  it('restores a version 1 autosave and creates the missing waveform without rerunning STT', async () => {
    api.loadProject.mockResolvedValue({ version: 1, mediaSize: media.size, clips: makeProject().clips })
    await useStore.getState().openMedia()
    expect(useStore.getState().clips).toEqual(makeProject().clips)
    expect(useStore.getState().peaks).toEqual(Uint8Array.from(makeProject().waveform!.peaks))
    expect(api.loadPeaks).toHaveBeenCalledExactlyOnceWith(media.path)
    expect(api.startStt).not.toHaveBeenCalled()
  })

  it('restores a version 2 autosave directly when the video is opened', async () => {
    api.loadProject.mockResolvedValue(makeProject())
    await useStore.getState().openMedia()
    expect(useStore.getState().settings).toEqual(makeProject().settings)
    expect(useStore.getState().peaks).toEqual(Uint8Array.from(makeProject().waveform!.peaks))
    expect(api.loadPeaks).not.toHaveBeenCalled()
    expect(usePlayback.getState().time).toBe(42.625)
  })

  it('flushes the old video snapshot before switching so delayed writes never mix two videos', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    useStore.getState().editText(0, '첫 번째 영상의 편집')
    const second = { ...media, path: 'C:\\Videos\\second.mp4', size: 8192 }
    api.pickMedia.mockResolvedValue(second.path)
    api.openMedia.mockResolvedValue(second)
    await useStore.getState().openMedia()
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.autosaveProject).toHaveBeenCalledTimes(1)
    const [path, project] = api.autosaveProject.mock.calls[0]
    expect(path).toBe(media.path)
    expect(project.media.path).toBe(media.path)
    expect(project.clips[0].text).toBe('첫 번째 영상의 편집')
    expect(useStore.getState().media?.path).toBe(second.path)
    expect(useStore.getState().clips).toEqual([])
  })

  it('keeps the current session when opening is cancelled or a project is invalid', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    const clips = useStore.getState().clips
    api.pickProject.mockResolvedValue(null)
    await useStore.getState().openProject()
    expect(useStore.getState().clips).toBe(clips)
    api.pickProject.mockRejectedValue(new Error('프로젝트 파일이 손상되었습니다.'))
    await useStore.getState().openProject()
    expect(useStore.getState().clips).toBe(clips)
    expect(useStore.getState().media).toBe(media)
    expect(useStore.getState().message).toContain('손상')
    expect(useStore.getState().job).toBeNull()
  })

  it('keeps unsaved changes and the old path if Save As is cancelled', async () => {
    await useStore.getState().openMedia()
    await useStore.getState().saveProject()
    useStore.setState({ clips: makeProject().clips })
    api.saveProject.mockResolvedValue(null)
    await useStore.getState().saveProject(true)
    expect(useStore.getState().projectPath).toBe('C:\\Projects\\편집.subsync.json')
    expect(useStore.getState().projectDirty).toBe(true)
  })

  it('can save before STT, with an empty subtitle list and no audio', async () => {
    api.openMedia.mockResolvedValue({ ...media, hasAudio: false })
    await useStore.getState().openMedia()
    await useStore.getState().saveProject()
    expect(api.saveProject.mock.calls[0][0]).toMatchObject({ clips: [], waveform: null })
    expect(api.loadPeaks).not.toHaveBeenCalled()
  })

  it('can save elsewhere and switch videos after autosave fails in a protected video folder', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    api.autosaveProject.mockRejectedValue(new Error('EACCES'))
    await useStore.getState().saveProject()
    expect(useStore.getState().projectDirty).toBe(false)
    expect(useStore.getState().message).toContain('프로젝트를 저장했습니다')
    await useStore.getState().openMedia()
    expect(useStore.getState().message).toBeNull()
  })

  it('retains the dirty flag if editing data changes while a save is in progress', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    api.saveProject.mockImplementation(async () => {
      useStore.getState().editText(0, '저장 이후 변경')
      return 'C:\\Projects\\편집.subsync.json'
    })
    await useStore.getState().saveProject()
    expect(useStore.getState().projectDirty).toBe(true)
  })

  it('finishes the latest snapshot before closing, including a playing video position', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    usePlayback.setState({ playing: true, time: 68.25 })
    await useStore.getState().closeWindow()
    expect(api.autosaveProject.mock.calls.at(-1)![1].playback.time).toBe(68.25)
    expect(api.autosaveProject.mock.invocationCallOrder[0]).toBeLessThan(api.closeWindow.mock.invocationCallOrder[0])
  })

  it('keeps the window open if autosave fails and the user cancels closing', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    api.autosaveProject.mockRejectedValue(new Error('Disk full'))
    api.confirm.mockResolvedValue(false)
    await useStore.getState().closeWindow()
    expect(api.closeWindow).not.toHaveBeenCalled()
    expect(useStore.getState().job).toBeNull()
    expect(useStore.getState().clips).toEqual(makeProject().clips)
  })

  it('applies sentence boundaries with undo support and rejects invalid boundary results', () => {
    const clips = makeProject().clips
    clips[1] = { ...clips[1], text: 'Next.', words: [{ text: 'Next.', start: clips[1].start, end: clips[1].end }] }
    useStore.setState({ clips, past: [], future: [] })

    const allWords = clips.flatMap((c) => c.words)
    expect(useStore.getState().applySentenceBoundary(clips, [allWords.length])).toBe(true)
    expect(useStore.getState().clips).toHaveLength(1)
    expect(useStore.getState().clips[0].words).toEqual(allWords)
    expect(useStore.getState().clips[0].text).toBe(clips.map((clip) => clip.text).join(' '))
    expect(useStore.getState().past).toHaveLength(1)
    expect(useStore.getState().past[0]).toEqual(clips)
    expect(useStore.getState().message).toContain('문장 단위로 자막 1개를 적용했습니다')

    useStore.getState().undo()
    expect(useStore.getState().clips).toEqual(clips)
    expect(useStore.getState().applySentenceBoundary(clips, [allWords.length - 1])).toBe(false)
    expect(useStore.getState().clips).toEqual(clips)
    expect(useStore.getState().message).toContain('누락')
    expect(useStore.getState().past).toHaveLength(0)
  })

  it('rejects a stale preview instead of overwriting newer subtitle edits', () => {
    const clips = makeProject().clips
    useStore.setState({ clips, past: [], future: [] })
    useStore.getState().editText(0, '미리보기 이후 수정')
    expect(useStore.getState().applySentenceBoundary(clips, [clips.flatMap((clip) => clip.words).length])).toBe(false)
    expect(useStore.getState().clips[0].text).toBe('미리보기 이후 수정')
    expect(useStore.getState().message).toContain('미리보기 후 자막이 변경')
    expect(useStore.getState().past).toHaveLength(0)
  })

  it('saves wordless captions and edits after reconstruction and can undo the entire operation', async () => {
    await useStore.getState().openMedia()
    const source = makeProject().clips
    const title = { id: 'wordless-title', start: 4, end: 4.5, text: '유지할 화면 설명', words: [] }
    const clips = [source[0], title, source[1]]
    useStore.setState({ clips, past: [], future: [] })
    const ends = [clips.flatMap((clip) => clip.words).length]
    expect(useStore.getState().applySentenceBoundary(clips, ends)).toBe(true)
    expect(useStore.getState().clips.find((clip) => clip.id === title.id)).toEqual(title)
    expect(useStore.getState().clips.map((clip) => clip.text)).toEqual(clips.map((clip) => clip.text))
    await useStore.getState().saveProject()
    const saved = api.saveProject.mock.calls[0][0]
    expect(saved.clips.find((clip: { id: string }) => clip.id === title.id)).toEqual(title)
    expect(saved.clips.flatMap((clip: { words: unknown[] }) => clip.words)).toEqual(clips.flatMap((clip) => clip.words))
    useStore.getState().undo()
    expect(useStore.getState().clips).toEqual(clips)
    useStore.getState().redo()
    expect(useStore.getState().clips.find((clip) => clip.id === title.id)).toEqual(title)
  })
})
