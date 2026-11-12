import { joinWords } from './segment'
import type { Clip, TranslateCue } from './types'

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/

/**
 * The English to translate for each subtitle: its text, or its recognised words once a Korean
 * subtitle has replaced the text. Ids are positions (1-based), so the agent never sees timestamps.
 */
export function translationCues(clips: Clip[]): TranslateCue[] {
  return clips.flatMap((clip, index) => {
    const text = (HANGUL.test(clip.text) ? joinWords(clip.words) : clip.text).replace(/\s+/g, ' ').trim()
    return text ? [{ id: index + 1, text }] : []
  })
}

/** Terms from the word dictionary (`term`, or the right side of `wrong => right`), kept as written. */
export function glossaryTerms(dictionary: string): string[] {
  const terms = dictionary.split(/\r?\n/).map((line) => {
    const [from, to] = line.split('=>').map((part) => part.trim())
    return to || from
  })
  return [...new Set(terms.filter(Boolean))]
}

/**
 * Puts each translation on the subtitle it was made from (`source`, the clips the cues were built
 * from), found by clip id in `clips` so edits made meanwhile keep their place. Timing and words stay.
 */
export function applyTranslations(clips: Clip[], source: Clip[], translations: TranslateCue[]): Clip[] {
  const byId = new Map(translations.flatMap((line) => {
    const clip = source[line.id - 1]
    return clip ? [[clip.id, line.text] as const] : []
  }))
  return clips.map((clip) => {
    const text = byId.get(clip.id)
    return text === undefined ? clip : { ...clip, text }
  })
}

export const translationTarget = (stem: string) => `${stem}.ko.srt`
