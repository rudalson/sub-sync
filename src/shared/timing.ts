import type { Cue } from './types'

export const MAX_SUBTITLE_GAP = 1

/** Subtitles that show text; an emptied clip stays in the editor but is never displayed or written out. */
export function visibleCues<T extends Cue>(cues: T[]): T[] {
  return cues.filter((cue) => cue.text.trim() !== '')
}

/**
 * Stretches each subtitle to the next one's start when the gap is at most `maxGap`, skipping empty ones.
 * Only the steps that build subtitles automatically (recognition, re-cutting, sentence grouping) apply it,
 * once, to the clips they create. Loaded SRT and hand-edited timing are shown and saved exactly as they are.
 * Word anchors are not moved.
 */
export function closeSubtitleGaps<T extends Cue>(cues: T[], maxGap = MAX_SUBTITLE_GAP): T[] {
  const result = [...cues]
  let nextStart: number | null = null
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i]
    if (cue.text.trim() === '') continue
    // Tolerate binary floating-point error at the inclusive threshold.
    if (nextStart !== null && nextStart > cue.end && nextStart - cue.end <= maxGap + 1e-9) result[i] = { ...cue, end: nextStart }
    nextStart = cue.start
  }
  return result
}
