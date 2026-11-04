import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef } from 'react'
import { closeSubtitleGaps } from '../../../shared/timing'
import { clipIndexAt, usePlayback } from '../player'
import { useStore } from '../store'
import { ClipCard } from './ClipCard'

export function ClipList() {
  const clips = useStore((state) => state.clips)
  const follow = useStore((state) => state.follow)
  const setFollow = useStore((state) => state.setFollow)
  const presentation = useMemo(() => {
    const subtitles = closeSubtitleGaps(clips)
    return {
      subtitles,
      byId: new Map(subtitles.map((clip) => [clip.id, clip])),
      indices: new Map(clips.map((clip, index) => [clip.id, index]))
    }
  }, [clips])
  const active = usePlayback((state) => {
    const clip = presentation.subtitles[clipIndexAt(presentation.subtitles, state.time)]
    return clip ? presentation.indices.get(clip.id) ?? -1 : -1
  })
  const scroller = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: clips.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 170,
    overscan: 6,
    getItemKey: (index) => clips[index].id
  })

  useEffect(() => {
    if (follow && active >= 0) virtualizer.scrollToIndex(active, { align: 'auto' })
  }, [active, follow, virtualizer])

  return (
    <section className="panel">
      <div className="panel-header">
        <span>자막 {clips.length}개</span>
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          재생 위치 따라가기
        </label>
      </div>
      <div className="clip-scroll" ref={scroller}>
        {clips.length === 0 ? (
          <p className="panel-empty">영상을 연 뒤 자막 생성을 누르거나 SRT를 불러오세요.</p>
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
                  clip={presentation.byId.get(clips[item.index].id) ?? clips[item.index]}
                  index={item.index}
                  active={item.index === active}
                  isLast={item.index === clips.length - 1}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
