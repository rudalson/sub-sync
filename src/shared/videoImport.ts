/** Validate input before opening a download job; site support is checked by the downloader. */
export function parseVideoUrl(value: string): string {
  const trimmed = value.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('올바른 영상 URL을 입력해 주세요.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || /\s/.test(trimmed) || url.username || url.password) {
    throw new Error('http:// 또는 https://로 시작하는 영상 URL을 입력해 주세요.')
  }
  return url.href
}
