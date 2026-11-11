import { applyDictionary, parseDictionary } from './edits'
import { overlayCues } from './overlay'
import { DEFAULT_SETTINGS } from './project'
import { segmentWords } from './segment'
import { reconstructSentencesWithPreservation, type SentenceBoundaryOptions } from './sentenceBoundary'
import { parseSrt } from './srt'
import { PEAKS_PER_SECOND, type Clip, type MediaInfo, type ProjectFile, type Settings, type Word } from './types'

/** Editing steps shared by the desktop editor and the command line, free of any UI or process code. */

export const allWords = (clips: Clip[]): Word[] => clips.flatMap((clip) => clip.words)
export const stripExtension = (path: string) => path.replace(/\.[^./\\]+$/, '')
export const defaultProjectPath = (mediaPath: string) => `${stripExtension(mediaPath)}.subsync.json`

/** Saved settings may come from an older version, so each group falls back to the defaults field by field. */
export function mergeSettings(saved: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS, ...saved,
    stt: { ...DEFAULT_SETTINGS.stt, ...saved.stt },
    segment: { ...DEFAULT_SETTINGS.segment, ...saved.segment },
    style: { ...DEFAULT_SETTINGS.style, ...saved.style }
  }
}

/**
 * Turns recognised words into clips. Subtitles loaded before any recognition keep their text and timing,
 * and the new words only become their anchors.
 */
export function clipsFromTranscript(words: Word[], previous: Clip[], settings: Settings): Clip[] {
  const hasOnlySubtitles = previous.length > 0 && allWords(previous).length === 0
  const clips = hasOnlySubtitles ? overlayCues(words, previous) : segmentWords(words, settings.segment)
  return applyDictionary(clips, parseDictionary(settings.dictionary))
}

/** Lays an SRT over the clips; the recognised words stay as anchors under the new text. */
export function overlaySrt(clips: Clip[], content: string): { clips: Clip[]; cues: number } {
  const cues = parseSrt(content)
  if (cues.length === 0) throw new Error('SRT에서 자막을 찾지 못했습니다.')
  return { clips: overlayCues(allWords(clips), cues), cues: cues.length }
}

/** Regroups clips into the sentences found by pySBD, refusing any result that would lose or duplicate words. */
export function groupSentences(clips: Clip[], sentenceEnds: number[], options: SentenceBoundaryOptions = {}) {
  const result = reconstructSentencesWithPreservation(clips, sentenceEnds, options)
  if (!result.integrity.valid) throw new Error(result.integrity.error)
  return {
    clips: result.sentences.map(({ id, start, end, text, words }): Clip => ({ id, start, end, text, words })),
    uncertain: result.sentences.filter((sentence) => sentence.isUncertain).length
  }
}

export interface ProjectState {
  media: Omit<MediaInfo, 'url'> & { url?: string }
  clips: Clip[]
  settings: Settings
  peaks: Uint8Array | null
  playback: ProjectFile['playback']
  srtPath: string | null
}

/** The saved project never keeps the generated playback URL. */
export function buildProject({ media, clips, settings, peaks, playback, srtPath }: ProjectState): ProjectFile {
  const { url: _url, ...source } = media
  return {
    format: 'sub-sync', version: 2, media: source,
    clips,
    waveform: peaks === null ? null : { samplesPerSecond: PEAKS_PER_SECOND, peaks: Array.from(peaks) },
    settings,
    playback,
    srtPath
  }
}
