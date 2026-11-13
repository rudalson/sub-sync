import { PEAKS_PER_SECOND, type Clip, type ProjectFile, type SavedProject, type Settings, type Word } from './types'

export const DEFAULT_SETTINGS: Settings = {
  stt: { model: 'large-v3', language: 'en', device: 'auto' },
  segment: { maxChars: 84, maxDuration: 8, splitOnSentence: true, maxGap: 0.8 },
  style: { font: 'Malgun Gothic', weight: 700, sizePct: 5, marginPct: 6, box: true },
  dictionary: ''
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const positive = (value: unknown): value is number => nonnegative(value) && value > 0
const text = (value: unknown): value is string => typeof value === 'string'
const timeRange = (value: Record<string, unknown>): value is Record<string, unknown> & { start: number; end: number } =>
  nonnegative(value.start) && nonnegative(value.end) && value.end >= value.start

function isWord(value: unknown): value is Word {
  return record(value) && text(value.text) && timeRange(value) &&
    (value.prob === undefined || (nonnegative(value.prob) && value.prob <= 1))
}

function isClips(value: unknown): value is Clip[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every((clip, index) => {
    if (!record(clip) || !text(clip.id) || !clip.id || ids.has(clip.id) || !text(clip.text) || !timeRange(clip) ||
      !Array.isArray(clip.words) || !clip.words.every(isWord)) return false
    if (index > 0 && clip.start < value[index - 1].start) return false
    ids.add(clip.id)
    return true
  })
}

function isSettings(value: unknown): value is Settings {
  if (!record(value) || !record(value.stt) || !record(value.segment) || !record(value.style)) return false
  const { stt, segment, style } = value
  return text(stt.model) && !!stt.model && text(stt.language) && !!stt.language &&
    ['auto', 'cuda', 'cpu'].includes(stt.device as string) &&
    positive(segment.maxChars) && Number.isInteger(segment.maxChars) && positive(segment.maxDuration) &&
    nonnegative(segment.maxGap) && typeof segment.splitOnSentence === 'boolean' &&
    text(style.font) && (style.weight === undefined || (positive(style.weight) && Number.isInteger(style.weight) && style.weight <= 1000)) &&
    positive(style.sizePct) && nonnegative(style.marginPct) && typeof style.box === 'boolean' &&
    text(value.dictionary)
}

/** Validate at the file boundary, before changing the current editing session. */
export function validateProject(value: unknown): SavedProject {
  if (!record(value)) throw new Error('올바른 Sub Sync 프로젝트 파일이 아닙니다.')
  if (value.version !== 1 && value.version !== 2) {
    throw new Error('지원하지 않는 프로젝트 버전입니다. 파일을 만든 앱 버전을 확인해 주세요.')
  }
  if (!isClips(value.clips)) throw new Error('프로젝트의 자막 또는 단어 시간 정보가 손상되었습니다.')
  if (value.version === 1) {
    if (!nonnegative(value.mediaSize) || !Number.isSafeInteger(value.mediaSize)) throw new Error('프로젝트의 영상 정보가 손상되었습니다.')
    return { version: 1, mediaSize: value.mediaSize, clips: value.clips }
  }

  const { media, waveform, playback } = value
  if (value.format !== 'sub-sync' || !record(media) || !text(media.path) || !media.path ||
    (media.relativePath !== undefined && !text(media.relativePath)) ||
    !nonnegative(media.size) || !Number.isSafeInteger(media.size) || !nonnegative(media.duration) ||
    !positive(media.width) || !positive(media.height) || typeof media.hasAudio !== 'boolean') {
    throw new Error('프로젝트의 영상 정보가 손상되었습니다.')
  }
  if (waveform !== null && (!record(waveform) || waveform.samplesPerSecond !== PEAKS_PER_SECOND ||
    !Array.isArray(waveform.peaks) || !waveform.peaks.every((peak) => nonnegative(peak) && Number.isInteger(peak) && peak <= 255))) {
    throw new Error('프로젝트의 파형 정보가 손상되었습니다.')
  }
  if (!isSettings(value.settings)) throw new Error('프로젝트의 편집 설정이 손상되었습니다.')
  if (!record(playback) || !nonnegative(playback.time) || ![0.5, 0.75, 1, 1.25, 1.5, 2].includes(playback.rate as number) ||
    typeof playback.follow !== 'boolean' || !(value.srtPath === null || text(value.srtPath))) {
    throw new Error('프로젝트의 재생 위치 또는 자막 경로가 손상되었습니다.')
  }
  // The checks above validate the complete persisted schema, including nested arrays.
  const project = value as unknown as ProjectFile
  // Projects saved before the subtitle weight could be chosen drew it bold.
  if (project.settings.style.weight === undefined) {
    return { ...project, settings: { ...project.settings, style: { ...project.settings.style, weight: DEFAULT_SETTINGS.style.weight } } }
  }
  return project
}

export function parseProject(source: string): SavedProject {
  let value: unknown
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('프로젝트 파일을 읽을 수 없습니다. JSON 형식이 손상되었습니다.')
  }
  return validateProject(value)
}

export function serializeProject(project: SavedProject): string {
  return JSON.stringify(validateProject(project))
}

export const projectMediaSize = (project: SavedProject) => project.version === 1 ? project.mediaSize : project.media.size
