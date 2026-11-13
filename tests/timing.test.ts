import { describe, expect, it } from 'vitest'
import { clipIndexAt } from '../src/renderer/src/player'
import { buildAss } from '../src/shared/ass'
import { clipsFromTranscript, groupSentences, mergeSettings, overlaySrt } from '../src/shared/pipeline'
import { parseSrt, serializeSrt } from '../src/shared/srt'
import { closeSubtitleGaps, visibleCues } from '../src/shared/timing'
import type { Clip, Word } from '../src/shared/types'

const sample = [
  '1',
  '00:00:00,000 --> 00:00:05,720',
  "This is how you master the art of conversation, even if you're shy or introverted.",
  '',
  '2',
  '00:00:05,980 --> 00:00:07,440',
  "I can't talk to girls.",
  '',
  '3',
  '00:00:07,560 --> 00:00:08,600',
  "I don't know what to say to him.",
  ''
].join('\n')

const style = { font: 'Malgun Gothic', weight: 700, sizePct: 5, marginPct: 6, box: true }
const sampleClips = (): Clip[] => parseSrt(sample).map((cue, index) => ({ ...cue, id: String(index), words: [] }))
const clip = (id: string, start: number, end: number, text = id): Clip => ({ id, start, end, text, words: [] })
const word = (text: string, start: number, end: number): Word => ({ text, start, end })
// Two spoken sentences with a 0.5 s pause between them.
const speech = [word('Hello', 0, 0.5), word('there.', 0.5, 1), word('Next', 1.5, 2), word('one.', 2, 2.5)]

describe('closing short subtitle gaps', () => {
  it('extends the preceding subtitle exactly to the next start in the supplied example', () => {
    const clips = sampleClips()
    const result = closeSubtitleGaps(clips)
    expect(result.map(({ start }) => start)).toEqual(clips.map(({ start }) => start))
    expect(result.map(({ end }) => end)).toEqual([clips[1].start, clips[2].start, clips[2].end])
  })

  it('includes a one-second gap despite floating-point error and preserves larger gaps', () => {
    const result = closeSubtitleGaps([clip('first', 3, 3.4), clip('second', 4.4, 5), clip('third', 6.001, 7)])
    expect(result.map(({ end }) => end)).toEqual([4.4, 5, 7])
  })

  it('keeps word anchors, confidence, IDs, text and the input untouched', () => {
    const clips = sampleClips()
    clips[0].words = [{ text: 'introverted.', start: 5, end: 5.72, prob: 0.95 }]
    const original = structuredClone(clips)
    const closed = closeSubtitleGaps(clips)
    expect(clips).toEqual(original)
    expect(closed[0]).toEqual({ ...original[0], end: 5.98 })
    expect(closed[0].words).toBe(clips[0].words)
    expect(closeSubtitleGaps(closed)).toEqual(closed)
  })

  it('skips empty subtitles when finding the next one but keeps them in place', () => {
    const clips = [clip('first', 0, 1), clip('blank', 1.1, 1.2, ' \n '), clip('next', 1.4, 2)]
    expect(closeSubtitleGaps(clips).map(({ id, end }) => [id, end])).toEqual([['first', 1.4], ['blank', 1.2], ['next', 2]])
  })

  it('preserves touching or overlapping boundaries and handles empty or single subtitle lists', () => {
    const clips = [clip('overlap', 0, 2), clip('touching', 1.5, 3), clip('last', 3, 4)]
    expect(closeSubtitleGaps(clips)).toEqual(clips)
    expect(closeSubtitleGaps([])).toEqual([])
    expect(closeSubtitleGaps([clip('only', 1, 2)])).toEqual([clip('only', 1, 2)])
  })
})

describe('where the gap rule applies', () => {
  it('is applied once when subtitles are generated from speech or grouped into sentences', () => {
    const generated = clipsFromTranscript(speech, [], mergeSettings())
    expect(generated.map(({ start, end }) => [start, end])).toEqual([[0, 1.5], [1.5, 2.5]])
    expect(generated[0].words.at(-1)?.end).toBe(1)

    const recognised: Clip[] = [
      { id: 'a', start: 0, end: 1, text: 'Hello there.', words: speech.slice(0, 2) },
      { id: 'b', start: 1.5, end: 2.5, text: 'Next one.', words: speech.slice(2) }
    ]
    expect(groupSentences(recognised, [2, 4]).clips.map(({ start, end }) => [start, end])).toEqual([[0, 1.5], [1.5, 2.5]])
  })

  it('leaves a loaded SRT exactly as timed, also when speech is recognised under it later', () => {
    const loaded = overlaySrt([], sample).clips
    expect(loaded.map(({ end }) => end)).toEqual([5.72, 7.44, 8.6])
    const anchored = clipsFromTranscript([word('This', 0, 0.4)], loaded, mergeSettings())
    expect(anchored.map(({ end }) => end)).toEqual([5.72, 7.44, 8.6])
  })

  it('shows, saves and burns in subtitles with the timing stored in the editor', () => {
    const clips = sampleClips()
    expect(serializeSrt(clips)).toBe(sample)
    const shown = visibleCues(clips)
    expect(clipIndexAt(shown, 5.8)).toBe(-1)
    expect(clipIndexAt(shown, 5.98)).toBe(1)
    const ass = buildAss(clips, style, 1280, 720)
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:05.72,')
    expect(ass).toContain('Dialogue: 0,0:00:05.98,0:00:07.44,')
  })

  it('leaves empty subtitles out of the preview, SRT and video export', () => {
    const clips = [clip('first', 0, 1), clip('blank', 1.1, 1.2, ' \n '), clip('next', 1.4, 2)]
    expect(clipIndexAt(visibleCues(clips), 1.15)).toBe(-1)
    expect(parseSrt(serializeSrt(clips)).map(({ text }) => text)).toEqual(['first', 'next'])
    expect(buildAss(clips, style, 1280, 720).match(/Dialogue:/g)).toHaveLength(2)
  })
})
