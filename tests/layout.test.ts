import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampVideoRatio, DEFAULT_VIDEO_RATIO, DIVIDER_WIDTH, loadVideoRatio,
  saveVideoRatio, videoRatioAt, WORKSPACE_RATIO_KEY, workspaceLimits
} from '../src/renderer/src/layout'

let saved: Map<string, string>
beforeEach(() => {
  saved = new Map()
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value)
  } })
})
afterEach(() => vi.unstubAllGlobals())

describe('workspace sizing', () => {
  it.each([780, 1100, 1600, 2560])('keeps both panes usable at width %s', (width) => {
    const available = width - DIVIDER_WIDTH
    for (const preferred of [-1, 0.3, DEFAULT_VIDEO_RATIO, 0.75, 2]) {
      const ratio = clampVideoRatio(preferred, width)
      expect(ratio * available).toBeGreaterThanOrEqual(360 - 1e-6)
      expect((1 - ratio) * available).toBeGreaterThanOrEqual(400 - 1e-6)
      expect(ratio).toBeGreaterThanOrEqual(0.3)
      expect(ratio).toBeLessThanOrEqual(0.75)
    }
  })
  it('shares an unusually narrow window without overflowing', () => {
    const limits = workspaceLimits(500)
    expect(limits.min).toBe(limits.max)
    expect(clampVideoRatio(0, 500)).toBe(limits.min)
    expect(clampVideoRatio(1, 500)).toBe(limits.max)
  })
  it('tracks the pointer without jumping when the handle is grabbed off-center', () => {
    const width = 1600
    const left = 100
    const available = width - DIVIDER_WIDTH
    for (const offset of [1, 5, 9]) {
      expect(videoRatioAt(left + available * 0.58 + offset, left, width, offset)).toBeCloseTo(0.58)
      expect(videoRatioAt(left + available * 0.7 + offset, left, width, offset)).toBeCloseTo(0.7)
    }
    expect(videoRatioAt(-1000, left, width, 5)).toBe(workspaceLimits(width).min)
    expect(videoRatioAt(5000, left, width, 5)).toBe(workspaceLimits(width).max)
  })
  it('remembers the preferred ratio while fitting smaller windows temporarily', () => {
    saveVideoRatio(0.75)
    expect(loadVideoRatio()).toBe(0.75)
    expect(clampVideoRatio(loadVideoRatio(), 1100)).toBeLessThan(0.75)
    expect(loadVideoRatio()).toBe(0.75)
    saveVideoRatio(DEFAULT_VIDEO_RATIO)
    expect(loadVideoRatio()).toBe(DEFAULT_VIDEO_RATIO)
  })
  it.each(['', 'broken', 'NaN', 'Infinity'])('recovers from an invalid saved value %s', (value) => {
    saved.set(WORKSPACE_RATIO_KEY, value)
    expect(loadVideoRatio()).toBe(DEFAULT_VIDEO_RATIO)
  })
  it('continues resizing when storage is unavailable', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('Storage unavailable') } })
    expect(loadVideoRatio()).toBe(DEFAULT_VIDEO_RATIO)
    expect(() => saveVideoRatio(0.7)).not.toThrow()
    expect(clampVideoRatio(0.7, 1600)).toBeCloseTo(0.7)
  })
})
