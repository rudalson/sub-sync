import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIT, runCli } from '../src/cli/commands'
import { decodeSubtitle, type Runtime } from '../src/cli/runtime'
import { buildProject, clipsFromTranscript, groupSentences, mergeSettings, overlaySrt } from '../src/shared/pipeline'
import { parseProject } from '../src/shared/project'
import { parseSrt } from '../src/shared/srt'
import type { ProjectFile, SttEvent, Word } from '../src/shared/types'

const words: Word[] = [
  { text: 'Welcome', start: 0, end: 0.5 }, { text: 'to', start: 0.5, end: 0.7 }, { text: 'rest', start: 0.7, end: 0.9 },
  { text: 'full.', start: 0.9, end: 1.4 }, { text: 'Today', start: 2.5, end: 2.9 }, { text: 'we', start: 2.9, end: 3.1 },
  { text: 'model', start: 3.1, end: 3.5 }, { text: 'resources.', start: 3.5, end: 4.2 }
]

const KOREAN_SRT = '1\n00:00:00,000 --> 00:00:02,000\n환영합니다.\n\n2\n00:00:02,400 --> 00:00:04,500\n오늘은 리소스를 모델링합니다.\n'

let folder: string
let video: string
let runtime: { [K in keyof Runtime]: ReturnType<typeof vi.fn> & Runtime[K] }
let stdout: string
let stderr: string

function run(...argv: string[]) {
  const controller = new AbortController()
  return runCli(argv, {
    runtime,
    stdout: { write: (text: string) => { stdout += text } },
    stderr: { write: (text: string) => { stderr += text } },
    signal: controller.signal
  })
}

const readJson = (path: string) => parseProject(readFileSync(path, 'utf8')) as ProjectFile

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'sub-sync-cli-'))
  video = join(folder, 'lecture.mp4')
  writeFileSync(video, 'video bytes')
  stdout = ''
  stderr = ''
  runtime = {
    loadSettings: vi.fn(() => ({ dictionary: '' })),
    probe: vi.fn(async (path: string) => ({ path, size: 11, duration: 5, width: 1280, height: 720, hasAudio: true })),
    transcribe: vi.fn(async (_media: string, _options: unknown, _hotwords: string, onEvent: (event: SttEvent) => void) => {
      onEvent({ type: 'status', message: '음성 인식 중', device: 'cuda' })
      onEvent({ type: 'progress', seconds: 2.5, duration: 5 })
      return { words, device: 'cuda' }
    }),
    sentenceBoundaries: vi.fn(async () => [4, 8])
  } as never
})

afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe('shared editing pipeline', () => {
  it('cuts recognised words into clips and applies the dictionary to text and anchors', () => {
    const settings = mergeSettings({ dictionary: 'rest full => RESTful' })
    const clips = clipsFromTranscript(words, [], settings)
    expect(clips.map((clip) => clip.text)).toEqual(['Welcome to RESTful.', 'Today we model resources.'])
    expect(clips.flatMap((clip) => clip.words)).toHaveLength(8)
  })

  it('turns subtitles loaded before recognition into anchors instead of discarding them', () => {
    const subtitles = overlaySrt([], KOREAN_SRT).clips
    const clips = clipsFromTranscript(words, subtitles, mergeSettings())
    expect(clips.map((clip) => clip.text)).toEqual(['환영합니다.', '오늘은 리소스를 모델링합니다.'])
    expect(clips.map((clip) => clip.words.length)).toEqual([4, 4])
  })

  it('rejects an SRT without cues and keeps every word when overlaying one', () => {
    const clips = clipsFromTranscript(words, [], mergeSettings())
    expect(() => overlaySrt(clips, 'not a subtitle')).toThrow('SRT에서 자막을 찾지 못했습니다.')
    expect(overlaySrt(clips, KOREAN_SRT).clips.flatMap((clip) => clip.words)).toEqual(clips.flatMap((clip) => clip.words))
  })

  it('regroups by sentence and fills saved settings field by field', () => {
    const clips = clipsFromTranscript(words, [], mergeSettings({ segment: { maxChars: 10 } as never }))
    expect(clips.length).toBeGreaterThan(2)
    expect(groupSentences(clips, [4, 8]).clips.map((clip) => clip.text)).toEqual(['Welcome to rest full.', 'Today we model resources.'])
    expect(mergeSettings({ segment: { maxChars: 10 } as never }).segment.maxDuration).toBe(8)
  })

  it('never saves the playback URL', () => {
    const project = buildProject({
      media: { path: video, url: 'token', size: 1, duration: 5, width: 1, height: 1, hasAudio: true },
      clips: [], settings: mergeSettings(), peaks: Uint8Array.from([1, 2]), playback: { time: 0, rate: 1, follow: true }, srtPath: null
    })
    expect(project.media).not.toHaveProperty('url')
    expect(project.waveform).toEqual({ samplesPerSecond: 100, peaks: [1, 2] })
  })
})

describe('command line', () => {
  it('transcribes into a project the desktop app restores, with an SRT and dictionary file', async () => {
    writeFileSync(join(folder, 'dict.txt'), 'rest full => RESTful\n')
    const code = await run('transcribe', video, '-o', join(folder, 'en.srt'), '--dict', join(folder, 'dict.txt'), '--device', 'cpu', '--max-chars', '40')
    expect(code, stderr).toBe(EXIT.ok)
    expect(runtime.transcribe.mock.calls[0][1]).toEqual({ model: 'large-v3-turbo', language: 'en', device: 'cpu' })
    expect(runtime.transcribe.mock.calls[0][2]).toBe('RESTful')

    const project = readJson(join(folder, 'lecture.subsync'))
    expect(project.media).toMatchObject({ path: video, relativePath: 'lecture.mp4', size: 11 })
    expect(project.settings.segment.maxChars).toBe(40)
    expect(project.srtPath).toBe(join(folder, 'en.srt'))
    expect(project.waveform).toBeNull()
    expect(parseSrt(readFileSync(join(folder, 'en.srt'), 'utf8'))[0].text).toBe('Welcome to RESTful.')
    expect(stdout).toContain('자막 2개 생성 완료 (GPU)')
  })

  it('refuses to replace an existing project before running recognition unless forced', async () => {
    writeFileSync(join(folder, 'lecture.subsync'), '{}')
    expect(await run('transcribe', video)).toBe(EXIT.error)
    expect(stderr).toContain('--force')
    expect(runtime.transcribe).not.toHaveBeenCalled()
    expect(await run('transcribe', video, '--force')).toBe(EXIT.ok)
  })

  it('overlays a CP949 Korean SRT in place while the English word anchors stay', async () => {
    await run('transcribe', video)
    const project = join(folder, 'lecture.subsync')
    writeFileSync(join(folder, 'ko.srt'), Buffer.concat([
      Buffer.from('1\r\n00:00:00,000 --> 00:00:02,000\r\n'), Buffer.from([0xb0, 0xa1]), Buffer.from('\r\n')
    ]))
    expect(await run('overlay', project, '--srt', join(folder, 'ko.srt'))).toBe(EXIT.ok)
    const saved = readJson(project)
    expect(saved.clips.map((clip) => clip.text)).toEqual(['가'])
    expect(saved.clips[0].words).toHaveLength(8)
    expect(saved.srtPath).toBe(join(folder, 'ko.srt'))
  })

  it('groups sentences with pySBD boundaries and passes the edit preservation choice', async () => {
    await run('transcribe', video, '--max-chars', '10')
    const project = join(folder, 'lecture.subsync')
    expect(await run('sentences', project, '--no-preserve-edits', '-p', join(folder, 'sentences.subsync'))).toBe(EXIT.ok)
    expect(runtime.sentenceBoundaries.mock.calls[0][0]).toHaveLength(8)
    expect(readJson(join(folder, 'sentences.subsync')).clips.map((clip) => clip.text)).toEqual(['Welcome to rest full.', 'Today we model resources.'])
  })

  it('saves SRT next to the video by default and reports JSON results', async () => {
    await run('transcribe', video)
    stdout = ''
    expect(await run('srt', join(folder, 'lecture.subsync'), '--json')).toBe(EXIT.ok)
    expect(JSON.parse(stdout.trim())).toMatchObject({ type: 'result', command: 'srt', clips: 2, srt: join(folder, 'lecture.srt') })
    expect(readFileSync(join(folder, 'lecture.srt'), 'utf8')).toContain('Today we model resources.')
  })

  it('reads only .subsync projects and always saves projects with that extension', async () => {
    await run('transcribe', video, '-p', join(folder, 'work.json'))
    expect(readJson(join(folder, 'work.json.subsync')).clips).toHaveLength(2)
    writeFileSync(join(folder, 'old.subsync.json'), readFileSync(join(folder, 'work.json.subsync')))
    expect(await run('srt', join(folder, 'old.subsync.json'))).toBe(EXIT.error)
    expect(stderr).toContain('.subsync) 파일만 열 수 있습니다')
  })

  it('reports usage errors with exit code 2 and never writes over the video', async () => {
    expect(await run('transcribe', video, '--device', 'tpu')).toBe(EXIT.usage)
    expect(await run('transcribe', video, '--max-chars', '1.5')).toBe(EXIT.usage)
    expect(await run('overlay', join(folder, 'lecture.subsync'))).toBe(EXIT.usage)
    expect(await run('unknown')).toBe(EXIT.usage)
    expect(await run('transcribe', video, '-o', video, '--force')).toBe(EXIT.error)
    expect(stderr).toContain('원본 영상과 같은 경로')
    expect(readFileSync(video, 'utf8')).toBe('video bytes')
  })

  it('returns the cancelled exit code when recognition is interrupted', async () => {
    const controller = new AbortController()
    runtime.transcribe.mockImplementation(async () => {
      controller.abort()
      throw new Error('작업을 취소했습니다.')
    })
    const code = await runCli(['transcribe', video], {
      runtime, stdout: { write: () => {} }, stderr: { write: (text: string) => { stderr += text } }, signal: controller.signal
    })
    expect(code).toBe(EXIT.cancelled)
    expect(stderr).toContain('취소')
  })
})

describe('subtitle decoding', () => {
  it('reads UTF-8 with a BOM, UTF-16 and CP949', () => {
    expect(decodeSubtitle(Buffer.from('﻿자막'))).toBe('자막')
    expect(decodeSubtitle(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('자막', 'utf16le')]))).toBe('자막')
    expect(decodeSubtitle(Buffer.from([0xb0, 0xa1]))).toBe('가')
  })
})
