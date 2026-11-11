import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { serializeProject } from '../shared/project'
import { validateSentenceEnds } from '../shared/sentenceBoundary'
import type { MediaInfo, ProjectFile, Settings, SttEvent, SttOptions, Word } from '../shared/types'

/**
 * Process and file access for the command line. It follows the same lookup rules as the desktop
 * app's Rust backend, so both find the same Whisper environment, settings and tools.
 */

const APP_IDENTIFIER = 'dev.subsync.editor'

export type SourceMedia = Omit<MediaInfo, 'url'>

export interface SttResult {
  words: Word[]
  device: string
}

export interface Runtime {
  loadSettings(): Partial<Settings>
  probe(path: string): Promise<SourceMedia>
  transcribe(media: string, options: SttOptions, hotwords: string, onEvent: (event: SttEvent) => void, signal: AbortSignal): Promise<SttResult>
  sentenceBoundaries(words: string[], signal: AbortSignal): Promise<number[]>
}

/** Tauri's app data folder for this identifier (roaming AppData on Windows). */
export function appDataDir(): string {
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_IDENTIFIER)
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', APP_IDENTIFIER)
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), APP_IDENTIFIER)
}

function configDir(): string {
  if (process.platform === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
}

const tool = (name: string) => process.env[`SUB_SYNC_${name.toUpperCase()}`] ?? name

/** Keeps only the end of a stream, where Python and ffmpeg print the actual error. */
function tail(text: string, limit = 8192): string {
  return text.length > limit ? text.slice(-limit) : text
}

const cancelled = () => new Error('작업을 취소했습니다.')

export function createRuntime(root: string): Runtime {
  const dataDir = appDataDir()
  const venvPython = process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python')

  function python(): string {
    if (process.env.SUB_SYNC_PYTHON) return process.env.SUB_SYNC_PYTHON
    const found = [join(root, 'backend', '.venv', venvPython), join(dataDir, 'backend', '.venv', venvPython)].find((path) => existsSync(path))
    if (!found) throw new Error('Whisper Python 환경이 없습니다. npm run setup:backend를 실행하거나 SUB_SYNC_PYTHON으로 기존 Python 환경을 지정해 주세요.')
    return found
  }

  function script(name: string): string {
    const path = join(root, 'backend', name)
    if (!existsSync(path)) throw new Error(`백엔드 스크립트를 찾을 수 없습니다: ${path}`)
    return path
  }

  const pythonEnv = { ...process.env, PYTHONUTF8: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' }

  return {
    loadSettings() {
      const path = [join(dataDir, 'settings.json'), join(configDir(), 'sub-sync', 'settings.json')].find((candidate) => existsSync(candidate))
      if (!path) return {}
      try {
        return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as Partial<Settings>
      } catch (error) {
        throw new Error(`앱 설정 파일을 읽을 수 없습니다 (${path}): ${(error as Error).message}`)
      }
    },

    probe(path) {
      const absolute = resolve(path)
      return new Promise((resolvePromise, reject) => {
        execFile(tool('ffprobe'), ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', absolute],
          { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
              const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
              reject(new Error(missing ? 'ffprobe를 실행할 수 없습니다. ffmpeg 설치 및 PATH를 확인해 주세요.' : stderr.trim() || error.message))
              return
            }
            try {
              const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> }
              const streams = info.streams ?? []
              const video = streams.find((stream) => stream.codec_type === 'video')
              if (!video) throw new Error('영상 트랙이 없는 파일입니다.')
              resolvePromise({
                path: absolute,
                size: statSync(absolute).size,
                duration: Number.parseFloat(info.format?.duration ?? '') || 0,
                width: video.width ?? 1280,
                height: video.height ?? 720,
                hasAudio: streams.some((stream) => stream.codec_type === 'audio')
              })
            } catch (parseError) {
              reject(parseError)
            }
          })
      })
    },

    transcribe(media, options, hotwords, onEvent, signal) {
      if (!['auto', 'cuda', 'cpu'].includes(options.device)) return Promise.reject(new Error('잘못된 STT 장치입니다.'))
      const args = ['-u', script('transcribe.py'), media, '--model', options.model, '--language', options.language, '--device', options.device]
      if (hotwords) args.push('--hotwords', hotwords)
      const child = spawn(python(), args, { env: pythonEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      return new Promise((resolvePromise, reject) => {
        const words: Word[] = []
        let stderr = ''
        let settled = false
        const settle = (action: () => void) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', abort)
          action()
        }
        const abort = () => {
          child.kill()
          settle(() => reject(cancelled()))
        }
        signal.addEventListener('abort', abort)
        if (signal.aborted) abort()
        child.on('error', (error) => settle(() => reject(new Error(`음성 인식을 실행할 수 없습니다: ${error.message}`))))
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = tail(stderr + chunk) })
        createInterface({ input: child.stdout }).on('line', (line) => {
          let event: SttEvent
          try {
            event = JSON.parse(line) as SttEvent
          } catch {
            return
          }
          if (event.type === 'segment') words.push(...event.words)
          else if (event.type === 'reset') words.length = 0
          onEvent(event)
          if (event.type === 'done') settle(() => resolvePromise({ words, device: event.device }))
          else if (event.type === 'error') settle(() => reject(new Error(event.message)))
        })
        child.on('close', (code) => settle(() => reject(new Error(stderr.trim() || `음성 인식이 종료됐습니다: 종료 코드 ${code}`))))
      })
    },

    sentenceBoundaries(words, signal) {
      if (words.length === 0) return Promise.resolve([])
      const child = spawn(python(), ['-u', script('sentence_boundary.py')], { env: pythonEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      return new Promise((resolvePromise, reject) => {
        let stdout = ''
        let stderr = ''
        const abort = () => {
          child.kill()
          reject(cancelled())
        }
        signal.addEventListener('abort', abort, { once: true })
        child.on('error', (error) => reject(new Error(`문장 분석기를 실행할 수 없습니다: ${error.message}`)))
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = tail(stderr + chunk) })
        child.stdin.on('error', () => {})
        child.stdin.end(JSON.stringify(words))
        child.on('close', (code) => {
          signal.removeEventListener('abort', abort)
          if (code !== 0) {
            reject(new Error(stderr.trim() || '문장 분석에 실패했습니다.'))
            return
          }
          try {
            const ends = JSON.parse(stdout) as number[]
            validateSentenceEnds(words.length, ends)
            resolvePromise(ends)
          } catch (error) {
            reject(new Error(`문장 분석 결과 형식이 잘못되었습니다: ${(error as Error).message}`))
          }
        })
      })
    }
  }
}

/** Reads subtitles the way the desktop app does: UTF-16 with a BOM, UTF-8, then CP949 for older Korean files. */
export function decodeSubtitle(bytes: Uint8Array): string {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    if (bytes.length % 2 !== 0) throw new Error('UTF-16 자막 파일이 손상되었습니다.')
    return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(bytes)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    try {
      // WHATWG "euc-kr" is Windows code page 949, the extended Korean encoding.
      return new TextDecoder('euc-kr', { fatal: true }).decode(bytes)
    } catch {
      throw new Error('자막 인코딩을 읽을 수 없습니다.')
    }
  }
}

/** Replaces the target only after the new content is fully written, like the desktop app. */
export function atomicWrite(target: string, content: string): void {
  const stage = join(dirname(target), `.${parse(target).base}.${process.pid}.tmp`)
  try {
    writeFileSync(stage, content, 'utf8')
    renameSync(stage, target)
  } catch (error) {
    rmSync(stage, { force: true })
    throw error
  }
}

export function samePath(a: string, b: string): boolean {
  const normalize = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))
  return normalize(a) === normalize(b)
}

/**
 * Writes a project the desktop app can open: validated, never over the video itself, and with the
 * video's path relative to the project so a moved folder still finds it.
 */
export function writeProject(target: string, project: ProjectFile): void {
  if (samePath(project.media.path, target)) throw new Error('원본 영상과 같은 경로에는 저장할 수 없습니다.')
  const folder = dirname(resolve(target))
  const sameRoot = parse(folder).root.toLowerCase() === parse(resolve(project.media.path)).root.toLowerCase()
  const { relativePath: _old, ...media } = project.media
  const saved: ProjectFile = { ...project, media: sameRoot ? { ...media, relativePath: relative(folder, project.media.path) } : media }
  atomicWrite(target, serializeProject(saved))
}
