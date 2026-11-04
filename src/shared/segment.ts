import type { Clip, SegmentOptions, Word } from './types'

const CLOSERS = '["\'\\u201D\\u2019)\\]]*$'
const SENTENCE_END = new RegExp(`[.?!\\u2026]${CLOSERS}`)
const SOFT_BREAK = new RegExp(`[,;:\\u2014\\u2013]${CLOSERS}`)

export const joinWords = (words: Word[]): string => words.map((word) => word.text).join(' ')

export function clipFromWords(words: Word[], text = joinWords(words)): Clip {
  return { id: crypto.randomUUID(), start: words[0].start, end: words[words.length - 1].end, text, words }
}

function overflows(current: Word[], word: Word, options: SegmentOptions): boolean {
  const chars = joinWords(current).length + 1 + word.text.length
  return chars > options.maxChars || word.end - current[0].start > options.maxDuration
}

/** Where to cut an overflowing run: the last comma in its second half, else its end. */
function softBreakIndex(words: Word[]): number {
  for (let i = words.length - 1; i >= Math.ceil(words.length / 2); i--) {
    if (SOFT_BREAK.test(words[i].text)) return i + 1
  }
  return words.length
}

export function segmentWords(words: Word[], options: SegmentOptions): Clip[] {
  const clips: Clip[] = []
  let current: Word[] = []
  const flush = (run: Word[]) => {
    if (run.length > 0) clips.push(clipFromWords(run))
  }

  words.forEach((word, i) => {
    if (current.length > 0 && overflows(current, word, options)) {
      const cut = softBreakIndex(current)
      flush(current.slice(0, cut))
      current = current.slice(cut)
    }
    current.push(word)

    const next = words[i + 1]
    const sentenceDone = options.splitOnSentence && SENTENCE_END.test(word.text)
    const longPause = next !== undefined && next.start - word.end >= options.maxGap
    if (sentenceDone || longPause) {
      flush(current)
      current = []
    }
  })
  flush(current)
  return clips
}
