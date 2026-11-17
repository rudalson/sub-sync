import { describe, expect, it } from 'vitest'
import { transcriptionRecord, unheardStretches } from '../src/shared/transcription'
import type { Word } from '../src/shared/types'

const options = { model: 'large-v3', language: 'en', device: 'auto' as const }

describe('transcription record', () => {
  it('records what the worker reports and the run times', () => {
    const record = transcriptionRecord(
      { type: 'done', language: 'en', device: 'cpu', model: 'large-v3-turbo', computeType: 'int8', languageProbability: 0.9, audioDuration: 60, speechDuration: null, vadFilter: true, engineVersion: null },
      options, new Date('2026-11-17T00:00:00Z'), new Date('2026-11-17T00:01:30Z')
    )
    expect(record).toEqual({
      engine: 'faster-whisper', model: 'large-v3-turbo', device: 'cpu', computeType: 'int8', language: 'en', detectedLanguage: 'en',
      languageProbability: 0.9, vadFilter: true, audioDuration: 60,
      startedAt: '2026-11-17T00:00:00.000Z', finishedAt: '2026-11-17T00:01:30.000Z'
    })
  })

  it('falls back to the options an older worker ran with', () => {
    const record = transcriptionRecord({ type: 'done', language: 'en', device: 'cuda' }, { ...options, language: 'auto' }, new Date(0), new Date(0))
    expect(record).toMatchObject({ model: 'large-v3', language: 'auto', vadFilter: true })
    expect(record).not.toHaveProperty('computeType')
  })
})

describe('unheard stretches', () => {
  const word = (start: number, end: number): Word => ({ text: 'w', start, end, prob: 0.9 })
  /** 100 frames a second: level 100 while words are spoken, `gapLevel` in between. */
  function waveform(duration: number, words: Word[], gapLevel: (time: number) => number) {
    return Array.from({ length: duration * 100 }, (_, i) => {
      const time = i / 100
      return words.some((w) => time >= w.start && time < w.end) ? 100 : gapLevel(time)
    })
  }

  it('finds long gaps that carry sound, including before the first and after the last word', () => {
    const words = [word(5, 6), word(6, 7), word(20, 21)]
    const peaks = waveform(30, words, () => 60)
    expect(unheardStretches(words, 30, peaks, 100)).toEqual([
      { start: 0, end: 5, sound: 1 }, { start: 7, end: 20, sound: 1 }, { start: 21, end: 30, sound: 1 }
    ])
  })

  it('leaves out silence and short pauses', () => {
    const words = [word(0, 1), word(3, 4), word(10, 11)]
    // Quiet between 4 and 10 seconds: only a few frames of breath noise.
    const peaks = waveform(11, words, (time) => (time > 6 && time < 6.5 ? 60 : 5))
    expect(unheardStretches(words, 11, peaks, 100)).toEqual([])
  })

  it('judges loudness against the video’s own speech level', () => {
    const words = [word(0, 1), word(10, 11)]
    // Peaks are normalised per video: a quiet recording speaks at 20, and a gap at 15 is still sound.
    const quiet = waveform(11, words, () => 15).map((peak) => (peak === 100 ? 20 : peak))
    expect(unheardStretches(words, 11, quiet, 100)).toHaveLength(1)
  })

  it('still lists gaps when there is no waveform, without judging sound', () => {
    expect(unheardStretches([word(0, 1), word(1.2, 2)], 10, null, 100)).toEqual([{ start: 2, end: 10, sound: null }])
  })

  it('treats a word spanning others as covering the time', () => {
    const words = [word(0, 12), word(1, 2), word(13, 14)]
    expect(unheardStretches(words, 14, null, 100)).toEqual([])
  })
})
