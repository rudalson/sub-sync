export const DEFAULT_VIDEO_RATIO = 0.58
export const DIVIDER_WIDTH = 10
export const WORKSPACE_RATIO_KEY = 'sub-sync.workspace.video-ratio.v1'

export function workspaceLimits(width: number): { min: number; max: number } {
  if (!Number.isFinite(width) || width <= 0) return { min: 0.3, max: 0.75 }
  const available = Math.max(1, width - DIVIDER_WIDTH)
  if (available < 760) return { min: 360 / 760, max: 360 / 760 }
  return {
    min: Math.max(0.3, 360 / available),
    max: Math.min(0.75, 1 - 400 / available)
  }
}

export function clampVideoRatio(value: number, width = 0): number {
  const { min, max } = workspaceLimits(width)
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : DEFAULT_VIDEO_RATIO))
}

export function videoRatioAt(clientX: number, left: number, width: number, dividerOffset: number): number {
  return clampVideoRatio((clientX - left - dividerOffset) / Math.max(1, width - DIVIDER_WIDTH), width)
}

export function loadVideoRatio(): number {
  try {
    const saved = window.localStorage.getItem(WORKSPACE_RATIO_KEY)
    return saved?.trim() ? clampVideoRatio(Number(saved)) : DEFAULT_VIDEO_RATIO
  } catch {
    return DEFAULT_VIDEO_RATIO
  }
}

export function saveVideoRatio(ratio: number): void {
  try {
    window.localStorage.setItem(WORKSPACE_RATIO_KEY, String(clampVideoRatio(ratio)))
  } catch {
    // Resizing remains available when browser storage is unavailable.
  }
}
