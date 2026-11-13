import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef } from 'react'
import { visibleCues } from '../../../shared/timing'
import { clipIndexAt, usePlayback } from '../player'
import { useStore } from '../store'
import { ClipCard } from './ClipCard'

export function ClipList() {
  const clips = useStore((state) => state.clips)
  const follow = useStore((state) => state.follow)
  const setFollow = useStore((state) => state.setFollow)
  const hasMedia = useStore((state) => state.media !== null)
  const mediaEnd = useStore((state) => state.media?.duration ?? Number.POSITIVE_INFINITY)
  // The highlighted card is the subtitle on screen, so emptied clips are skipped like in the preview.
  const subtitles = useMemo(() => ({
    visible: visibleCues(clips),
    indices: new Map(clips.map((clip, index) => [clip.id, index]))
  }), [clips])
  const active = usePlayback((state) => {
    const clip = subtitles.visible[clipIndexAt(subtitles.visible, state.time)]
    return clip ? subtitles.indices.get(clip.id) ?? -1 : -1
  })
  const scroller = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: clips.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (index) => clips[index].id
  })

  useEffect(() => {
    if (follow && active >= 0) virtualizer.scrollToIndex(active, { align: 'auto' })
  }, [active, follow, virtualizer])

  return (
    <section className="panel" aria-labelledby="subtitle-title">
      <header className="pane-header panel-header">
        <div className="panel-title"><h2 id="subtitle-title">자막 편집</h2><span className="count" aria-label={'자막 ' + clips.length + '개'}>{clips.length.toLocaleString()}</span></div>
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          재생 위치 따라가기
        </label>
      </header>
      {clips.length > 0 && <p className="panel-help">단어를 눌러 이동 · 경계를 드래그해 시간 조절</p>}
      <div className="clip-scroll" ref={scroller}>
        {clips.length === 0 ? (
          <div className="panel-empty">
            <h3>{hasMedia ? '이제 자막을 만들어보세요' : '자막이 여기에 모입니다'}</h3>
            <p>{hasMedia ? '영상의 음성을 인식하거나 기존 SRT 파일을 불러올 수 있습니다.' : '영상을 연 뒤 자막을 생성하거나 SRT 파일을 불러올 수 있습니다.'}</p>
            <div className="empty-actions">
              {hasMedia && <button className="primary" onClick={() => useStore.getState().setDialog('stt')}>자막 생성</button>}
              <button onClick={() => void useStore.getState().loadSrt()}>SRT 불러오기</button>
            </div>
          </div>
        ) : (
          <div className="clip-space" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="clip-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <ClipCard
                  clip={clips[item.index]}
                  index={item.index}
                  active={item.index === active}
                  isLast={item.index === clips.length - 1}
                  limit={clips[item.index + 1]?.start ?? mediaEnd}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
