import { useEffect, useMemo, useRef, useState } from 'react'
import { closeSubtitleGaps } from '../../../shared/timing'
import { attachVideo, clipIndexAt, formatClock, seek, setRate, togglePlay, usePlayback, videoLoaded } from '../player'
import { useStore } from '../store'

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

function useFittedSize(aspect: number) {
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const fitted = width / height > aspect ? { width: height * aspect, height } : { width, height: width / aspect }
      setSize(fitted)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [aspect])
  return { stage, size }
}

function Caption() {
  const clips = useStore((state) => state.clips)
  const style = useStore((state) => state.settings.style)
  const subtitles = useMemo(() => closeSubtitleGaps(clips), [clips])
  const index = usePlayback((state) => clipIndexAt(subtitles, state.time))
  const text = subtitles[index]?.text.trim()
  if (!text) return null
  return (
    <div className="caption" style={{ bottom: `${style.marginPct}cqh`, fontSize: `${style.sizePct}cqh`, fontFamily: style.font }}>
      <span className={style.box ? 'caption-text boxed' : 'caption-text outlined'}>{text}</span>
    </div>
  )
}

function Transport() {
  const time = usePlayback((state) => state.time)
  const duration = usePlayback((state) => state.duration)
  const playing = usePlayback((state) => state.playing)
  const rate = usePlayback((state) => state.rate)
  return (
    <div className="transport">
      <input
        className="seekbar"
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={time}
        onChange={(event) => seek(Number(event.target.value))}
      />
      <div className="transport-row">
        <button className="icon" onClick={togglePlay} aria-label={playing ? '일시정지' : '재생'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="clock">
          {formatClock(time)} / {formatClock(duration)}
        </span>
        <select aria-label="재생 속도" value={rate} onChange={(event) => setRate(Number(event.target.value))}>
          {RATES.map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function Player() {
  const media = useStore((state) => state.media)
  const mediaSession = useStore((state) => state.mediaSession)
  const openMedia = useStore((state) => state.openMedia)
  const { stage, size } = useFittedSize(media ? media.width / media.height : 16 / 9)

  useEffect(() => () => attachVideo(null), [])

  return (
    <section className="player">
      <div className="stage" ref={stage}>
        {media ? (
          <div className="frame" style={size}>
            <video
              key={mediaSession}
              ref={attachVideo}
              src={media.url}
              onClick={togglePlay}
              onLoadedMetadata={(event) => videoLoaded(event.currentTarget)}
              onPlay={() => usePlayback.setState({ playing: true })}
              onPause={() => usePlayback.setState({ playing: false })}
              onError={() => useStore.getState().setMessage('이 영상은 재생할 수 없습니다.')}
            />
            <Caption />
          </div>
        ) : (
          <button className="empty-open" onClick={() => void openMedia()}>
            영상 파일을 열어 시작하세요
          </button>
        )}
      </div>
      <Transport />
    </section>
  )
}
