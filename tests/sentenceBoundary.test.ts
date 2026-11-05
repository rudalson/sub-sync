import { describe, expect, it } from 'vitest'
import {
  reconstructSentencesFromWords, reconstructSentencesWithPreservation,
  validateReconstruction, validateSentenceEnds, validateWordIntegrity
} from '../src/shared/sentenceBoundary'
import type { Clip, Word } from '../src/shared/types'

const wordsFrom = (text: string, start = 0): Word[] => text.split(' ').map((text, i) => ({
  text, start: start + i * 0.5, end: start + i * 0.5 + 0.4, prob: 0.9
}))
function clip(id: string, raw: string, text = raw, start = 0): Clip {
  const words = wordsFrom(raw, start)
  return { id, text, start: words[0].start, end: words.at(-1)!.end, words }
}
const title: Clip = { id: 'title', text: '[on-screen title]', start: 1, end: 1.8, words: [] }

describe('sentence boundary result contract', () => {
  it('rejects missing, reversed, fractional and out-of-range cuts', () => {
    for (const ends of [[], [0, 3], [2, 1, 3], [1.5, 3], [4]]) {
      expect(() => validateSentenceEnds(3, ends)).toThrow()
    }
    expect(() => validateSentenceEnds(3, [1, 3])).not.toThrow()
    expect(() => validateSentenceEnds(0, [])).not.toThrow()
  })
  it('uses engine boundaries without applying subtitle length or pause limits', () => {
    const first = wordsFrom('This is how you master the art of conversation,')
    const second = wordsFrom("even if you're shy or introverted.", first.at(-1)!.end + 2.5)
    const words = [...first, ...second]
    const result = reconstructSentencesFromWords(words, [words.length], { maxDurationThreshold: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("This is how you master the art of conversation, even if you're shy or introverted.")
    expect(result[0].start).toBe(words[0].start)
    expect(result[0].end).toBe(words.at(-1)!.end)
    expect(result[0].uncertainties.map((reason) => reason.type)).toEqual(['long-pause', 'too-long'])
    expect(validateWordIntegrity(words, result).valid).toBe(true)
  })
  it('marks unfinished and bracket-closed ellipses without losing text', () => {
    for (const [text, type] of [['This has no end', 'no-punctuation'], ['Thinking…]', 'ellipsis'], ['Thinking...)', 'ellipsis']]) {
      const words = wordsFrom(text)
      const result = reconstructSentencesFromWords(words, [words.length])
      expect(result[0].text).toBe(text)
      expect(result[0].uncertainties.map((reason) => reason.type)).toContain(type)
    }
    expect(reconstructSentencesFromWords(wordsFrom('Done.]'), [1])[0].isUncertain).toBe(false)
  })
})

describe('preserving edited and wordless captions', () => {
  it('includes both edited and unedited pieces of the same sentence', () => {
    const clips = [clip('a', 'I like', 'I really like'), clip('b', 'apples.', 'apples.', 1)]
    const snapshot = structuredClone(clips)
    const result = reconstructSentencesWithPreservation(clips, [3])
    expect(result.sentences.map((item) => item.text)).toEqual(['I really like apples.'])
    expect(result.preservedCount).toBe(1)
    expect(result.integrity.valid).toBe(true)
    expect(clips).toEqual(snapshot)
  })
  it('does not copy a multi-sentence edited caption into each reconstructed sentence', () => {
    const clips = [clip('a', 'Hello there. Goodbye now.', 'Edited greeting. Edited farewell.')]
    const result = reconstructSentencesWithPreservation(clips, [2, 4])
    expect(result.sentences.map((item) => item.text)).toEqual(['Edited greeting. Edited farewell.'])
    expect(result.sentences[0].uncertainties.map((reason) => reason.type)).toContain('edited-boundary')
    expect(result.preservedCount).toBe(1)
    expect(result.integrity.valid).toBe(true)
  })
  it('can restore original sentences when edit preservation is explicitly disabled', () => {
    const clips = [clip('a', 'Hello there. Goodbye now.', 'Edited greeting. Edited farewell.')]
    const result = reconstructSentencesWithPreservation(clips, [2, 4], { preserveEdits: false })
    expect(result.sentences.map((item) => item.text)).toEqual(['Hello there.', 'Goodbye now.'])
    expect(result.preservedCount).toBe(0)
    expect(result.integrity.valid).toBe(true)
  })
  it('keeps partial unedited spans on both sides of protected edited content', () => {
    const clips = [
      clip('a', 'One. I', 'One. I'),
      clip('b', 'like green', 'prefer green', 1),
      clip('c', 'apples. Next.', 'apples. Next.', 2)
    ]
    const result = reconstructSentencesWithPreservation(clips, [1, 5, 6])
    expect(result.sentences.map((item) => item.text)).toEqual(['One.', 'I prefer green apples.', 'Next.'])
    expect(result.integrity.valid).toBe(true)
  })
  it('preserves every wordless SRT caption and does not merge across it', () => {
    const clips = [clip('a', 'I like'), title, clip('b', 'apples today.', 'apples today.', 2)]
    const result = reconstructSentencesWithPreservation(clips, [4])
    expect(result.sentences.map((item) => item.text)).toEqual(['I like', title.text, 'apples today.'])
    expect(result.sentences[1]).toMatchObject(title)
    expect(result.wordlessCount).toBe(1)
    expect(result.integrity.valid).toBe(true)
    expect(result.sentences[1].preservedWithoutWords).toBe(true)
    expect(result.sentences[0].uncertainties.map((reason) => reason.type)).toContain('wordless-boundary')
    expect(result.sentences[2].uncertainties.map((reason) => reason.type)).toContain('wordless-boundary')
  })
  it('preserves wordless captions even when edited text resets to the original', () => {
    const clips = [clip('a', 'Hello.', 'Edited greeting.'), title, clip('b', 'Goodbye.', 'Edited farewell.', 2)]
    const result = reconstructSentencesWithPreservation(clips, [2], { preserveEdits: false })
    expect(result.sentences.map((item) => item.text)).toEqual(['Hello.', title.text, 'Goodbye.'])
    expect(result.integrity.valid).toBe(true)
  })
  it('retains leading, trailing, and same-start wordless captions in their original order', () => {
    const leading = { ...title, id: 'leading', start: 0, end: 0.4 }
    const trailing = { ...title, id: 'trailing', start: 2, end: 2.8 }
    const clips = [leading, clip('a', 'Hello.'), trailing]
    const result = reconstructSentencesWithPreservation(clips, [1])
    expect(result.sentences.map((item) => item.id === 'leading' || item.id === 'trailing' ? item.id : 'speech')).toEqual(['leading', 'speech', 'trailing'])
    expect(result.integrity.valid).toBe(true)
  })
  it('keeps a deliberately blank edited caption blank', () => {
    const result = reconstructSentencesWithPreservation([clip('a', 'Hello.', '')], [1])
    expect(result.sentences[0].text).toBe('')
    expect(result.preservedCount).toBe(1)
    expect(result.integrity.valid).toBe(true)
  })
  it('supports projects with no speech anchors without deleting any captions', () => {
    const result = reconstructSentencesWithPreservation([title], [])
    expect(result.sentences).toHaveLength(1)
    expect(result.sentences[0]).toMatchObject(title)
    expect(result.integrity.valid).toBe(true)
  })
  it('rejects loss of wordless content even when every speech word is intact', () => {
    const clips = [clip('a', 'Hello.'), title]
    expect(validateWordIntegrity(clips[0].words, [clips[0]]).valid).toBe(true)
    expect(validateReconstruction(clips, [clips[0]]).valid).toBe(false)
    expect(validateReconstruction(clips, [clips[0], { ...title, text: 'changed' }]).valid).toBe(false)
  })
  it('validates confidence, text, order and timestamp preservation', () => {
    const words = wordsFrom('One two.')
    for (const changed of [
      [words[1], words[0]],
      [{ ...words[0], end: 5 }, words[1]],
      [{ ...words[0], prob: 0 }, words[1]],
      [{ ...words[0], text: 'Changed' }, words[1]]
    ]) expect(validateWordIntegrity(words, [{ words: changed }]).valid).toBe(false)
  })
})
