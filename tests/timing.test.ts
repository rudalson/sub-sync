import { describe, expect, it } from 'vitest'
import { clipIndexAt } from '../src/renderer/src/player'
import { buildAss } from '../src/shared/ass'
import { parseSrt, serializeSrt } from '../src/shared/srt'
import { closeSubtitleGaps } from '../src/shared/timing'
import type { Clip } from '../src/shared/types'

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

const sampleClips = (): Clip[] => parseSrt(sample).map((cue, index) => ({ ...cue, id: String(index), words: [] }))
const clip = (id: string, start: number, end: number, text = id): Clip => ({ id, start, end, text, words: [] })

describe('short subtitle gaps', () => {
  it('extends the preceding subtitle exactly to the next start in the supplied example', () => {
    const clips = sampleClips()
    const result = closeSubtitleGaps(clips)
    expect(result.map(({ start }) => start)).toEqual(clips.map(({ start }) => start))
    expect(result.map(({ end }) => end)).toEqual([clips[1].start, clips[2].start, clips[2].end])
    expect(serializeSrt(clips)).toBe(sample
      .replace('00:00:05,720', '00:00:05,980')
      .replace('00:00:07,440', '00:00:07,560'))
  })

  it('uses the same boundaries for preview and burned-in video subtitles', () => {
    const clips = sampleClips()
    const displayed = closeSubtitleGaps(clips)
    expect(clipIndexAt(displayed, 5.8)).toBe(0)
    expect(clipIndexAt(displayed, 5.98)).toBe(1)
    expect(clipIndexAt(displayed, 7.5)).toBe(1)
    expect(clipIndexAt(displayed, clips[2].start)).toBe(2)
    expect(clipIndexAt(displayed, 8.6)).toBe(-1)
    const ass = buildAss(clips, { font: 'Malgun Gothic', weight: 700, sizePct: 5, marginPct: 6, box: true }, 1280, 720)
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:05.98,')
    expect(ass).toContain('Dialogue: 0,0:00:05.98,0:00:07.56,')
    expect(ass).toContain('Dialogue: 0,0:00:07.56,0:00:08.60,')
  })

  it('preserves long pauses and the final subtitle end', () => {
    const clips = [clip('first', 0, 1), clip('second', 2, 3)]
    const displayed = closeSubtitleGaps(clips)
    expect(displayed).toEqual(clips)
    expect(clipIndexAt(displayed, 1.5)).toBe(-1)
    expect(parseSrt(serializeSrt(clips)).map(({ end }) => end)).toEqual([1, 3])
  })

  it('includes a 500 ms gap despite floating-point error and preserves larger gaps', () => {
    const result = closeSubtitleGaps([
      clip('first', 100, 100.1),
      clip('second', 100.6, 101),
      clip('third', 101.501, 102)
    ])
    expect(result.map(({ end }) => end)).toEqual([100.6, 101, 102])
  })

  it('keeps original clip times, word anchors, confidence, IDs and text intact', () => {
    const clips = sampleClips()
    clips[0].words = [{ text: 'introverted.', start: 5, end: 5.72, prob: 0.95 }]
    const original = structuredClone(clips)
    const displayed = closeSubtitleGaps(clips)
    expect(clips).toEqual(original)
    expect(displayed[0]).toEqual({ ...original[0], end: 5.98 })
    expect(displayed[0].words).toBe(clips[0].words)
    expect(closeSubtitleGaps(displayed)).toEqual(displayed)
  })

  it('ignores empty subtitles when choosing the next displayed subtitle', () => {
    const clips = [clip('first', 0, 1), clip('blank', 1.1, 1.2, ' \n '), clip('next', 1.4, 2)]
    const displayed = closeSubtitleGaps(clips)
    expect(displayed.map(({ id, end }) => [id, end])).toEqual([['first', 1.4], ['next', 2]])
    expect(clipIndexAt(displayed, 1.15)).toBe(0)
    expect(parseSrt(serializeSrt(clips))).toHaveLength(2)
    expect(buildAss(clips, { font: 'Arial', weight: 700, sizePct: 5, marginPct: 6, box: true }, 1280, 720))
      .toContain('Dialogue: 0,0:00:00.00,0:00:01.40,')
  })

  it('preserves touching or overlapping boundaries and handles empty or single subtitle lists', () => {
    const clips = [clip('overlap', 0, 2), clip('touching', 1.5, 3), clip('last', 3, 4)]
    expect(closeSubtitleGaps(clips)).toEqual(clips)
    expect(closeSubtitleGaps([])).toEqual([])
    expect(closeSubtitleGaps([clip('only', 1, 2)])).toEqual([clip('only', 1, 2)])
  })
})
