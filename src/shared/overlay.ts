import type { Clip, Cue, Word } from './types'

/**
 * Lays subtitle cues over recognised words. Cue text and timing win, but every word is kept and
 * lands in the cue it was spoken in (or the nearest one), so the word anchors never disappear.
 */
export function overlayCues(words: Word[], cues: Cue[]): Clip[] {
  const clips: Clip[] = [...cues]
    .sort((a, b) => a.start - b.start)
    .map((cue) => ({ id: crypto.randomUUID(), ...cue, words: [] }))
  if (clips.length === 0) return clips

  let index = 0
  for (const word of words) {
    const middle = (word.start + word.end) / 2
    while (index + 1 < clips.length) {
      const current = clips[index]
      const next = clips[index + 1]
      const closerToNext = middle > current.end && middle - current.end > next.start - middle
      if (middle < next.start && !closerToNext) break
      index++
    }
    clips[index].words.push(word)
  }
  return clips
}
