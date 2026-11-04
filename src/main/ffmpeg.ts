import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface Probe {
  duration: number
  width: number
  height: number
  videoCodec: string | null
  audioCodec: string | null
  container: string
}

export async function probe(path: string): Promise<Probe> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', path],
    { maxBuffer: 16 * 1024 * 1024 }
  ).catch((error: NodeJS.ErrnoException) => {
    throw new Error(error.code === 'ENOENT' ? 'ffprobe를 찾을 수 없습니다. ffmpeg를 설치하고 PATH에 추가해 주세요.' : error.message)
  })
  const data = JSON.parse(stdout)
  const streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] = data.streams
  const video = streams.find((stream) => stream.codec_type === 'video')
  const audio = streams.find((stream) => stream.codec_type === 'audio')
  return {
    duration: Number(data.format.duration) || 0,
    width: video?.width ?? 1280,
    height: video?.height ?? 720,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    container: data.format.format_name
  }
}

export interface FfmpegRun {
  duration?: number
  cwd?: string
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

/** Runs ffmpeg to completion, reporting progress from its machine-readable `-progress` stream. */
export function runFfmpeg(args: string[], run: FfmpegRun = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args], {
      cwd: run.cwd,
      signal: run.signal,
      windowsHide: true
    })
    let errors = ''
    child.stderr.on('data', (chunk) => (errors = (errors + chunk).slice(-2000)))
    child.stdout.on('data', (chunk: Buffer) => {
      const match = /out_time_us=(\d+)/.exec(chunk.toString())
      if (match && run.duration) run.onProgress?.(Math.min(1, Number(match[1]) / 1e6 / run.duration))
    })
    // An abort fires 'error' before the process has exited; 'close' is when its files are released.
    child.on('error', (error) => {
      if (error.name !== 'AbortError') reject(error)
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errors.trim() || `ffmpeg 종료 코드 ${code}`))))
  })
}

/** Decodes the audio track and returns 8-bit peaks, `PEAKS_PER_SECOND` values per second. */
export const PEAKS_PER_SECOND = 100
const PEAK_SAMPLE_RATE = 4000

export function extractPeaks(path: string): Promise<Buffer> {
  const samplesPerPeak = PEAK_SAMPLE_RATE / PEAKS_PER_SECOND
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(PEAK_SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
      { windowsHide: true }
    )
    const peaks: number[] = []
    let peak = 0
    let count = 0
    let loudest = 1
    let carry: Buffer = Buffer.alloc(0)

    child.stdout.on('data', (chunk: Buffer) => {
      const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      const usable = data.length - (data.length % 2)
      for (let offset = 0; offset < usable; offset += 2) {
        peak = Math.max(peak, Math.abs(data.readInt16LE(offset)))
        if (++count === samplesPerPeak) {
          peaks.push(peak)
          loudest = Math.max(loudest, peak)
          peak = 0
          count = 0
        }
      }
      carry = data.subarray(usable)
    })
    child.stderr.resume()
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`오디오 파형 추출 실패 (${code})`))
      resolve(Buffer.from(peaks.map((value) => Math.round(Math.sqrt(value / loudest) * 255))))
    })
  })
}
