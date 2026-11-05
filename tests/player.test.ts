import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachVideo, formatTimecode, usePlayback, videoLoaded } from '../src/renderer/src/player'

class Video extends EventTarget {
  currentTime = 0
  duration = 120
  playbackRate = 1
  paused = true
  ended = false
}
const raf = vi.fn(() => 1)
const cancel = vi.fn()
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  raf.mockClear()
  cancel.mockClear()
  usePlayback.setState(usePlayback.getInitialState(), true)
})
afterEach(() => attachVideo(null))

describe('playback clock', () => {
  it('does not poll the renderer while a video is paused', () => {
    const video = new Video()
    attachVideo(video as unknown as HTMLVideoElement)
    expect(raf).not.toHaveBeenCalled()
    video.currentTime = 20
    video.dispatchEvent(new Event('seeked'))
    expect(usePlayback.getState().time).toBe(20)
    expect(raf).not.toHaveBeenCalled()
  })
  it('updates during play and releases listeners when the video is detached', () => {
    const video = new Video()
    const element = video as unknown as HTMLVideoElement
    videoLoaded(element)
    attachVideo(element)
    video.paused = false
    video.currentTime = 1
    video.dispatchEvent(new Event('play'))
    expect(usePlayback.getState().time).toBe(1)
    expect(raf).toHaveBeenCalledTimes(1)
    video.paused = true
    video.dispatchEvent(new Event('pause'))
    expect(cancel).toHaveBeenCalled()
    attachVideo(null)
    video.currentTime = 2
    video.dispatchEvent(new Event('seeked'))
    expect(usePlayback.getState().time).toBe(1)
  })
})

describe('editing timecodes', () => {
  it('shows the sub-second boundaries used in subtitle editing', () => {
    expect(formatTimecode(5.98)).toBe('00:05.980')
    expect(formatTimecode(7.56)).toBe('00:07.560')
  })
  it('carries rounded milliseconds across minute and hour boundaries', () => {
    expect(formatTimecode(59.9996)).toBe('01:00.000')
    expect(formatTimecode(3599.9996)).toBe('01:00:00.000')
    expect(formatTimecode(3661.1234)).toBe('01:01:01.123')
  })
  it('keeps unavailable or negative playback times readable', () => {
    expect(formatTimecode(-1)).toBe('00:00.000')
    expect(formatTimecode(Number.NaN)).toBe('00:00.000')
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe('00:00.000')
  })
})
