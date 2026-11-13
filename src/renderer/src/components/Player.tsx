import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { visibleCues } from '../../../shared/timing'
import { attachVideo, clipIndexAt, formatClock, formatTimecode, seek, seekBy, setRate, togglePlay, usePlayback, videoLoaded } from '../player'
import { captionFont, useCaptionFace } from '../fonts'
import { useStore } from '../store'
import { FontPicker } from './FontPicker'

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
  const subtitles = useMemo(() => visibleCues(clips), [clips])
  const index = usePlayback((state) => clipIndexAt(subtitles, state.time))
  const face = useCaptionFace(style)
  const text = subtitles[index]?.text.trim()
  if (!text) return null
  return (
    <div className="caption" style={{ bottom: `${style.marginPct}cqh`, fontSize: `${style.sizePct}cqh`, ...captionFont(style, face) }}>
      <span className={style.box ? 'caption-text boxed' : 'caption-text outlined'}>{text}</span>
    </div>
  )
}

function Transport({ hasMedia }: { hasMedia: boolean }) {
  const time = usePlayback((state) => state.time)
  const duration = usePlayback((state) => state.duration)
  const playing = usePlayback((state) => state.playing)
  const rate = usePlayback((state) => state.rate)
  return (
    <div className="transport">
      <input
        className="seekbar"
        aria-label="영상 재생 위치"
        aria-valuetext={formatTimecode(time) + ' / ' + formatTimecode(duration)}
        type="range"
        disabled={!hasMedia}
        min={0}
        max={duration || 0}
        step={0.01}
        value={time}
        style={{ '--seek-progress': (duration ? Math.min(100, time / duration * 100) : 0) + '%' } as CSSProperties}
        onChange={(event) => seek(Number(event.target.value))}
      />
      <div className="transport-row">
        <div className="playback-actions">
          <button className="quiet seek-button" disabled={!hasMedia} onClick={() => seekBy(-1)} aria-label="1초 뒤로" title="1초 뒤로 (←)">−1초</button>
          <button className="play-button" disabled={!hasMedia} onClick={togglePlay} title="재생·일시정지 (Space)">{playing ? '일시정지' : '재생'}</button>
          <button className="quiet seek-button" disabled={!hasMedia} onClick={() => seekBy(1)} aria-label="1초 앞으로" title="1초 앞으로 (→)">+1초</button>
        </div>
        <div className="clock"><strong>{formatTimecode(time)}</strong><span>/ {formatTimecode(duration)}</span></div>
        <label className="rate-label"><span>재생 속도</span>
          <select aria-label="재생 속도" disabled={!hasMedia} value={rate} onChange={(event) => setRate(Number(event.target.value))}>
            {RATES.map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}

export function Player() {
  const media = useStore((state) => state.media)
  const mediaSession = useStore((state) => state.mediaSession)
  const openMedia = useStore((state) => state.openMedia)
  const { stage, size } = useFittedSize(media ? media.width / media.height : 16 / 9)

  return (
    <section className="player" id="video-pane" aria-labelledby="video-title">
      <header className="pane-header video-header">
        <h1 id="video-title">영상 미리보기</h1>
        {media && (
          <div className="pane-tools">
            <FontPicker compact />
            <span className="pane-meta" title={media.path}>{media.width}×{media.height} · {formatClock(media.duration)}</span>
          </div>
        )}
      </header>
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
          <div className="start-state">
            <h2>편집할 영상을 열어주세요</h2>
            <p>음성을 자막으로 만들고,<br />단어의 타이밍과 문장을 다듬어보세요.</p>
            <button className="primary large" onClick={() => void openMedia()}>영상 열기</button>
            <button className="quiet resume" onClick={() => void useStore.getState().openProject()}>이전에 저장한 프로젝트 열기</button>
          </div>
        )}
      </div>
      <Transport hasMedia={media !== null} />
    </section>
  )
}
