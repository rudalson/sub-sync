import { create } from 'zustand'
import type { Clip, Word } from '../../shared/types'

interface Playback {
  time: number
  duration: number
  playing: boolean
  rate: number
}

export const usePlayback = create<Playback>(() => ({ time: 0, duration: 0, playing: false, rate: 1 }))

let video: HTMLVideoElement | null = null
let frame = 0
let pendingPlayback: { time: number; rate: number } | null = null

function tick() {
  if (video && !pendingPlayback) usePlayback.setState({ time: video.currentTime })
  frame = requestAnimationFrame(tick)
}

export function attachVideo(element: HTMLVideoElement | null) {
  video = element
  cancelAnimationFrame(frame)
  if (element) frame = requestAnimationFrame(tick)
}

/** Hold the saved position until the new video's metadata is available, including reopening the same video. */
export function restorePlayback(playback: { time: number; rate: number }, duration: number) {
  video?.pause()
  pendingPlayback = { time: Math.min(playback.time, duration), rate: playback.rate }
  usePlayback.setState({ ...pendingPlayback, duration, playing: false })
}

export function videoLoaded(element: HTMLVideoElement) {
  const playback = pendingPlayback ?? { time: 0, rate: usePlayback.getState().rate }
  pendingPlayback = null
  element.currentTime = Math.min(playback.time, element.duration)
  element.playbackRate = playback.rate
  usePlayback.setState({ time: element.currentTime, duration: element.duration, rate: element.playbackRate, playing: false })
}

export function seek(time: number) {
  if (!video) return
  video.currentTime = Math.max(0, time)
  usePlayback.setState({ time: video.currentTime })
}

export function seekBy(delta: number) {
  if (video) seek(video.currentTime + delta)
}

export function togglePlay() {
  if (!video) return
  if (video.paused) void video.play()
  else video.pause()
}

export function setRate(rate: number) {
  if (video) video.playbackRate = rate
  usePlayback.setState({ rate })
}

/** Index of the clip on screen at `time`, or -1 during a pause between clips. */
export function clipIndexAt(clips: Clip[], time: number): number {
  let low = 0
  let high = clips.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (time < clips[middle].start) high = middle - 1
    else if (time >= clips[middle].end) low = middle + 1
    else return middle
  }
  return -1
}

export function wordIndexAt(words: Word[], time: number): number {
  return words.findIndex((word) => time >= word.start && time < word.end)
}

export function formatClock(time: number): string {
  const total = Math.max(0, Math.floor(time))
  const h = Math.floor(total / 3600)
  const m = Math.floor(total / 60) % 60
  const s = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
