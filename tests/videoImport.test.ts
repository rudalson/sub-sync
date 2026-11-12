import { describe, expect, it } from 'vitest'
import { parseVideoUrl } from '../src/shared/videoImport'

describe('video import URL validation', () => {
  it('accepts video URLs, preserves query parameters, and trims surrounding whitespace', () => {
    expect(parseVideoUrl('  https://www.youtube.com/watch?v=abc123&list=playlist  '))
      .toBe('https://www.youtube.com/watch?v=abc123&list=playlist')
    expect(parseVideoUrl('https://youtu.be/abc123?t=5')).toBe('https://youtu.be/abc123?t=5')
    expect(parseVideoUrl('http://127.0.0.1:8000/video.mp4')).toBe('http://127.0.0.1:8000/video.mp4')
  })
  it.each(['', 'hello', 'youtube.com/watch?v=abc', 'file:///C:/video.mp4', 'ftp://example.com/video.mp4',
    'javascript:alert(1)', 'https://user:password@example.com/video.mp4', 'https://example.com/ video.mp4'])
  ('rejects invalid or non-web input: %s', (value) => {
    expect(() => parseVideoUrl(value)).toThrow()
  })
})
