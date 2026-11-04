import type { MediaInfo, ProjectFile } from '../../src/shared/types'

export const media: MediaInfo = {
  path: 'C:\\Videos\\원본.mp4', url: 'media://local/file?path=original', size: 4096,
  duration: 120, width: 1920, height: 1080, hasAudio: true
}

export function makeProject(): ProjectFile {
  return {
    format: 'sub-sync', version: 2,
    media: { path: media.path, size: media.size, duration: media.duration, width: media.width, height: media.height, hasAudio: true },
    clips: [
      {
        id: 'edited', start: 1.125, end: 3.875, text: '수정한 자막\n두 번째 줄',
        words: [{ text: 'Hello', start: 1.125, end: 1.9, prob: 0.987 }, { text: 'world.', start: 2.2, end: 3.875, prob: 1 }]
      },
      { id: 'empty', start: 5, end: 6.25, text: '', words: [] }
    ],
    waveform: { samplesPerSecond: 100, peaks: [0, 12, 128, 255, 90, 0] },
    settings: {
      stt: { model: 'medium.en', language: 'en', device: 'cuda' },
      segment: { maxChars: 50, maxDuration: 7.5, splitOnSentence: false, maxGap: 0.5 },
      style: { font: 'Malgun Gothic', sizePct: 6.5, marginPct: 8, box: false },
      dictionary: 'rest full => RESTful\n고유명사'
    },
    playback: { time: 42.625, rate: 1.25, follow: false },
    srtPath: 'C:\\Videos\\번역.srt'
  }
}
