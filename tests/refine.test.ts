import { describe, expect, it } from 'vitest'
import { addDictionaryTerms, applyCorrections, describeCorrections, newDictionaryTerms, refineRequest } from '../src/shared/refine'
import type { Clip, Word } from '../src/shared/types'

const word = (text: string, start: number, prob = 0.9): Word => ({ text, start, end: start + 0.4, prob })
function clip(id: string, texts: string, start: number, text?: string): Clip {
  const words = texts.split(' ').map((t, i) => word(t, start + i * 0.5))
  return { id, start, end: words.at(-1)!.end, text: text ?? texts, words }
}
// "inside of Cloud Code go ahead | and connect anthropic pi .dev"
const clips = (): Clip[] => [
  clip('a', 'inside of Cloud Code go ahead', 0),
  { id: 'title', start: 3, end: 3.5, text: '[화면 제목]', words: [] },
  clip('b', 'and connect anthropic pi .dev', 4)
]

describe('English clean-up request', () => {
  it('sends only word texts, the doubtful positions and the dictionary terms', () => {
    const source = clips()
    source[2].words[3].prob = 0.2
    const request = refineRequest(source, 'C:/v/talk.mp4', 'Cloud => Claude\nRailway')
    expect(request.words).toHaveLength(11)
    expect(request.words[9]).toBe('pi')
    expect(request.uncertain).toEqual([9])
    expect(request.glossary).toEqual(['Claude', 'Railway'])
    expect(JSON.stringify(request)).not.toContain('start')
  })
})

describe('corrections', () => {
  const edits = [
    { start: 2, end: 4, text: 'Claude Code,' },
    { start: 0, end: 1, text: 'Inside' },
    { start: 8, end: 11, text: 'Anthropic pi.dev.' },
    { start: 5, end: 7, text: 'ahead. And' },
    { start: 9, end: 10, text: 'overlaps' }
  ]

  it('sorts, classifies by the words themselves and skips what cannot be placed', () => {
    const { corrections, skipped } = describeCorrections(clips(), edits)
    expect(corrections.map(({ start, kind, original }) => [start, kind, original])).toEqual([
      [0, 'style', 'inside'],
      [2, 'word', 'Cloud Code'],
      [5, 'style', 'ahead and'],
      [8, 'word', 'anthropic pi .dev']
    ])
    expect(skipped).toBe(1) // the overlap
    // "ahead and" → "ahead." would leave one new word for two subtitles.
    expect(describeCorrections(clips(), [{ start: 5, end: 7, text: 'ahead.' }])).toEqual({ corrections: [], skipped: 1 })
  })

  it('changes only the texts, keeps every timing and rebuilds recognised subtitle text', () => {
    const source = clips()
    source[2].text = '그리고 연결합니다'
    const { corrections } = describeCorrections(source, edits)
    const result = applyCorrections(source, corrections)
    expect(result[0].text).toBe('Inside of Claude Code, go ahead.')
    expect(result[0].words.map((w) => w.start)).toEqual(source[0].words.map((w) => w.start))
    expect(result[0].start).toBe(source[0].start)
    expect(result[1]).toBe(source[1])
    // Translated text stays; its words are corrected under it.
    expect(result[2].text).toBe('그리고 연결합니다')
    expect(result[2].words.map((w) => w.text)).toEqual(['And', 'connect', 'Anthropic', 'pi.dev.'])
    expect(source[0].words[2].text).toBe('Cloud')
  })

  it('spreads merged words over the time of the words they replace', () => {
    const source = clips()
    const merged = applyCorrections(source, describeCorrections(source, [{ start: 9, end: 11, text: 'pi.dev' }]).corrections)
    const [old1, old2] = [source[2].words[3], source[2].words[4]]
    expect(merged[2].words).toHaveLength(4)
    expect(merged[2].words[3]).toEqual({ text: 'pi.dev', start: old1.start, end: old2.end, prob: 0.9 })
    const split = applyCorrections(source, describeCorrections(source, [{ start: 2, end: 3, text: 'Open Claw' }]).corrections)
    const [open, claw] = split[0].words.slice(2, 4)
    expect([open.start, open.end, claw.start, claw.end]).toEqual([1, 1.2, 1.2, 1.4])
    expect(applyCorrections(source, [])).toBe(source)
  })

  it('suggests the corrected names, not words capitalised to start a sentence', () => {
    const { corrections } = describeCorrections(clips(), [
      { start: 2, end: 4, text: 'Claude Code,' },
      { start: 6, end: 7, text: 'That.' },
      { start: 8, end: 9, text: 'Mistral' },
      { start: 9, end: 11, text: 'OpenAI' }
    ])
    expect(newDictionaryTerms(corrections, 'cloud code => Claude Code', ['Mistral'])).toEqual(['Mistral', 'OpenAI'])
    expect(newDictionaryTerms(corrections, '', [])).toEqual(['Claude Code', 'OpenAI'])
    expect(addDictionaryTerms('Railway\n\n', ['Mistral', 'OpenAI'])).toBe('Railway\nMistral\nOpenAI')
    expect(addDictionaryTerms('', ['Mistral'])).toBe('Mistral')
  })
})
