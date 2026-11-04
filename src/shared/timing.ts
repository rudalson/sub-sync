import type { Cue } from './types'

export const MAX_SUBTITLE_GAP = 0.5

/** Derive display/export timing without moving recognised words or the editor's timing anchors. */
export function closeSubtitleGaps<T extends Cue>(cues: T[], maxGap = MAX_SUBTITLE_GAP): T[] {
  const visible = cues.filter((cue) => cue.text.trim() !== '')
  return visible.map((cue, index) => {
    const next = visible[index + 1]
    if (!next) return cue
    const gap = next.start - cue.end
    // Tolerate binary floating-point error at the inclusive threshold.
    return gap > 0 && gap <= maxGap + 1e-9 ? { ...cue, end: next.start } : cue
  })
}
