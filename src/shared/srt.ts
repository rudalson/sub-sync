import type { Clip, Cue } from './types'
import { visibleCues } from './timing'

const TIMING = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})/

function seconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

export function parseSrt(content: string): Cue[] {
  const lines = content.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  const cues: Cue[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = TIMING.exec(lines[i])
    if (!match) continue
    const text: string[] = []
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') text.push(lines[++i].trim())
    cues.push({
      start: seconds(match[1], match[2], match[3], match[4]),
      end: seconds(match[5], match[6], match[7], match[8]),
      text: text.join('\n')
    })
  }
  return cues
}

export function formatSrtTime(time: number): string {
  const total = Math.max(0, Math.round(time * 1000))
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  const h = Math.floor(total / 3600000)
  const m = Math.floor(total / 60000) % 60
  const s = Math.floor(total / 1000) % 60
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(total % 1000, 3)}`
}

export function serializeSrt(clips: Clip[]): string {
  return visibleCues(clips.map((clip) => ({ ...clip, text: clip.text.replace(/\n\s*\n/g, '\n').trim() })))
    .map((clip, i) => `${i + 1}\n${formatSrtTime(clip.start)} --> ${formatSrtTime(clip.end)}\n${clip.text}\n`)
    .join('\n')
}
