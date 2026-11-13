import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { parseDictionary } from '../shared/edits'
import {
  allWords, buildProject, clipsFromTranscript, defaultProjectPath, groupSentences, isProjectPath, mergeSettings, overlaySrt, stripExtension,
  withProjectExtension
} from '../shared/pipeline'
import { parseProject } from '../shared/project'
import { serializeSrt } from '../shared/srt'
import type { Clip, ProjectFile, SttEvent, SttOptions } from '../shared/types'
import { atomicWrite, decodeSubtitle, samePath, writeProject, type Runtime } from './runtime'

export interface CliIo {
  runtime: Runtime
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown; isTTY?: boolean }
  signal: AbortSignal
}

class UsageError extends Error {}

export const EXIT = { ok: 0, error: 1, usage: 2, cancelled: 130 } as const

const USAGE = `Sub Sync CLI: 로컬 Whisper 자막 싱크 편집기의 명령줄 도구

사용법: sub-sync <명령> [옵션]

명령:
  transcribe <영상>     음성 인식으로 영어 자막과 단어 위치를 만들어 프로젝트로 저장합니다.
  overlay <프로젝트>    SRT(예: 한글 번역)를 덮어씁니다. 인식된 영어 단어 위치는 그대로 둡니다.
  sentences <프로젝트>  pySBD로 영어 원문 문장 단위로 자막을 다시 묶습니다.
  srt <프로젝트>        프로젝트를 SRT 파일로 저장합니다.

공통 옵션:
  -p, --project <경로>  저장할 프로젝트 경로 (.subsync가 없으면 붙여서 저장)
  -o, --output <경로>   함께 저장할 SRT 경로
      --force           이미 있는 파일을 덮어씁니다.
      --json            진행 상황과 결과를 한 줄에 하나씩 JSON으로 출력합니다.
  -q, --quiet           진행 상황을 출력하지 않습니다.
  -h, --help            도움말을 봅니다. (예: sub-sync transcribe --help)

프로젝트 파일은 데스크톱 앱에서 그대로 열어 이어서 편집할 수 있습니다.`

const HELP: Record<string, string> = {
  transcribe: `사용법: sub-sync transcribe <영상> [옵션]

영상을 음성 인식해 프로젝트를 만듭니다. 기본 저장 위치는 영상 옆의 <영상 이름>.subsync이며,
데스크톱 앱에서 그 영상을 열면 자동으로 복원됩니다. 모델·자막 길이·사전 기본값은 앱 설정을 따릅니다.

옵션:
  -p, --project <경로>       프로젝트 경로 (기본: <영상 이름>.subsync)
  -o, --output <경로>        SRT도 함께 저장
      --model <이름>         Whisper 모델 (예: large-v3, large-v3-turbo)
      --language <코드>      인식 언어 (예: en)
      --device <장치>        auto | cuda | cpu
      --dict <파일>          오인식 사전 파일 (한 줄에 하나: 용어 또는 잘못된말 => 바른말)
      --max-chars <수>       자막 하나의 최대 글자 수
      --max-duration <초>    자막 하나의 최대 길이
      --force                이미 있는 프로젝트나 SRT를 덮어씁니다.`,
  overlay: `사용법: sub-sync overlay <프로젝트> --srt <자막.srt> [옵션]

SRT의 자막 내용과 시간으로 바꿉니다. 인식된 영어 단어는 말한 위치의 자막에 그대로 남습니다.
UTF-8, UTF-16, CP949(EUC-KR) 자막을 읽습니다.

옵션:
      --srt <경로>           덮어쓸 SRT (필수)
  -p, --project <경로>       결과 프로젝트 경로 (기본: 입력 프로젝트를 고쳐 씀)
  -o, --output <경로>        결과 SRT도 함께 저장
      --force                이미 있는 다른 파일을 덮어씁니다.`,
  sentences: `사용법: sub-sync sentences <프로젝트> [옵션]

pySBD로 영어 원문의 문장 경계를 찾아 자막을 문장 단위로 다시 묶습니다. 단어와 시간 정보는 그대로입니다.

옵션:
  -p, --project <경로>         결과 프로젝트 경로 (기본: 입력 프로젝트를 고쳐 씀)
  -o, --output <경로>          결과 SRT도 함께 저장
      --no-preserve-edits      수정한 자막 내용을 지키지 않고 영어 원문으로 다시 묶습니다.
      --pause-threshold <초>   이보다 긴 침묵이 있는 문장을 확인 필요로 표시 (기본 2)
      --duration-threshold <초> 이보다 긴 문장을 확인 필요로 표시 (기본 15)
      --force                  이미 있는 다른 파일을 덮어씁니다.`,
  srt: `사용법: sub-sync srt <프로젝트> [옵션]

프로젝트를 SRT로 저장합니다. 앱과 똑같이 1초 이하의 자막 사이 빈틈은 이어 붙입니다.

옵션:
  -o, --output <경로>        SRT 경로 (기본: <영상 이름>.srt)
      --force                이미 있는 SRT를 덮어씁니다.`
}

const COMMON = {
  help: { type: 'boolean', short: 'h' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  force: { type: 'boolean' },
  output: { type: 'string', short: 'o' }
} as const satisfies ParseArgsConfig['options']

const PROJECT = { project: { type: 'string', short: 'p' } } as const satisfies ParseArgsConfig['options']

const OPTIONS = {
  transcribe: {
    ...COMMON, ...PROJECT,
    model: { type: 'string' }, language: { type: 'string' }, device: { type: 'string' }, dict: { type: 'string' },
    'max-chars': { type: 'string' }, 'max-duration': { type: 'string' }
  },
  overlay: { ...COMMON, ...PROJECT, srt: { type: 'string' } },
  sentences: {
    ...COMMON, ...PROJECT,
    'preserve-edits': { type: 'boolean', default: true }, 'pause-threshold': { type: 'string' }, 'duration-threshold': { type: 'string' }
  },
  srt: { ...COMMON }
} as const satisfies Record<string, ParseArgsConfig['options']>

type Command = keyof typeof OPTIONS

function positiveNumber(value: string | undefined, name: string, integer = false): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) {
    throw new UsageError(`--${name}에는 0보다 큰 ${integer ? '정수' : '숫자'}를 넣어 주세요: ${value}`)
  }
  return number
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Progress goes to stderr (or JSON lines on stdout) so stdout stays clean for the final result. */
function createReporter(io: CliIo, json: boolean, quiet: boolean) {
  const live = !json && !quiet && io.stderr.isTTY === true
  let pendingLine = false
  const clearLine = () => {
    if (pendingLine) io.stderr.write('\r\x1b[2K')
    pendingLine = false
  }
  return {
    status(message: string) {
      if (json) io.stdout.write(JSON.stringify({ type: 'status', message }) + '\n')
      else if (!quiet) {
        clearLine()
        io.stderr.write(message + '\n')
      }
    },
    progress(label: string, fraction: number) {
      if (json) io.stdout.write(JSON.stringify({ type: 'progress', progress: Math.round(fraction * 1000) / 1000 }) + '\n')
      else if (live) {
        io.stderr.write(`\r\x1b[2K${label} ${Math.floor(fraction * 100)}%`)
        pendingLine = true
      }
    },
    warn(message: string) {
      if (json) io.stdout.write(JSON.stringify({ type: 'warning', message }) + '\n')
      else {
        clearLine()
        io.stderr.write(`경고: ${message}\n`)
      }
    },
    result(summary: string, data: Record<string, unknown>) {
      clearLine()
      if (json) io.stdout.write(JSON.stringify({ type: 'result', ...data }) + '\n')
      else io.stdout.write(summary + '\n')
    },
    error(message: string) {
      clearLine()
      if (json) io.stdout.write(JSON.stringify({ type: 'error', message }) + '\n')
      else io.stderr.write(`오류: ${message}\n`)
    }
  }
}

function readProject(path: string): ProjectFile {
  if (!isProjectPath(path)) throw new Error(`Sub Sync 프로젝트(.subsync) 파일만 열 수 있습니다: ${path}`)
  if (!existsSync(path)) throw new Error(`프로젝트 파일이 없습니다: ${path}`)
  const project = parseProject(readFileSync(path, 'utf8'))
  if (project.version !== 2) {
    throw new Error('영상 정보가 없는 예전 형식(버전 1) 프로젝트입니다. 데스크톱 앱에서 열어 저장한 뒤 다시 실행해 주세요.')
  }
  return project
}

interface Outputs {
  project?: string
  srt?: string
}

/**
 * Resolves every output before any long work starts, so a slow transcription never ends in a
 * refused write. The input project may always be rewritten; other existing files need --force.
 */
function planOutputs(outputs: Outputs, mediaPath: string, force: boolean, input?: string): Outputs {
  const resolved: Outputs = {
    // A project is always saved as `.subsync`, whatever name was given, exactly like the editor's save dialog.
    project: outputs.project && withProjectExtension(resolve(outputs.project)),
    srt: outputs.srt && resolve(outputs.srt)
  }
  for (const path of Object.values(resolved)) {
    if (!path) continue
    if (samePath(path, mediaPath)) throw new Error(`원본 영상과 같은 경로에는 저장할 수 없습니다: ${path}`)
    if (existsSync(path) && !force && !(input && samePath(path, input))) {
      throw new Error(`이미 있는 파일입니다: ${path} (덮어쓰려면 --force를 붙여 주세요)`)
    }
  }
  if (resolved.project && resolved.srt && samePath(resolved.project, resolved.srt)) throw new Error('프로젝트와 SRT를 같은 경로에 저장할 수 없습니다.')
  return resolved
}

/** Writes the SRT first so the saved project can remember it, as the editor does after "SRT 저장". */
function save(project: ProjectFile, outputs: Outputs) {
  let saved = project
  if (outputs.srt) {
    atomicWrite(outputs.srt, serializeSrt(project.clips))
    saved = { ...project, srtPath: outputs.srt }
  }
  if (outputs.project) writeProject(outputs.project, saved)
  return saved
}

const savedTo = (outputs: Outputs) => [outputs.project, outputs.srt].filter(Boolean).map((path) => `  ${path}`).join('\n')

const summary = (clips: Clip[]) => ({ clips: clips.length, words: allWords(clips).length })

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv
  const wantsJson = rest.includes('--json')
  const report = createReporter(io, wantsJson, rest.includes('--quiet') || rest.includes('-q'))
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    io.stdout.write((HELP[rest[0]] ?? USAGE) + '\n')
    return command ? EXIT.ok : EXIT.usage
  }
  if (!(command in OPTIONS)) {
    report.error(`알 수 없는 명령입니다: ${command}\n\n${USAGE}`)
    return EXIT.usage
  }
  try {
    const name = command as Command
    const { values, positionals } = parseArgs({ args: rest, options: OPTIONS[name], allowPositionals: true, allowNegative: true, strict: true })
    if (values.help) {
      io.stdout.write(HELP[name] + '\n')
      return EXIT.ok
    }
    if (positionals.length !== 1) throw new UsageError(`${name === 'transcribe' ? '영상' : '프로젝트'} 경로를 하나 넣어 주세요.`)
    const input = resolve(positionals[0])
    const force = values.force === true
    const options = values as Record<string, string | boolean | undefined>

    switch (name) {
      case 'transcribe': {
        const device = options.device as string | undefined
        if (device !== undefined && !['auto', 'cuda', 'cpu'].includes(device)) throw new UsageError(`--device는 auto, cuda, cpu 중 하나입니다: ${device}`)
        const maxChars = positiveNumber(options['max-chars'] as string | undefined, 'max-chars', true)
        const maxDuration = positiveNumber(options['max-duration'] as string | undefined, 'max-duration')
        if (!existsSync(input)) throw new Error(`영상 파일이 없습니다: ${input}`)

        const media = await io.runtime.probe(input)
        if (!media.hasAudio) throw new Error('오디오 트랙이 없어 음성 인식을 할 수 없습니다.')
        const outputs = planOutputs({ project: (options.project as string | undefined) ?? defaultProjectPath(media.path), srt: options.output as string | undefined }, media.path, force)

        const saved = mergeSettings(io.runtime.loadSettings())
        const stt: SttOptions = {
          model: (options.model as string | undefined) ?? saved.stt.model,
          language: (options.language as string | undefined) ?? saved.stt.language,
          device: (device as SttOptions['device'] | undefined) ?? saved.stt.device
        }
        const dictionary = options.dict === undefined ? saved.dictionary : decodeSubtitle(readFileSync(resolve(options.dict as string)))
        const settings = { ...saved, stt, dictionary, segment: { ...saved.segment, ...(maxChars && { maxChars }), ...(maxDuration && { maxDuration }) } }

        let label = '음성 인식 준비 중'
        report.status(`${media.path} (${media.duration.toFixed(1)}초, 모델 ${stt.model}, ${stt.device})`)
        const result = await io.runtime.transcribe(media.path, stt, parseDictionary(dictionary).hotwords, (event: SttEvent) => {
          if (event.type === 'status') report.status(label = event.message)
          else if (event.type === 'progress' && event.duration > 0) report.progress(label, Math.min(1, event.seconds / event.duration))
          else if (event.type === 'reset') report.warn('GPU 인식에 실패해 CPU로 처음부터 다시 인식합니다.')
        }, io.signal)
        const clips = clipsFromTranscript(result.words, [], settings)
        if (clips.length === 0) report.warn('인식된 음성이 없습니다. 빈 프로젝트를 저장합니다.')
        save(buildProject({ media, clips, settings, peaks: null, playback: { time: 0, rate: 1, follow: true }, srtPath: null }), outputs)
        report.result(`자막 ${clips.length}개 생성 완료 (${result.device === 'cuda' ? 'GPU' : 'CPU'}). 저장한 파일:\n${savedTo(outputs)}`,
          { command: name, ...summary(clips), device: result.device, project: outputs.project, srt: outputs.srt ?? null })
        return EXIT.ok
      }

      case 'overlay': {
        const srt = options.srt as string | undefined
        if (!srt) throw new UsageError('덮어쓸 자막을 --srt <경로>로 넣어 주세요.')
        const project = readProject(input)
        const srtPath = resolve(srt)
        if (!existsSync(srtPath)) throw new Error(`SRT 파일이 없습니다: ${srtPath}`)
        const outputs = planOutputs({ project: (options.project as string | undefined) ?? input, srt: options.output as string | undefined }, project.media.path, force, input)
        const words = allWords(project.clips).length
        if (words === 0) report.warn('프로젝트에 인식된 단어가 없어 단어 위치 없이 자막만 들어갑니다. 먼저 transcribe를 실행하는 것이 좋습니다.')
        const { clips, cues } = overlaySrt(project.clips, decodeSubtitle(readFileSync(srtPath)))
        save({ ...project, clips, srtPath }, outputs)
        report.result(`자막 ${cues}개를 덮어썼습니다 (영어 단어 ${words}개 위치 유지). 저장한 파일:\n${savedTo(outputs)}`,
          { command: name, ...summary(clips), project: outputs.project, srt: outputs.srt ?? null })
        return EXIT.ok
      }

      case 'sentences': {
        const pauseThreshold = positiveNumber(options['pause-threshold'] as string | undefined, 'pause-threshold') ?? 2
        const maxDurationThreshold = positiveNumber(options['duration-threshold'] as string | undefined, 'duration-threshold') ?? 15
        const project = readProject(input)
        const outputs = planOutputs({ project: (options.project as string | undefined) ?? input, srt: options.output as string | undefined }, project.media.path, force, input)
        const words = allWords(project.clips)
        if (words.length === 0) throw new Error('단어 정보가 없어 문장을 다시 묶을 수 없습니다. 먼저 transcribe를 실행해 주세요.')
        report.status(`pySBD로 단어 ${words.length}개의 문장 경계를 분석하는 중`)
        const ends = await io.runtime.sentenceBoundaries(words.map((word) => word.text), io.signal)
        const { clips, uncertain } = groupSentences(project.clips, ends, { preserveEdits: options['preserve-edits'] !== false, pauseThreshold, maxDurationThreshold })
        save({ ...project, clips }, outputs)
        if (uncertain > 0) report.warn(`확인이 필요한 문장이 ${uncertain}개 있습니다. 데스크톱 앱의 "원문 문장으로 묶기"에서 이유를 볼 수 있습니다.`)
        report.result(`자막 ${project.clips.length}개를 문장 ${clips.length}개로 묶었습니다. 저장한 파일:\n${savedTo(outputs)}`,
          { command: name, ...summary(clips), uncertain, project: outputs.project, srt: outputs.srt ?? null })
        return EXIT.ok
      }

      case 'srt': {
        const project = readProject(input)
        if (project.clips.length === 0) throw new Error('저장할 자막이 없습니다.')
        const target = (options.output as string | undefined) ?? `${stripExtension(project.media.path)}.srt`
        const { srt } = planOutputs({ srt: target }, project.media.path, force)
        atomicWrite(srt!, serializeSrt(project.clips))
        report.result(`자막 ${project.clips.length}개를 저장했습니다: ${srt}`, { command: name, ...summary(project.clips), srt })
        return EXIT.ok
      }
    }
  } catch (error) {
    if (io.signal.aborted) {
      report.error('작업을 취소했습니다.')
      return EXIT.cancelled
    }
    const usage = error instanceof UsageError || (error as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')
    report.error(usage ? `${errorText(error)}\n자세한 사용법: sub-sync ${command} --help` : errorText(error))
    return usage ? EXIT.usage : EXIT.error
  }
}
