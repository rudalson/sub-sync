import { joinWords } from './segment'
import type { Clip, Word } from './types'

const MIN_WORD = 0.02

export type Edge =
  | { kind: 'between'; word: number }
  | { kind: 'wordStart'; word: number }
  | { kind: 'wordEnd'; word: number }
  | { kind: 'clipStart' }
  | { kind: 'clipEnd' }

/** Splits `text` near `ratio`, on a space when one is close. */
function splitText(text: string, ratio: number): [string, string] {
  const target = Math.round(text.length * ratio)
  let cut = target
  for (let distance = 0; distance <= text.length; distance++) {
    if (/\s/.test(text[target - distance] ?? '')) {
      cut = target - distance
      break
    }
    if (/\s/.test(text[target + distance] ?? '')) {
      cut = target + distance
      break
    }
  }
  return [text.slice(0, cut).trim(), text.slice(cut).trim()]
}

/** Splits a clip so that `word` starts the second half. */
export function splitClip(clips: Clip[], index: number, word: number): Clip[] {
  const clip = clips[index]
  if (word <= 0 || word >= clip.words.length) return clips
  const left = clip.words.slice(0, word)
  const right = clip.words.slice(word)
  const untouched = clip.text === joinWords(clip.words)
  const ratio = joinWords(left).length / joinWords(clip.words).length
  const [leftText, rightText] = untouched ? [joinWords(left), joinWords(right)] : splitText(clip.text, ratio)
  return [
    ...clips.slice(0, index),
    { ...clip, end: left[left.length - 1].end, text: leftText, words: left },
    { id: crypto.randomUUID(), start: right[0].start, end: clip.end, text: rightText, words: right },
    ...clips.slice(index + 1)
  ]
}

export function mergeWithNext(clips: Clip[], index: number): Clip[] {
  const clip = clips[index]
  const next = clips[index + 1]
  if (!next) return clips
  const merged: Clip = {
    ...clip,
    end: next.end,
    text: [clip.text, next.text].filter(Boolean).join(' '),
    words: [...clip.words, ...next.words]
  }
  return [...clips.slice(0, index), merged, ...clips.slice(index + 2)]
}

export function removeClip(clips: Clip[], index: number): Clip[] {
  return clips.filter((_, i) => i !== index)
}

export function setClipText(clips: Clip[], index: number, text: string): Clip[] {
  return clips.map((clip, i) => (i === index ? { ...clip, text } : clip))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Moves one timing edge inside a clip, clamped so words and clips cannot cross their neighbours. */
export function moveEdge(clips: Clip[], index: number, edge: Edge, time: number): Clip[] {
  const clip = clips[index]
  const previousEnd = clips[index - 1]?.end ?? 0
  const nextStart = clips[index + 1]?.start ?? Number.POSITIVE_INFINITY
  const words: Word[] = [...clip.words]
  let { start, end } = clip

  const setWord = (i: number, change: Partial<Word>) => {
    words[i] = { ...words[i], ...change }
  }

  switch (edge.kind) {
    case 'clipStart':
      start = clamp(time, previousEnd, end - MIN_WORD)
      break
    case 'clipEnd':
      end = clamp(time, start + MIN_WORD, nextStart)
      break
    case 'between': {
      const value = clamp(time, words[edge.word].start + MIN_WORD, words[edge.word + 1].end - MIN_WORD)
      setWord(edge.word, { end: value })
      setWord(edge.word + 1, { start: value })
      break
    }
    case 'wordStart': {
      const floor = edge.word > 0 ? words[edge.word - 1].end : previousEnd
      const value = clamp(time, floor, words[edge.word].end - MIN_WORD)
      setWord(edge.word, { start: value })
      if (edge.word === 0) start = value
      break
    }
    case 'wordEnd': {
      const isLast = edge.word === words.length - 1
      const ceiling = isLast ? nextStart : words[edge.word + 1].start
      const value = clamp(time, words[edge.word].start + MIN_WORD, ceiling)
      setWord(edge.word, { end: value })
      if (isLast) end = value
      break
    }
  }
  return clips.map((item, i) => (i === index ? { ...item, start, end, words } : item))
}

/** The shortest a clip can be: its last word keeps a sliver of its own. */
export function minClipEnd(clip: Clip): number {
  return (clip.words.at(-1)?.start ?? clip.start) + MIN_WORD
}

/**
 * Sets how long a clip stays on screen by moving its end, never past the next clip's start (or `limit`).
 * A shorter clip cuts its last word.
 */
export function setClipDuration(clips: Clip[], index: number, duration: number, limit = Number.POSITIVE_INFINITY): Clip[] {
  const clip = clips[index]
  const ceiling = Math.min(clips[index + 1]?.start ?? Number.POSITIVE_INFINITY, limit)
  const end = clamp(Math.round((clip.start + duration) * 1000) / 1000, minClipEnd(clip), ceiling)
  if (end === clip.end) return clips
  const last = clip.words.length - 1
  const words = last >= 0 && clip.words[last].end > end
    ? clip.words.map((word, i) => (i === last ? { ...word, end } : word))
    : clip.words
  return clips.map((item, i) => (i === index ? { ...clip, end, words } : item))
}

export interface Dictionary {
  hotwords: string
  replacements: { pattern: RegExp; to: string }[]
}

/** One entry per line: `term` biases recognition, `wrong => right` also rewrites the result. */
export function parseDictionary(source: string): Dictionary {
  const terms: string[] = []
  const replacements: Dictionary['replacements'] = []
  for (const line of source.split(/\r?\n/)) {
    const [from, to] = line.split('=>').map((part) => part.trim())
    if (!from) continue
    terms.push(to || from)
    if (to) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
      replacements.push({ pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), to })
    }
  }
  return { hotwords: [...new Set(terms)].join(' '), replacements }
}

export function applyDictionary(clips: Clip[], dictionary: Dictionary): Clip[] {
  const rewrite = (text: string) =>
    dictionary.replacements.reduce((value, { pattern, to }) => value.replace(pattern, to), text)
  return clips.map((clip) => ({
    ...clip,
    text: rewrite(clip.text),
    words: clip.words.map((word) => ({ ...word, text: rewrite(word.text) }))
  }))
}
