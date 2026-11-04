import { describe, expect, it } from 'vitest'
import { buildAss } from '../src/shared/ass'
import { applyDictionary, mergeWithNext, moveEdge, parseDictionary, splitClip } from '../src/shared/edits'
import { overlayCues } from '../src/shared/overlay'
import { clipFromWords, joinWords, segmentWords } from '../src/shared/segment'
import { parseSrt, serializeSrt } from '../src/shared/srt'
import type { Clip, SegmentOptions, Word } from '../src/shared/types'

function wordsFrom(sentence: string, startAt = 0, wordLength = 0.4, gap = 0.05): Word[] {
  let time = startAt
  return sentence.split(' ').map((text) => {
    const word = { text, start: time, end: time + wordLength }
    time += wordLength + gap
    return word
  })
}

const options: SegmentOptions = { maxChars: 42, maxDuration: 6, splitOnSentence: true, maxGap: 0.8 }

describe('srt', () => {
  it('parses CRLF, BOM, dotted decimals and multi-line cues', () => {
    const cues = parseSrt(
      '﻿1\r\n00:00:01,500 --> 00:00:03.250\r\n안녕\r\n하세요\r\n\r\n2\r\n01:02:03,004 --> 01:02:04,000\r\nsecond\r\n'
    )
    expect(cues).toEqual([
      { start: 1.5, end: 3.25, text: '안녕\n하세요' },
      { start: 3723.004, end: 3724, text: 'second' }
    ])
  })

  it('round-trips through serialize and drops empty cues', () => {
    const clips: Clip[] = [
      { id: 'a', start: 0.1, end: 1.2345, text: 'hello', words: [] },
      { id: 'b', start: 2, end: 3, text: '   ', words: [] },
      { id: 'c', start: 3661.5, end: 3662, text: 'a\n\nb', words: [] }
    ]
    const srt = serializeSrt(clips)
    expect(srt).toBe('1\n00:00:00,100 --> 00:00:01,235\nhello\n\n2\n01:01:01,500 --> 01:01:02,000\na\nb\n')
    expect(parseSrt(srt).map((cue) => cue.text)).toEqual(['hello', 'a\nb'])
  })
})

describe('segmentWords', () => {
  it('cuts at sentence ends when enabled, and not when disabled', () => {
    const words = wordsFrom('One two. Three four.')
    expect(segmentWords(words, options).map((clip) => clip.text)).toEqual(['One two.', 'Three four.'])
    expect(segmentWords(words, { ...options, splitOnSentence: false })).toHaveLength(1)
  })

  it('never exceeds maxChars and prefers a comma', () => {
    const words = wordsFrom('alpha beta gamma delta epsilon, zeta eta theta iota kappa lambda mu nu xi omicron')
    const clips = segmentWords(words, { ...options, maxChars: 40 })
    expect(clips[0].text.endsWith('epsilon,')).toBe(true)
    for (const clip of clips) expect(clip.text.length).toBeLessThanOrEqual(40)
    expect(clips.flatMap((clip) => clip.words)).toEqual(words)
  })

  it('cuts at maxDuration and at long pauses', () => {
    const long = wordsFrom('a b c d e f g h', 0, 1, 0)
    expect(segmentWords(long, { ...options, maxDuration: 3 }).every((c) => c.end - c.start <= 3)).toBe(true)
    const paused = [...wordsFrom('left side'), ...wordsFrom('right side', 5)]
    expect(segmentWords(paused, options).map((clip) => clip.text)).toEqual(['left side', 'right side'])
  })
})

describe('overlayCues', () => {
  const words = wordsFrom('one two three four five six seven eight')

  it('keeps every word, in order, under the Korean cues', () => {
    const clips = overlayCues(words, [
      { start: 0, end: 1.7, text: '첫째' },
      { start: 1.8, end: 3.5, text: '둘째' }
    ])
    expect(clips.map((clip) => clip.text)).toEqual(['첫째', '둘째'])
    expect(clips[0].words.map((w) => w.text)).toEqual(['one', 'two', 'three', 'four'])
    expect(clips[1].words.map((w) => w.text)).toEqual(['five', 'six', 'seven', 'eight'])
  })

  it('attaches words outside any cue to the nearest cue', () => {
    const clips = overlayCues(words, [
      { start: 1, end: 1.2, text: 'a' },
      { start: 2.8, end: 3, text: 'b' }
    ])
    expect(clips.flatMap((clip) => clip.words)).toEqual(words)
    expect(clips[0].words[0].text).toBe('one')
    expect(clips[1].words.at(-1)?.text).toBe('eight')
  })

  it('accepts a subtitle with no words yet and handles unsorted cues', () => {
    const clips = overlayCues([], [
      { start: 5, end: 6, text: 'later' },
      { start: 1, end: 2, text: 'first' }
    ])
    expect(clips.map((clip) => clip.text)).toEqual(['first', 'later'])
  })
})

describe('edits', () => {
  it('splits English exactly on the word and Korean near the same ratio', () => {
    const words = wordsFrom('one two three four')
    const english = splitClip([clipFromWords(words)], 0, 2)
    expect(english.map((clip) => clip.text)).toEqual(['one two', 'three four'])
    expect(english[1].start).toBe(words[2].start)
    expect(english[1].id).not.toBe(english[0].id)

    const korean = splitClip([clipFromWords(words, '가나다 라마바 사아자 차카타')], 0, 2)
    expect(korean.map((clip) => clip.text)).toEqual(['가나다 라마바', '사아자 차카타'])
  })

  it('ignores splits at the edges', () => {
    const clips = [clipFromWords(wordsFrom('one two'))]
    expect(splitClip(clips, 0, 0)).toBe(clips)
    expect(splitClip(clips, 0, 2)).toBe(clips)
  })

  it('merges words, text and timing', () => {
    const clips = segmentWords(wordsFrom('One two. Three four.'), options)
    const [merged] = mergeWithNext(clips, 0)
    expect(joinWords(merged.words)).toBe('One two. Three four.')
    expect(merged.text).toBe('One two. Three four.')
    expect(merged.end).toBe(clips[1].end)
    expect(mergeWithNext(clips, 1)).toBe(clips)
  })

  it('moves a shared word boundary and clamps it inside its neighbours', () => {
    const clips = [clipFromWords(wordsFrom('one two three', 0, 1, 0))]
    const moved = moveEdge(clips, 0, { kind: 'between', word: 0 }, 1.5)
    expect(moved[0].words[0].end).toBe(1.5)
    expect(moved[0].words[1].start).toBe(1.5)
    const clamped = moveEdge(clips, 0, { kind: 'between', word: 0 }, 99)
    expect(clamped[0].words[1].start).toBeLessThan(clamped[0].words[1].end)
    expect(clips[0].words[0].end).toBe(1)
  })

  it('moves clip timing with the outer words and stops at the next clip', () => {
    const clips = segmentWords([...wordsFrom('left.', 0, 1), ...wordsFrom('right.', 3, 1)], options)
    const start = moveEdge(clips, 1, { kind: 'wordStart', word: 0 }, 2)
    expect(start[1].start).toBe(2)
    expect(start[1].words[0].start).toBe(2)
    const end = moveEdge(clips, 0, { kind: 'wordEnd', word: 0 }, 10)
    expect(end[0].end).toBe(3)
    expect(moveEdge(clips, 1, { kind: 'wordStart', word: 0 }, 0)[1].start).toBe(1)
  })

  it('moves clips that have no words', () => {
    const clips: Clip[] = [{ id: 'a', start: 1, end: 2, text: 'x', words: [] }]
    expect(moveEdge(clips, 0, { kind: 'clipEnd' }, 4)[0].end).toBe(4)
    expect(moveEdge(clips, 0, { kind: 'clipStart' }, 5)[0].start).toBeLessThan(2)
  })

  it('applies dictionary to whole terms only, in text and words', () => {
    const dictionary = parseDictionary('RESTful\nrest full => RESTful\ncash => cache\n\n')
    expect(dictionary.hotwords).toBe('RESTful cache')
    const clip = clipFromWords(wordsFrom('rest full APIs and cash, not cashew'))
    const [fixed] = applyDictionary([clip], dictionary)
    expect(fixed.text).toBe('RESTful APIs and cache, not cashew')
    expect(fixed.words[4].text).toBe('cache,')
    expect(fixed.words).toHaveLength(clip.words.length)
  })
})

describe('buildAss', () => {
  it('uses video pixels and escapes override characters', () => {
    const ass = buildAss(
      [{ id: 'a', start: 3661.5, end: 3662.25, text: '<i>첫 줄</i>\n{둘째}', words: [] }],
      { font: 'Malgun Gothic', sizePct: 5, marginPct: 6, box: true },
      1280,
      720
    )
    expect(ass).toContain('PlayResY: 720')
    expect(ass).toContain('Style: Default,Malgun Gothic,36,')
    expect(ass).toContain('Dialogue: 0,1:01:01.50,1:01:02.25,Default,,0,0,0,,첫 줄\\N\\{둘째}')
  })

  it('scales the font by its line height so it matches the preview', () => {
    const style = { font: 'Malgun Gothic', sizePct: 5, marginPct: 6, box: true }
    expect(buildAss([], style, 1280, 720, 1.33)).toContain('Style: Default,Malgun Gothic,48,')
  })
})
