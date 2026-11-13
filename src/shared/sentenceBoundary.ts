import type { Clip, SentenceSplitRequest, SentenceSplitResult, Word } from './types'
import { joinWords } from './segment'

export interface UncertaintyReason {
  type: 'no-punctuation' | 'ellipsis' | 'long-pause' | 'too-long' | 'edited-boundary' | 'no-words' | 'wordless-boundary'
  message: string
}

export interface ReconstructedSentence extends Clip {
  isUncertain: boolean
  uncertainties: UncertaintyReason[]
  hasEditedText?: boolean
  preservedWithoutWords?: boolean
}

export interface SentenceBoundaryOptions {
  pauseThreshold?: number
  maxDurationThreshold?: number
  maxWordsThreshold?: number
  preserveEdits?: boolean
}

/** Exclusive word indices returned by the Python/pySBD worker, never guessed in the renderer. */
export function validateSentenceEnds(wordCount: number, ends: readonly number[]): void {
  let previous = 0
  for (const end of ends) {
    if (!Number.isSafeInteger(end) || end <= previous || end > wordCount) {
      throw new Error('문장 분석 결과의 단어 범위가 올바르지 않습니다.')
    }
    previous = end
  }
  if (previous !== wordCount || (wordCount === 0 && ends.length !== 0)) {
    throw new Error('문장 분석 결과에 원문 단어가 누락되어 있습니다.')
  }
}

export function validateWordIntegrity(original: Word[], clips: Array<{ words: Word[] }>) {
  const restored = clips.flatMap((clip) => clip.words)
  const counts = { totalOriginal: original.length, totalReconstructed: restored.length }
  if (original.length !== restored.length) {
    return { valid: false, error: '단어 개수가 일치하지 않습니다.', ...counts }
  }
  for (let i = 0; i < original.length; i++) {
    const a = original[i]
    const b = restored[i]
    if (a.text !== b.text || a.start !== b.start || a.end !== b.end || a.prob !== b.prob) {
      return { valid: false, error: (i + 1) + '번째 단어 또는 시간 정보가 다릅니다.', ...counts }
    }
  }
  return { valid: true, error: undefined as string | undefined, ...counts }
}

/** Wordless SRT/manual captions have no speech anchors, but are still project content. */
export function validateReconstruction(original: Clip[], restored: Clip[]) {
  const integrity = validateWordIntegrity(original.flatMap((clip) => clip.words), restored)
  if (!integrity.valid) return integrity
  const before = original.filter((clip) => clip.words.length === 0)
  const after = restored.filter((clip) => clip.words.length === 0)
  if (before.length !== after.length || before.some((clip, i) =>
    clip.id !== after[i].id || clip.text !== after[i].text || clip.start !== after[i].start || clip.end !== after[i].end
  )) {
    return { ...integrity, valid: false, error: '단어 정보가 없는 자막의 내용 또는 시간이 변경되었습니다.' }
  }
  return integrity
}

export function detectUncertainties(text: string, words: Word[], options: SentenceBoundaryOptions = {}): UncertaintyReason[] {
  const reasons: UncertaintyReason[] = []
  const trimmed = text.trim()
  const ellipsis = /(?:\.\.\.|…)+["'”’)\]]*$/.test(trimmed)
  if (ellipsis) reasons.push({ type: 'ellipsis', message: '말줄임표로 끝난 구간입니다.' })
  if (!ellipsis && !/(?<!\.)[.?!]["'”’)\]]*$/.test(trimmed)) {
    reasons.push({ type: 'no-punctuation', message: '문장 종료 부호(. ? !)가 없습니다.' })
  }
  let maxPause = 0
  for (let i = 1; i < words.length; i++) maxPause = Math.max(maxPause, words[i].start - words[i - 1].end)
  if (maxPause >= (options.pauseThreshold ?? 2)) {
    reasons.push({ type: 'long-pause', message: '문장 내 긴 침묵(' + maxPause.toFixed(1) + '초)이 포함되어 있습니다.' })
  }
  if (isTooLong(words, options)) {
    const duration = words.at(-1)!.end - words[0].start
    reasons.push({ type: 'too-long', message: '구간이 지나치게 깁니다 (' + words.length + '단어, ' + duration.toFixed(1) + '초).' })
  }
  return reasons
}

function isTooLong(words: Word[], options: SentenceBoundaryOptions) {
  const duration = words.length ? words.at(-1)!.end - words[0].start : 0
  return duration >= (options.maxDurationThreshold ?? 15) || words.length >= (options.maxWordsThreshold ?? 40)
}

/** Over this many words the agent also splits a sentence at a clause boundary. */
export const AGENT_SPLIT_MAX_WORDS = 25
/** A gap this long between words is shown to the agent as a hint, never used as a cut. */
const AGENT_PAUSE_HINT = 0.3

/** Words `start` (inclusive) to `end` (exclusive) of the full word list. */
export interface WordSpan {
  start: number
  end: number
}

/** The sentences the review marks too long: usually ones pySBD could not split for lack of full stops. */
export function longSentenceSpans(words: Word[], ends: readonly number[], options: SentenceBoundaryOptions = {}): WordSpan[] {
  validateSentenceEnds(words.length, ends)
  const spans: WordSpan[] = []
  let start = 0
  for (const end of ends) {
    if (end - start > 1 && isTooLong(words.slice(start, end), options)) spans.push({ start, end })
    start = end
  }
  return spans
}

/** Only the word texts and pause positions leave the editor; ids are the spans' positions, from 1. */
export function agentSplitRequest(words: Word[], spans: WordSpan[], maxWords = AGENT_SPLIT_MAX_WORDS): SentenceSplitRequest {
  return {
    maxWords,
    spans: spans.map(({ start, end }, index) => {
      const slice = words.slice(start, end)
      const pauses: number[] = []
      for (let i = 1; i < slice.length; i++) {
        if (slice[i].start - slice[i - 1].end >= AGENT_PAUSE_HINT) pauses.push(i)
      }
      return { id: index + 1, words: slice.map((word) => word.text), pauses }
    })
  }
}

/** Adds the agent's cuts inside each span to the sentence ends, checking every answer again first. */
export function mergeSplitEnds(ends: readonly number[], spans: WordSpan[], results: SentenceSplitResult[]): number[] {
  const byId = new Map(results.map((result) => [result.id, result.ends]))
  const cuts = new Set(ends)
  spans.forEach(({ start, end }, index) => {
    const local = byId.get(index + 1)
    if (!local) throw new Error('Agent 결과에 빠진 문장이 있습니다.')
    validateSentenceEnds(end - start, local)
    for (const cut of local) cuts.add(start + cut)
  })
  const merged = [...cuts].sort((a, b) => a - b)
  validateSentenceEnds(ends.at(-1) ?? 0, merged)
  return merged
}

function sentenceFromWords(words: Word[], options: SentenceBoundaryOptions): ReconstructedSentence {
  const text = joinWords(words)
  const uncertainties = detectUncertainties(text, words, options)
  return {
    id: crypto.randomUUID(), text, start: words[0].start, end: words.at(-1)!.end,
    words, uncertainties, isUncertain: uncertainties.length > 0
  }
}

export function reconstructSentencesFromWords(
  words: Word[], ends: readonly number[], options: SentenceBoundaryOptions = {}
): ReconstructedSentence[] {
  validateSentenceEnds(words.length, ends)
  let start = 0
  return ends.map((end) => {
    const sentence = sentenceFromWords(words.slice(start, end), options)
    start = end
    return sentence
  })
}

/**
 * Edited text is an indivisible source span: remove cuts inside that span rather than
 * copying its entire text into multiple sentences or guessing a translation alignment.
 * Wordless captions are retained verbatim and form barriers between speech runs.
 */
export function reconstructSentencesWithPreservation(
  currentClips: Clip[], sentenceEnds: readonly number[], options: SentenceBoundaryOptions = {}
) {
  const allWords = currentClips.flatMap((clip) => clip.words)
  validateSentenceEnds(allWords.length, sentenceEnds)
  const preserveEdits = options.preserveEdits ?? true
  let offset = 0
  const ranges = currentClips.map((clip, order) => {
    const start = offset
    offset += clip.words.length
    return { clip, order, start, end: offset, edited: clip.words.length > 0 && clip.text !== joinWords(clip.words) }
  })
  const speech = ranges.filter((range) => range.end > range.start)
  const edited = speech.filter((range) => range.edited)
  const cuts = new Set(sentenceEnds)
  const protectedSplits = new Set<string>()
  if (preserveEdits) {
    // Both the cuts and source ranges are ordered; a single pass avoids sentence × clip scans.
    let index = 0
    for (const cut of sentenceEnds) {
      while (index < speech.length && cut >= speech[index].end) index++
      const range = speech[index]
      if (range?.edited && cut > range.start && cut < range.end) {
        cuts.delete(cut)
        protectedSplits.add(range.clip.id)
      }
    }
  }

  const wordless = ranges.filter((range) => range.start === range.end)
  const interrupted = new Set(wordless.filter((range) => range.start > 0 && range.start < allWords.length && !cuts.has(range.start)).map((range) => range.start))
  for (const range of wordless) if (range.start > 0) cuts.add(range.start)
  const effectiveEnds = [...cuts].sort((a, b) => a - b)
  const sentences = reconstructSentencesFromWords(allWords, effectiveEnds, options)
  const preserved = new Set<string>()
  const sourceOrder = new Map<string, number>()
  let start = 0
  let rangeIndex = 0

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    const end = effectiveEnds[i]
    const parts: string[] = []
    let protectedBoundary = false
    while (rangeIndex < speech.length && speech[rangeIndex].end <= start) rangeIndex++
    sourceOrder.set(sentence.id, speech[rangeIndex].order)
    for (let j = rangeIndex; j < speech.length && speech[j].start < end; j++) {
      const range = speech[j]
      if (range.edited && preserveEdits) {
        if (range.start < start || range.end > end || preserved.has(range.clip.id)) {
          throw new Error('수정한 자막을 안전하게 배분할 수 없습니다. 기존 자막을 유지합니다.')
        }
        parts.push(range.clip.text)
        preserved.add(range.clip.id)
        sentence.hasEditedText = true
        protectedBoundary ||= protectedSplits.has(range.clip.id)
      } else {
        parts.push(joinWords(range.clip.words.slice(
          Math.max(start, range.start) - range.start,
          Math.min(end, range.end) - range.start
        )))
      }
    }
    sentence.text = parts.filter((part) => part.length > 0).join(' ')
    if (interrupted.has(start) || interrupted.has(end)) {
      sentence.uncertainties.push({ type: 'wordless-boundary', message: '단어 정보가 없는 자막을 보존하기 위해 구간을 나눴습니다. 앞뒤 문장 연결을 확인해 주세요.' })
      sentence.isUncertain = true
    }
    if (protectedBoundary) {
      sentence.uncertainties.push({
        type: 'edited-boundary',
        message: '수정한 내용의 중복·누락을 막기 위해 이 카드 안의 문장 분할을 보류했습니다.'
      })
      sentence.isUncertain = true
    }
    start = end
  }

  for (const { clip, order } of wordless) {
    sourceOrder.set(clip.id, order)
    sentences.push({
      ...clip, preservedWithoutWords: true, isUncertain: true,
      uncertainties: [{ type: 'no-words', message: '단어 정보가 없어 기존 자막의 내용과 시간을 그대로 유지했습니다.' }]
    })
  }
  sentences.sort((a, b) => a.start - b.start || sourceOrder.get(a.id)! - sourceOrder.get(b.id)!)
  if (preserveEdits && preserved.size !== edited.length) {
    throw new Error('일부 수정한 자막이 보존되지 않아 적용하지 않습니다.')
  }
  return {
    sentences, editedCount: edited.length, preservedCount: preserved.size,
    wordlessCount: wordless.length, integrity: validateReconstruction(currentClips, sentences)
  }
}
