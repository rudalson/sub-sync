import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSrt } from '../src/shared/srt'
import { makeProject, media } from './fixtures/project'

const api = {
  pickMedia: vi.fn(), openMedia: vi.fn(), loadPeaks: vi.fn(), loadProject: vi.fn(),
  pickProject: vi.fn(), saveProject: vi.fn(), autosaveProject: vi.fn(),
  listProjectSubtitles: vi.fn(), readProjectSrt: vi.fn(), pickSrt: vi.fn(),
  importVideo: vi.fn(), cancelImportVideo: vi.fn(), onImportProgress: vi.fn(),
  startAgentTranslate: vi.fn(), cancelAgentTranslate: vi.fn(), onTranslateProgress: vi.fn(),
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
  api.listProjectSubtitles.mockResolvedValue([])
  api.loadPeaks.mockResolvedValue(Uint8Array.from(makeProject().waveform!.peaks))
  api.autosaveProject.mockResolvedValue(undefined)
  api.saveProject.mockResolvedValue('C:\\Projects\\편집.subsync')
  api.loadSettings.mockResolvedValue({})
  api.saveSettings.mockResolvedValue(undefined)
  api.closeWindow.mockResolvedValue(undefined)
  api.onImportProgress.mockReturnValue(vi.fn())
  api.cancelImportVideo.mockResolvedValue(undefined)
  api.onTranslateProgress.mockReturnValue(vi.fn())
  api.cancelAgentTranslate.mockResolvedValue(undefined)
})

afterEach(async () => {
  api.autosaveProject.mockResolvedValue(undefined)
  await flushAutosave().catch(() => {})
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('project editing session', () => {
  it('downloads a URL into the selected directory and opens the video without a file picker', async () => {
    const downloaded = { ...media, path: 'C:\\Downloads\\가져온 영상.mp4' }
    api.importVideo.mockResolvedValue(downloaded.path)
    api.openMedia.mockResolvedValue(downloaded)
    useStore.getState().setDialog('import')
    expect(await useStore.getState().importVideo(' https://youtu.be/abc123 ', 'C:\\Downloads')).toBe(true)
    expect(api.importVideo).toHaveBeenCalledExactlyOnceWith('https://youtu.be/abc123', 'C:\\Downloads')
    expect(api.openMedia).toHaveBeenCalledExactlyOnceWith(downloaded.path)
    expect(api.loadProject).toHaveBeenCalledExactlyOnceWith(downloaded.path)
    expect(api.pickMedia).not.toHaveBeenCalled()
    expect(useStore.getState().media).toEqual(downloaded)
    expect(useStore.getState().dialog).toBeNull()
    expect(useStore.getState().job).toBeNull()
    expect(useStore.getState().importError).toBeNull()
    expect(api.onImportProgress.mock.results[0].value).toHaveBeenCalledOnce()
  })

  it('shows URL validation and missing-directory errors before starting a download', async () => {
    expect(await useStore.getState().importVideo('file:///C:/video.mp4', 'C:\\Downloads')).toBe(false)
    expect(useStore.getState().importError).toContain('URL')
    expect(await useStore.getState().importVideo('https://youtu.be/abc123', '')).toBe(false)
    expect(useStore.getState().importError).toContain('폴더')
    expect(api.importVideo).not.toHaveBeenCalled()
    expect(useStore.getState().job).toBeNull()
  })

  it('keeps the existing editing session when the URL download fails', async () => {
    api.loadProject.mockResolvedValue(makeProject())
    await useStore.getState().openMedia()
    useStore.getState().editText(0, '가져오기 전 편집')
    const previous = useStore.getState()
    useStore.getState().setDialog('import')
    api.importVideo.mockRejectedValue(new Error('지원하지 않는 URL입니다.'))
    expect(await useStore.getState().importVideo('https://example.com/not-a-video', 'C:\\Downloads')).toBe(false)
    expect(useStore.getState().media).toBe(previous.media)
    expect(useStore.getState().clips).toBe(previous.clips)
    expect(useStore.getState().mediaSession).toBe(previous.mediaSession)
    expect(useStore.getState().dialog).toBe('import')
    expect(useStore.getState().importError).toContain('지원하지 않는 URL')
    expect(useStore.getState().job).toBeNull()
  })

  it('updates progress and waits for cancellation before allowing another import', async () => {
    await useStore.getState().openMedia()
    const previous = useStore.getState()
    let rejectDownload!: (error: Error) => void
    api.importVideo.mockImplementation(() => new Promise<string>((_resolve, reject) => { rejectDownload = reject }))
    const pending = useStore.getState().importVideo('https://youtu.be/abc123', 'C:\\Downloads')
    await vi.waitFor(() => expect(api.importVideo).toHaveBeenCalledOnce())
    const progress = api.onImportProgress.mock.calls[0][0]
    progress({ label: '영상 다운로드 중', progress: 0.5 })
    expect(useStore.getState().job?.progress).toBe(0.5)
    useStore.getState().job?.cancel?.()
    expect(api.cancelImportVideo).toHaveBeenCalledOnce()
    expect(useStore.getState().job?.label).toBe('가져오기 취소 중')
    progress({ label: '영상 다운로드 중', progress: 0.75 })
    expect(useStore.getState().job?.label).toBe('가져오기 취소 중')
    expect(await useStore.getState().importVideo('https://youtu.be/other', 'C:\\Downloads')).toBe(false)
    rejectDownload(new Error('작업을 취소했습니다.'))
    expect(await pending).toBe(false)
    expect(useStore.getState().media).toBe(previous.media)
    expect(useStore.getState().mediaSession).toBe(previous.mediaSession)
    expect(useStore.getState().job).toBeNull()
    expect(useStore.getState().importError).toBeNull()
    expect(api.importVideo).toHaveBeenCalledOnce()
  })

  it('keeps the old project when a downloaded file cannot be opened as a video', async () => {
    await useStore.getState().openMedia()
    const previous = useStore.getState()
    api.importVideo.mockResolvedValue('C:\\Downloads\\broken.mp4')
    api.openMedia.mockRejectedValue(new Error('영상 파일이 아닙니다.'))
    expect(await useStore.getState().importVideo('https://example.com/broken.mp4', 'C:\\Downloads')).toBe(false)
    expect(useStore.getState().media).toBe(previous.media)
    expect(useStore.getState().mediaSession).toBe(previous.mediaSession)
    expect(useStore.getState().importError).toContain('영상 파일이 아닙니다')
    expect(useStore.getState().job).toBeNull()
  })

  it('delivers an early cancellation as soon as the native download job starts', async () => {
    let rejectDownload!: (error: Error) => void
    api.importVideo.mockImplementation(() => new Promise<string>((_resolve, reject) => { rejectDownload = reject }))
    const pending = useStore.getState().importVideo('https://youtu.be/abc123', 'C:\\Downloads')
    await vi.waitFor(() => expect(api.importVideo).toHaveBeenCalledOnce())
    useStore.getState().job?.cancel?.()
    expect(api.cancelImportVideo).not.toHaveBeenCalled()
    api.onImportProgress.mock.calls[0][0]({ label: '영상 URL 확인 중', progress: null })
    expect(api.cancelImportVideo).toHaveBeenCalledOnce()
    rejectDownload(new Error('작업을 취소했습니다.'))
    expect(await pending).toBe(false)
    expect(useStore.getState().media).toBeNull()
    expect(useStore.getState().job).toBeNull()
  })

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
    expect(defaultPath).toBe('C:\\Videos\\원본.subsync')
    expect(api.saveSrt).not.toHaveBeenCalled()
    expect(useStore.getState().projectDirty).toBe(false)

    await useStore.getState().saveProject()
    expect(api.saveProject.mock.calls[1][1]).toBe('C:\\Projects\\편집.subsync')
    await useStore.getState().saveProject(true)
    expect(api.saveProject.mock.calls[2][1]).toBeNull()
  })

  it('restores a saved project without STT or waveform extraction and resumes editing', async () => {
    await useStore.getState().openMedia()
    const previousSession = useStore.getState().mediaSession
    const project = makeProject()
    api.pickProject.mockResolvedValue({ path: 'C:\\Projects\\편집.subsync', media, project })
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

  it('discovers subtitles beside the named project and clears them when opening another video', async () => {
    const path = 'C:\\Projects\\편집.subsync'
    const subtitles = [
      { path: 'C:\\Projects\\편집.en.srt', language: 'en' },
      { path: 'C:\\Projects\\편집.ko.srt', language: 'ko' }
    ]
    api.pickProject.mockResolvedValue({ path, media, project: makeProject() })
    api.listProjectSubtitles.mockResolvedValue(subtitles)
    await useStore.getState().openProject()
    expect(api.listProjectSubtitles).toHaveBeenCalledExactlyOnceWith(path)
    expect(useStore.getState().projectSubtitles).toEqual(subtitles)
    expect(useStore.getState().projectDirty).toBe(false)

    api.listProjectSubtitles.mockResolvedValue([])
    await useStore.getState().openMedia()
    expect(api.listProjectSubtitles).toHaveBeenLastCalledWith(media.path)
    expect(useStore.getState().projectSubtitles).toEqual([])
  })

  it('keeps the project usable when companion subtitle discovery fails', async () => {
    api.listProjectSubtitles.mockRejectedValue(new Error('폴더를 읽을 수 없습니다.'))
    api.pickProject.mockResolvedValue({ path: 'C:\\Projects\\편집.subsync', media, project: makeProject() })
    await useStore.getState().openProject()
    expect(useStore.getState().clips).toEqual(makeProject().clips)
    expect(useStore.getState().projectSubtitles).toEqual([])
    expect(useStore.getState().job).toBeNull()
  })

  it('loads a companion SRT directly, preserves speech anchors, and supports undo and saving', async () => {
    const project = makeProject()
    const projectPath = 'C:\\Projects\\편집.subsync'
    const subtitlePath = 'C:\\Projects\\편집.ko.srt'
    api.pickProject.mockResolvedValue({ path: projectPath, media, project })
    await useStore.getState().openProject()
    api.readProjectSrt.mockResolvedValue({
      path: subtitlePath,
      content: '1\n00:00:01,125 --> 00:00:03,875\n안녕하세요\n'
    })
    await useStore.getState().loadSrt(subtitlePath)
    const state = useStore.getState()
    expect(api.readProjectSrt).toHaveBeenCalledExactlyOnceWith(projectPath, subtitlePath)
    expect(api.pickSrt).not.toHaveBeenCalled()
    expect(state.clips).toMatchObject([{ start: 1.125, end: 3.875, text: '안녕하세요', words: project.clips[0].words }])
    expect(state.srtPath).toBe(subtitlePath)
    expect(state.projectDirty).toBe(true)
    expect(state.job).toBeNull()

    api.saveSrt.mockResolvedValue(subtitlePath)
    await useStore.getState().saveSrt()
    expect(api.saveSrt).toHaveBeenCalledWith(expect.stringContaining('안녕하세요'), subtitlePath, subtitlePath)
    useStore.getState().undo()
    expect(useStore.getState().clips).toEqual(project.clips)
    useStore.getState().redo()
    expect(useStore.getState().clips[0].text).toBe('안녕하세요')
  })

  it('keeps the original SRT picker and loads its selection as one undo step', async () => {
    await useStore.getState().openMedia()
    api.pickSrt.mockResolvedValue({ path: 'C:\\Other\\번역.srt', content: '1\n00:00:01,000 --> 00:00:02,000\n선택한 자막\n' })
    await useStore.getState().loadSrt()
    expect(api.pickSrt).toHaveBeenCalledOnce()
    expect(api.readProjectSrt).not.toHaveBeenCalled()
    expect(useStore.getState().clips[0].text).toBe('선택한 자막')
    useStore.getState().undo()
    expect(useStore.getState().clips).toEqual([])
  })

  it('keeps current edits and removes a stale shortcut when its SRT was deleted', async () => {
    const project = makeProject()
    api.pickProject.mockResolvedValue({ path: 'C:\\Projects\\편집.subsync', media, project })
    api.listProjectSubtitles.mockResolvedValue([{ path: 'C:\\Projects\\편집.ko.srt', language: 'ko' }])
    await useStore.getState().openProject()
    api.readProjectSrt.mockRejectedValue(new Error('프로젝트 폴더에서 해당 자막을 찾을 수 없습니다.'))
    api.listProjectSubtitles.mockResolvedValue([])
    await useStore.getState().loadSrt('C:\\Projects\\편집.ko.srt')
    expect(useStore.getState().clips).toBe(project.clips)
    expect(useStore.getState().srtPath).toBe(project.srtPath)
    expect(useStore.getState().past).toEqual([])
    expect(useStore.getState().projectSubtitles).toEqual([])
    expect(useStore.getState().message).toContain('자막을 찾을 수 없습니다')
    expect(useStore.getState().job).toBeNull()
  })

  it('rejects empty SRTs without replacing existing subtitles', async () => {
    const project = makeProject()
    api.pickProject.mockResolvedValue({ path: 'C:\\Projects\\편집.subsync', media, project })
    await useStore.getState().openProject()
    api.readProjectSrt.mockResolvedValue({ path: 'C:\\Projects\\편집.ko.srt', content: '' })
    await useStore.getState().loadSrt('C:\\Projects\\편집.ko.srt')
    expect(useStore.getState().clips).toBe(project.clips)
    expect(useStore.getState().srtPath).toBe(project.srtPath)
    expect(useStore.getState().past).toEqual([])
    expect(useStore.getState().message).toContain('SRT에서 자막을 찾지 못했습니다')
    expect(useStore.getState().job).toBeNull()
  })

  it('refreshes companion buttons after saving the project into another folder', async () => {
    await useStore.getState().openMedia()
    const subtitles = [{ path: 'C:\\Projects\\편집.en.srt', language: 'en' }]
    api.listProjectSubtitles.mockResolvedValue(subtitles)
    await useStore.getState().saveProject(true)
    expect(api.listProjectSubtitles).toHaveBeenLastCalledWith('C:\\Projects\\편집.subsync')
    expect(useStore.getState().projectSubtitles).toEqual(subtitles)
    expect(useStore.getState().projectDirty).toBe(false)
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

  it('keeps unsaved changes and the old path if Save As is cancelled without showing a progress overlay', async () => {
    await useStore.getState().openMedia()
    await useStore.getState().saveProject()
    useStore.setState({ clips: makeProject().clips })
    let jobDuringSave: unknown = undefined
    api.saveProject.mockImplementation(async () => {
      jobDuringSave = useStore.getState().job
      return null
    })
    await useStore.getState().saveProject(true)
    expect(jobDuringSave).toBeNull()
    expect(useStore.getState().job).toBeNull()
    expect(useStore.getState().projectPath).toBe('C:\\Projects\\편집.subsync')
    expect(useStore.getState().projectDirty).toBe(true)
  })

  it('ignores concurrent save requests while saving is already in progress', async () => {
    await useStore.getState().openMedia()
    let resolveSave!: (path: string) => void
    const savePromise = new Promise<string>((resolve) => {
      resolveSave = resolve
    })
    api.saveProject.mockImplementation(() => savePromise)
    const firstSave = useStore.getState().saveProject(true)
    const secondSave = useStore.getState().saveProject(true)
    resolveSave('C:\\Projects\\편집.subsync')
    await Promise.all([firstSave, secondSave])
    expect(api.saveProject).toHaveBeenCalledTimes(1)
  })

  it('names the default project after the video without its extension', async () => {
    api.openMedia.mockResolvedValue({ ...media, path: 'C:\\Videos\\동영상.mp4' })
    api.pickMedia.mockResolvedValue('C:\\Videos\\동영상.mp4')
    await useStore.getState().openMedia()
    await useStore.getState().saveProject(true)
    expect(api.saveProject).toHaveBeenLastCalledWith(expect.anything(), null, 'C:\\Videos\\동영상.subsync')
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
      return 'C:\\Projects\\편집.subsync'
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

  it('sends English cues to the agent, applies the answer by clip and saves it as the project Korean subtitle', async () => {
    await useStore.getState().openMedia()
    const english = { id: 'second', start: 7, end: 9, text: 'Notice that we use products.', words: [{ text: 'Notice', start: 7, end: 9 }] }
    useStore.setState({ clips: [...makeProject().clips, english], settings: { ...useStore.getState().settings, dictionary: 'rest full => RESTful\nKubernetes' } })
    let progressListener: ((event: { label: string; progress: number | null; translations: { id: number; text: string }[] }) => void) | undefined
    api.onTranslateProgress.mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    api.startAgentTranslate.mockImplementation(async () => {
      progressListener?.({ label: 'Agent 번역 중 · 1–3 / 2', progress: 0.5, translations: [] })
      expect(useStore.getState().job?.label).toBe('Agent 번역 중 · 1–3 / 2')
      return [{ id: 1, text: '안녕하세요, 여러분.' }, { id: 3, text: '저희는 products를 씁니다.' }]
    })
    api.saveSrt.mockImplementation(async (_content, path) => path)

    await useStore.getState().startAgentTranslate()

    // The first clip already shows Korean, so its recognised English words are sent instead; the empty clip is skipped.
    expect(api.startAgentTranslate).toHaveBeenCalledExactlyOnceWith({
      cues: [{ id: 1, text: 'Hello world.' }, { id: 3, text: 'Notice that we use products.' }],
      done: [],
      glossary: ['RESTful', 'Kubernetes']
    })
    const clips = useStore.getState().clips
    expect(clips.map((clip) => clip.text)).toEqual(['안녕하세요, 여러분.', '', '저희는 products를 씁니다.'])
    expect(clips[0].words).toEqual(makeProject().clips[0].words)
    const [content, path] = api.saveSrt.mock.calls[0]
    expect(path).toBe('C:\\Videos\\원본.ko.srt')
    expect(parseSrt(content).map((cue) => cue.text)).toEqual(['안녕하세요, 여러분.', '저희는 products를 씁니다.'])
    expect(useStore.getState().srtPath).toBe('C:\\Videos\\원본.ko.srt')
    expect(useStore.getState().message).toContain('원본.ko.srt')
    expect(useStore.getState().job).toBeNull()
    useStore.getState().undo()
    expect(useStore.getState().clips[2].text).toBe('Notice that we use products.')
  })

  it('asks before replacing an existing Korean subtitle file', async () => {
    api.listProjectSubtitles.mockResolvedValue([{ path: 'C:\\Videos\\원본.ko.srt', language: 'ko' }])
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    api.confirm.mockResolvedValue(false)

    await useStore.getState().startAgentTranslate()
    expect(api.confirm).toHaveBeenCalledOnce()
    expect(api.startAgentTranslate).not.toHaveBeenCalled()
    expect(useStore.getState().job).toBeNull()
  })

  it('keeps the cues finished before a failure and sends only the rest on the next run', async () => {
    await useStore.getState().openMedia()
    const clips = [1, 2, 3].map((n) => ({ id: `c${n}`, start: n, end: n + 0.5, text: `line ${n}`, words: [] }))
    useStore.setState({ clips })
    let progressListener: ((event: { label: string; progress: number | null; translations: { id: number; text: string }[] }) => void) | undefined
    api.onTranslateProgress.mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    api.startAgentTranslate.mockImplementationOnce(async () => {
      progressListener?.({ label: '', progress: 0.33, translations: [{ id: 1, text: '첫 줄' }] })
      throw new Error('2–3번 자막을 3번 시도했지만 번역하지 못했습니다')
    })

    await useStore.getState().startAgentTranslate()
    expect(useStore.getState().message).toContain('번역하지 못했습니다')
    expect(useStore.getState().message).toContain('1/3개')
    expect(useStore.getState().clips).toBe(clips)
    expect(api.saveSrt).not.toHaveBeenCalled()
    expect(useStore.getState().job).toBeNull()

    api.startAgentTranslate.mockResolvedValueOnce([{ id: 1, text: '첫 줄' }, { id: 2, text: '둘째 줄' }, { id: 3, text: '셋째 줄' }])
    api.saveSrt.mockResolvedValue('C:\\Videos\\원본.ko.srt')
    await useStore.getState().startAgentTranslate()
    expect(api.startAgentTranslate.mock.calls[1][0].done).toEqual([{ id: 1, text: '첫 줄' }])
    expect(useStore.getState().clips.map((clip) => clip.text)).toEqual(['첫 줄', '둘째 줄', '셋째 줄'])
  })

  it('reports agent errors and clears the job overlay', async () => {
    await useStore.getState().openMedia()
    useStore.setState({ clips: makeProject().clips })
    api.startAgentTranslate.mockRejectedValue(new Error('Antigravity CLI(agy)를 실행할 수 없습니다.'))

    await useStore.getState().startAgentTranslate()
    expect(useStore.getState().job).toBeNull()
    expect(useStore.getState().message).toContain('Antigravity CLI(agy)를 실행할 수 없습니다')
    expect(useStore.getState().message).not.toContain('이어서')
  })
})
