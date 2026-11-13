import { joinWords } from './segment'
import { glossaryTerms } from './translate'
import type { Clip, RefineEdit, RefineRequest, Word } from './types'

/** Words recognised with less confidence than this are pointed out to the agent. */
const UNCERTAIN_PROB = 0.5

/** Only the word texts leave the editor, with the positions of the doubtful ones. */
export function refineRequest(clips: Clip[], mediaPath: string, dictionary: string): RefineRequest {
  const words = clips.flatMap((clip) => clip.words)
  return {
    mediaPath,
    words: words.map((word) => word.text),
    uncertain: words.flatMap((word, index) => (word.prob !== undefined && word.prob < UNCERTAIN_PROB ? [index] : [])),
    glossary: glossaryTerms(dictionary)
  }
}

export interface Correction extends RefineEdit {
  /** The recognised words it replaces. */
  original: string
  /**
   * 'style' only changes capitals and punctuation, so the whole set is applied together;
   * 'word' changes what was heard and is reviewed one by one.
   */
  kind: 'word' | 'style'
}

const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const tokens = (text: string) => text.split(/\s+/).filter(Boolean)

/**
 * The agent's edits as reviewable corrections, classified here rather than trusted. An edit that
 * changes the word count across two subtitles is skipped: its new words would belong to neither.
 */
export function describeCorrections(clips: Clip[], edits: RefineEdit[]): { corrections: Correction[]; skipped: number } {
  const words = clips.flatMap((clip) => clip.words)
  const owner = clips.flatMap((clip, index) => clip.words.map(() => index))
  const corrections: Correction[] = []
  let skipped = 0
  let previousEnd = 0
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    const replacement = tokens(edit.text)
    const valid = Number.isSafeInteger(edit.start) && Number.isSafeInteger(edit.end) &&
      edit.start >= previousEnd && edit.start < edit.end && edit.end <= words.length && replacement.length > 0
    if (!valid || (replacement.length !== edit.end - edit.start && owner[edit.start] !== owner[edit.end - 1])) {
      skipped++
      continue
    }
    const original = words.slice(edit.start, edit.end).map((word) => word.text)
    const style = original.length === replacement.length && original.every((word, i) => bare(word) === bare(replacement[i]))
    corrections.push({ start: edit.start, end: edit.end, text: replacement.join(' '), original: original.join(' '), kind: style ? 'style' : 'word' })
    previousEnd = edit.end
  }
  return { corrections, skipped }
}

/** New words over the span of the old ones, each lasting in proportion to its length. */
function spread(old: Word[], texts: string[]): Word[] {
  const start = old[0].start
  const span = old.at(-1)!.end - start
  const total = texts.reduce((sum, text) => sum + text.length, 0)
  const probs = old.flatMap((word) => (word.prob === undefined ? [] : [word.prob]))
  const round = (time: number) => Math.round(time * 1000) / 1000
  let done = 0
  return texts.map((text) => {
    const word: Word = { text, start: round(start + (span * done) / total), end: round(start + (span * (done + text.length)) / total) }
    if (probs.length) word.prob = Math.min(...probs)
    done += text.length
    return word
  })
}

/**
 * Applies chosen corrections to the words. A subtitle whose text still is its recognised words
 * takes the corrected words as its text; one edited by hand or translated keeps its text.
 */
export function applyCorrections(clips: Clip[], corrections: Correction[]): Clip[] {
  if (corrections.length === 0) return clips
  const all = clips.flatMap((clip) => clip.words)
  const next: Word[][] = all.map((word) => [word])
  for (const correction of corrections) {
    const old = all.slice(correction.start, correction.end)
    const texts = tokens(correction.text)
    if (texts.length === old.length) {
      texts.forEach((text, i) => { next[correction.start + i] = [{ ...old[i], text }] })
    } else {
      next[correction.start] = spread(old, texts)
      for (let i = correction.start + 1; i < correction.end; i++) next[i] = []
    }
  }
  let offset = 0
  return clips.map((clip) => {
    const count = clip.words.length
    if (count === 0) return clip
    const words = next.slice(offset, offset + count).flat()
    offset += count
    if (words.length === count && words.every((word, i) => word === clip.words[i])) return clip
    return { ...clip, words, text: clip.text === joinWords(clip.words) ? joinWords(words) : clip.text }
  })
}

/**
 * Names fixed by the chosen word corrections that the dictionary does not have yet, so the next
 * recognition hears them and the translation keeps their spelling. A name is one the overview
 * listed for this video, or one spelled with a capital or digit past its first letter ("OpenAI");
 * a word merely capitalised to start a sentence is neither.
 */
export function newDictionaryTerms(corrections: Correction[], dictionary: string, videoTerms: string[]): string[] {
  const known = new Set(glossaryTerms(dictionary).map((term) => term.toLowerCase()))
  const listed = new Set(videoTerms.map((term) => term.toLowerCase()))
  const terms = new Map<string, string>()
  for (const { kind, text } of corrections) {
    const term = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    const key = term.toLowerCase()
    const named = listed.has(key) || /.[\p{Lu}\p{N}]/u.test(term)
    if (kind === 'word' && term && named && !known.has(key)) terms.set(key, term)
  }
  return [...terms.values()]
}

export function addDictionaryTerms(dictionary: string, terms: string[]): string {
  if (terms.length === 0) return dictionary
  const lines = dictionary.replace(/\s+$/, '')
  return (lines ? lines + '\n' : '') + terms.join('\n')
}
