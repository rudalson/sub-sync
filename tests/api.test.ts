import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProject, media } from './fixtures/project'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), close: vi.fn(), events: new Map<string, (event: { payload: unknown }) => void>()
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, convertFileSrc: (token: string, scheme: string) => 'http://' + scheme + '.localhost/' + token }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.close }) }))
import { api, initializeNativeApi } from '../src/renderer/src/api'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {})
  mocks.events.clear()
  mocks.listen.mockImplementation(async (name, listener) => { mocks.events.set(name, listener); return vi.fn() })
  mocks.close.mockResolvedValue(vi.fn())
})

describe('Tauri frontend bridge', () => {
  it('registers event listeners before exposing the API to the editor', async () => {
    await initializeNativeApi()
    expect(window.api).toBe(api)
    const stt = vi.fn()
    const progress = vi.fn()
    const unStt = api.onSttEvent(stt)
    const unProgress = api.onProgress(progress)
    mocks.events.get('stt-event')!({ payload: { type: 'error', message: 'Missing Python' } })
    mocks.events.get('progress')!({ payload: 0.75 })
    expect(stt).toHaveBeenCalledWith({ type: 'error', message: 'Missing Python' })
    expect(progress).toHaveBeenCalledWith(0.75)
    unStt(); unProgress()
    mocks.events.get('progress')!({ payload: 1 })
    expect(progress).toHaveBeenCalledTimes(1)
  })
  it('converts video tokens to registered media URLs', async () => {
    mocks.invoke.mockResolvedValue({ ...media, url: 'opaque-token' })
    expect((await api.openMedia(media.path)).url).toBe('http://media.localhost/opaque-token')
    expect(mocks.invoke).toHaveBeenCalledWith('open_media', { path: media.path })
  })
  it('passes the download URL and target directory and forwards import progress', async () => {
    await initializeNativeApi()
    mocks.invoke.mockResolvedValueOnce('C:\\Downloads')
    expect(await api.pickImportDirectory(null)).toBe('C:\\Downloads')
    expect(mocks.invoke).toHaveBeenLastCalledWith('pick_import_directory', { initial: null })
    mocks.invoke.mockResolvedValueOnce('C:\\Downloads\\영상.mp4')
    expect(await api.importVideo('https://youtu.be/abc123', 'C:\\Downloads')).toBe('C:\\Downloads\\영상.mp4')
    expect(mocks.invoke).toHaveBeenLastCalledWith('import_video', { url: 'https://youtu.be/abc123', targetDir: 'C:\\Downloads' })
    const progress = vi.fn()
    const unsubscribe = api.onImportProgress(progress)
    const event = { label: '영상 다운로드 중', progress: 0.5 }
    mocks.events.get('import-progress')!({ payload: event })
    expect(progress).toHaveBeenCalledWith(event)
    unsubscribe()
    mocks.events.get('import-progress')!({ payload: event })
    expect(progress).toHaveBeenCalledOnce()
    await api.cancelImportVideo()
    expect(mocks.invoke).toHaveBeenLastCalledWith('cancel_import_video')
  })
  it('receives binary waveforms and supports the WebView JSON fallback', async () => {
    mocks.invoke.mockResolvedValueOnce(Uint8Array.from([0, 128, 255]).buffer).mockResolvedValueOnce([1, 2]).mockResolvedValueOnce(new ArrayBuffer(0))
    expect(await api.loadPeaks(media.path)).toEqual(Uint8Array.from([0, 128, 255]))
    expect(await api.loadPeaks(media.path)).toEqual(Uint8Array.from([1, 2]))
    expect(await api.loadPeaks(media.path)).toBeNull()
  })
  it('validates native project data and restores its media URL', async () => {
    mocks.invoke.mockResolvedValue({ path: 'work.subsync', project: makeProject(), media: { ...media, url: 'token' } })
    const opened = await api.pickProject()
    expect(opened?.project).toEqual(makeProject())
    expect(opened?.media.url).toBe('http://media.localhost/token')
    mocks.invoke.mockResolvedValue({ version: 99 })
    await expect(api.loadProject(media.path)).rejects.toThrow('버전')
  })
  it('sends save and job arguments using the names expected by Rust', async () => {
    const project = makeProject()
    await api.saveProject(project, null, 'work.subsync')
    expect(mocks.invoke).toHaveBeenLastCalledWith('save_project', { project, path: null, defaultPath: 'work.subsync' })
    await api.startStt(media.path, project.settings.stt, 'RESTful')
    expect(mocks.invoke).toHaveBeenLastCalledWith('start_stt', { mediaPath: media.path, options: project.settings.stt, hotwords: 'RESTful' })
    await api.cancelStt()
    expect(mocks.invoke).toHaveBeenLastCalledWith('cancel_stt')
  })
  it('discovers and directly reads companion subtitles through the native bridge', async () => {
    const projectPath = 'C:\\Projects\\편집.subsync'
    const path = 'C:\\Projects\\편집.ko.srt'
    const subtitles = [{ path, language: 'ko' }]
    mocks.invoke.mockResolvedValueOnce(subtitles)
    expect(await api.listProjectSubtitles(projectPath)).toEqual(subtitles)
    expect(mocks.invoke).toHaveBeenLastCalledWith('list_project_subtitles', { projectPath })
    const file = { path, content: '1\n00:00:01,000 --> 00:00:02,000\n안녕하세요' }
    mocks.invoke.mockResolvedValueOnce(file)
    expect(await api.readProjectSrt(projectPath, path)).toEqual(file)
    expect(mocks.invoke).toHaveBeenLastCalledWith('read_project_srt', { projectPath, path })
  })
  it('defers native window destruction to the editor autosave handler', async () => {
    await initializeNativeApi()
    const close = vi.fn()
    const unsubscribe = api.onCloseRequested(close)
    const event = { preventDefault: vi.fn() }
    mocks.close.mock.calls[0][0](event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalledWith('close_window')
    await api.closeWindow()
    expect(mocks.invoke).toHaveBeenLastCalledWith('close_window')
    unsubscribe()
  })
  it('requests real sentence boundaries through the registered native command', async () => {
    mocks.invoke.mockResolvedValue([5, 8])
    const words = 'The U.S. Army is here. We should leave.'.split(' ')
    expect(await api.sentenceBoundaries(words)).toEqual([5, 8])
    expect(mocks.invoke).toHaveBeenLastCalledWith('sentence_boundaries', { words })
    mocks.invoke.mockRejectedValue(new Error('pySBD is missing'))
    await expect(api.sentenceBoundaries(words)).rejects.toThrow('pySBD')
  })
  it('allows the window to close if the editor did not finish starting', async () => {
    await initializeNativeApi()
    const event = { preventDefault: vi.fn() }
    mocks.close.mock.calls[0][0](event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
