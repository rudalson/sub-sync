import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { projectMediaSize } from '../shared/project'
import type { ExportRequest, MediaInfo, OpenedProject, ProjectFile, SavedProject, Settings, SrtFile, SttEvent, SttOptions } from '../shared/types'
import { extractPeaks, probe, runFfmpeg, type Probe } from './ffmpeg'
import { autosavePath, findProjectMedia, readProject, validateProjectMedia, writeProject } from './projects'

const VIDEO_FILTERS = [
  { name: '영상', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'wmv', 'ts', 'flv'] },
  { name: '모든 파일', extensions: ['*'] }
]
const SRT_FILTERS = [{ name: 'SRT 자막', extensions: ['srt'] }]
const PROJECT_FILTERS = [{ name: 'Sub Sync 프로젝트', extensions: ['subsync.json'] }]
const PLAYABLE_CONTAINERS = ['mp4', 'webm']
const PLAYABLE_VIDEO = ['h264', 'vp8', 'vp9', 'av1']
const PLAYABLE_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac']

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

let window: BrowserWindow | null = null
let sttProcess: ChildProcessWithoutNullStreams | null = null
let exportAbort: AbortController | null = null
let allowClose = false
const servedFiles = new Set<string>()

const cachePath = (folder: string, name: string) => join(app.getPath('userData'), folder, name)

async function cacheKey(path: string): Promise<string> {
  const info = await stat(path)
  return createHash('sha1').update(`${path}|${info.size}|${info.mtimeMs}`).digest('hex')
}

function sendProgress(fraction: number) {
  window?.webContents.send('progress', fraction)
}

function decodeSubtitle(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer)
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('euc-kr').decode(buffer)
  }
}

/** Chromium cannot play every container or codec, so anything else gets a cached mp4 stand-in. */
async function playablePath(path: string, info: Probe): Promise<string> {
  const containerOk = PLAYABLE_CONTAINERS.some((name) => info.container.includes(name))
  const videoOk = info.videoCodec !== null && PLAYABLE_VIDEO.includes(info.videoCodec)
  const audioOk = info.audioCodec === null || PLAYABLE_AUDIO.includes(info.audioCodec)
  if (containerOk && videoOk && audioOk) return path

  const proxy = cachePath('proxy', `${await cacheKey(path)}.mp4`)
  if (existsSync(proxy)) return proxy
  await mkdir(cachePath('proxy', ''), { recursive: true })
  const video = videoOk ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-vf', "scale=-2:'min(720,ih)'"]
  const partial = `${proxy}.part.mp4`
  await runFfmpeg(['-i', path, ...video, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', partial], {
    duration: info.duration,
    onProgress: sendProgress
  })
  await rename(partial, proxy)
  return proxy
}

async function openMedia(path: string): Promise<MediaInfo> {
  const info = await probe(path)
  const playable = await playablePath(path, info)
  servedFiles.add(playable)
  return {
    path,
    url: `media://local/file?path=${encodeURIComponent(playable)}`,
    size: (await stat(path)).size,
    duration: info.duration,
    width: info.width,
    height: info.height,
    hasAudio: info.audioCodec !== null
  }
}

async function loadPeaks(path: string): Promise<Uint8Array | null> {
  const cached = cachePath('peaks', `${await cacheKey(path)}.bin`)
  if (existsSync(cached)) return readFile(cached)
  const peaks = await extractPeaks(path).catch(() => null)
  if (peaks) {
    await mkdir(cachePath('peaks', ''), { recursive: true })
    await writeFile(cached, peaks)
  }
  return peaks
}

const MIME: Record<string, string> = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4' }

async function serveMedia(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get('path') ?? ''
  if (!servedFiles.has(path)) return new Response('Not found', { status: 404 })

  const { size } = await stat(path)
  const headers = { 'Content-Type': MIME[extname(path).toLowerCase()] ?? 'video/mp4', 'Accept-Ranges': 'bytes' }
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
  if (!range) {
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(body, { headers: { ...headers, 'Content-Length': String(size) } })
  }
  const start = range[1] ? Number(range[1]) : 0
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return new Response(body, {
    status: 206,
    headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` }
  })
}

function pythonPath(): string {
  const venv = join(app.getAppPath(), 'backend', '.venv')
  return join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
}

function startStt(mediaPath: string, options: SttOptions, hotwords: string) {
  const send = (event: SttEvent) => window?.webContents.send('stt-event', event)
  const python = pythonPath()
  if (!existsSync(python)) {
    send({ type: 'error', message: 'Python 환경이 없습니다. 터미널에서 npm run setup:backend 를 먼저 실행해 주세요.' })
    return
  }

  const script = join(app.getAppPath(), 'backend', 'transcribe.py')
  const args = ['-u', script, mediaPath, '--model', options.model, '--language', options.language, '--device', options.device]
  if (hotwords) args.push('--hotwords', hotwords)
  const child = spawn(python, args, {
    env: { ...process.env, PYTHONUTF8: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
    windowsHide: true
  })
  sttProcess = child

  let finished = false
  let errors = ''
  child.stderr.on('data', (chunk) => (errors = (errors + chunk).slice(-1500)))
  createInterface({ input: child.stdout }).on('line', (line) => {
    const event = JSON.parse(line) as SttEvent
    if (event.type === 'done' || event.type === 'error') finished = true
    send(event)
  })
  child.on('close', (code) => {
    const cancelled = sttProcess !== child
    if (!cancelled) sttProcess = null
    if (!finished && !cancelled) send({ type: 'error', message: errors.trim() || `음성 인식이 종료됐습니다 (코드 ${code})` })
  })
}

async function exportVideo(request: ExportRequest) {
  const abort = new AbortController()
  exportAbort = abort
  const folder = await mkdtemp(join(tmpdir(), 'sub-sync-'))
  await writeFile(join(folder, 'subs.ass'), request.ass, 'utf8')

  const encode = (video: string[]) =>
    runFfmpeg(
      ['-i', request.mediaPath, '-vf', 'ass=subs.ass', ...video, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', request.outputPath],
      { cwd: folder, duration: request.duration, signal: abort.signal, onProgress: sendProgress }
    )
  try {
    await encode(['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '21', '-pix_fmt', 'yuv420p']).catch((error) => {
      if (abort.signal.aborted) throw error
      return encode(['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p'])
    })
  } catch (error) {
    await rm(request.outputPath, { force: true })
    throw abort.signal.aborted ? new Error('내보내기를 취소했습니다.') : error
  } finally {
    exportAbort = null
    await rm(folder, { recursive: true, force: true })
  }
}

function registerIpc() {
  ipcMain.handle('pick-media', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: VIDEO_FILTERS })
    return result.filePaths[0] ?? null
  })
  ipcMain.handle('open-media', (_, path: string) => openMedia(path))
  ipcMain.handle('load-peaks', (_, path: string) => loadPeaks(path))

  ipcMain.handle('pick-srt', async (): Promise<SrtFile | null> => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: SRT_FILTERS })
    const path = result.filePaths[0]
    return path ? { path, content: decodeSubtitle(await readFile(path)) } : null
  })
  ipcMain.handle('save-srt', async (_, content: string, path: string | null, defaultPath: string) => {
    const target = path ?? (await dialog.showSaveDialog(window!, { defaultPath, filters: SRT_FILTERS })).filePath
    if (!target) return null
    await writeFile(target, content, 'utf8')
    return target
  })
  ipcMain.handle('pick-export-path', async (_, defaultPath: string) => {
    const result = await dialog.showSaveDialog(window!, { defaultPath, filters: [{ name: 'MP4', extensions: ['mp4'] }] })
    return result.filePath || null
  })
  ipcMain.handle('confirm', async (_, message: string, detail?: string) => {
    const { response } = await dialog.showMessageBox(window!, {
      type: 'question',
      buttons: ['계속', '취소'],
      defaultId: 1,
      cancelId: 1,
      message,
      detail
    })
    return response === 0
  })

  ipcMain.handle('load-project', async (_, mediaPath: string): Promise<SavedProject | null> => {
    const path = autosavePath(mediaPath)
    if (!existsSync(path)) return null
    const project = await readProject(path)
    if (projectMediaSize(project) !== (await stat(mediaPath)).size) {
      throw new Error('자동 저장된 프로젝트와 영상의 크기가 다릅니다. 원본 영상을 확인해 주세요.')
    }
    return project
  })
  ipcMain.handle('pick-project', async (): Promise<OpenedProject | null> => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: PROJECT_FILTERS })
    const path = result.filePaths[0]
    if (!path) return null
    const project = await readProject(path)
    let mediaPath = await findProjectMedia(path, project)
    if (!mediaPath) {
      const relink = await dialog.showOpenDialog(window!, {
        title: '원본 영상을 찾을 수 없습니다. 프로젝트에 사용할 영상을 다시 연결해 주세요.',
        defaultPath: project.version === 2 ? project.media.path : undefined,
        properties: ['openFile'],
        filters: VIDEO_FILTERS
      })
      mediaPath = relink.filePaths[0] ?? null
      if (!mediaPath) return null
    }
    if ((await stat(mediaPath)).size !== projectMediaSize(project)) {
      throw new Error('저장된 프로젝트와 영상의 크기가 다릅니다. 원본 영상을 선택해 주세요.')
    }
    const media = await openMedia(mediaPath)
    validateProjectMedia(project, media)
    return { path, project, media }
  })
  ipcMain.handle('save-project', async (_, project: ProjectFile, path: string | null, defaultPath: string) => {
    const target = path ?? (await dialog.showSaveDialog(window!, { defaultPath, filters: PROJECT_FILTERS })).filePath
    if (!target) return null
    if (target.toLowerCase() === project.media.path.toLowerCase()) throw new Error('프로젝트를 원본 영상과 같은 경로에 저장할 수 없습니다.')
    await writeProject(target, project)
    return target
  })
  ipcMain.handle('autosave-project', (_, mediaPath: string, project: ProjectFile) =>
    writeProject(autosavePath(mediaPath), project)
  )
  ipcMain.handle('close-window', () => {
    allowClose = true
    window?.close()
  })

  const settingsPath = () => join(app.getPath('userData'), 'settings.json')
  ipcMain.handle('load-settings', async () => (existsSync(settingsPath()) ? JSON.parse(await readFile(settingsPath(), 'utf8')) : {}))
  ipcMain.handle('save-settings', (_, settings: Settings) => writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8'))

  ipcMain.handle('start-stt', (_, mediaPath: string, options: SttOptions, hotwords: string) => startStt(mediaPath, options, hotwords))
  ipcMain.handle('cancel-stt', () => {
    const child = sttProcess
    sttProcess = null
    child?.kill()
  })
  ipcMain.handle('start-export', (_, request: ExportRequest) => exportVideo(request))
  ipcMain.handle('cancel-export', () => exportAbort?.abort())
}

function createWindow() {
  window = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    title: 'Sub Sync',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
  window.on('close', (event) => {
    if (allowClose || !window?.webContents.getURL()) return
    event.preventDefault()
    window.webContents.send('close-requested')
  })
  window.webContents.on('render-process-gone', () => { allowClose = true })
  window.on('closed', () => (window = null))
}

app.whenReady().then(() => {
  protocol.handle('media', serveMedia)
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  sttProcess?.kill()
  exportAbort?.abort()
  app.quit()
})
