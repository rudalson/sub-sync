import type { SttEvent, SttOptions, TranscriptionRecord, Word } from './types'

type DoneEvent = Extract<SttEvent, { type: 'done' }>

/** The project's note of what produced its words, from the worker's last event and the options it ran with. */
export function transcriptionRecord(event: DoneEvent, options: SttOptions, startedAt: Date, finishedAt: Date): TranscriptionRecord {
  const optional = <K extends keyof TranscriptionRecord>(key: K, value: TranscriptionRecord[K] | null | undefined) =>
    value === null || value === undefined ? {} : { [key]: value }
  return {
    engine: 'faster-whisper',
    ...optional('engineVersion', event.engineVersion),
    model: event.model ?? options.model,
    device: event.device,
    ...optional('computeType', event.computeType),
    language: options.language,
    detectedLanguage: event.language,
    ...optional('languageProbability', event.languageProbability),
    // Every worker so far has cut silence out first.
    vadFilter: event.vadFilter ?? true,
    ...optional('audioDuration', event.audioDuration),
    ...optional('speechDuration', event.speechDuration),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString()
  }
}

/** A stretch with no recognised word although the waveform has sound in it. */
export interface UnheardStretch {
  start: number
  end: number
  /** Share (0-1) of the stretch where there is sound; null without a waveform. */
  sound: number | null
}

/** Shorter pauses are ordinary breaths and slide changes. */
export const UNHEARD_MIN_SECONDS = 4
/** Below this share of sound, a stretch is taken as silence. */
const MIN_SOUND_SHARE = 0.2
/** A frame counts as sound when it reaches this part of the typical level under words. */
const SOUND_LEVEL = 0.35

const median = (values: number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Where recognition may have missed speech: gaps between words of at least `minSeconds`, including
 * before the first word and after the last, that still carry sound. Loudness is judged against the
 * video's own level while words are spoken, since peaks are normalised per video.
 */
export function unheardStretches(
  words: Word[], duration: number, peaks: ArrayLike<number> | null, samplesPerSecond: number, minSeconds = UNHEARD_MIN_SECONDS
): UnheardStretch[] {
  const gaps: Array<[number, number]> = []
  let covered = 0
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    if (word.start - covered >= minSeconds) gaps.push([covered, word.start])
    covered = Math.max(covered, word.end)
  }
  if (duration - covered >= minSeconds) gaps.push([covered, duration])
  if (!peaks || peaks.length === 0) return gaps.map(([start, end]) => ({ start, end, sound: null }))

  const frames = (start: number, end: number) => {
    const from = Math.max(0, Math.floor(start * samplesPerSecond))
    return [from, Math.min(peaks.length, Math.max(from + 1, Math.ceil(end * samplesPerSecond)))] as const
  }
  const wordLevels = words.flatMap((word) => {
    const [from, to] = frames(word.start, word.end)
    if (from >= peaks.length) return []
    let sum = 0
    for (let i = from; i < to; i++) sum += peaks[i]
    return [sum / (to - from)]
  })
  const threshold = Math.max(1, median(wordLevels) * SOUND_LEVEL)
  return gaps.flatMap(([start, end]) => {
    const [from, to] = frames(start, end)
    if (from >= peaks.length) return []
    let loud = 0
    for (let i = from; i < to; i++) if (peaks[i] >= threshold) loud++
    const sound = loud / (to - from)
    return sound >= MIN_SOUND_SHARE ? [{ start, end, sound }] : []
  })
}
