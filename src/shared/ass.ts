import type { Clip, FontFace, SubtitleStyle } from './types'
import { visibleCues } from './timing'

function assTime(time: number): string {
  const total = Math.max(0, Math.round(time * 100))
  const h = Math.floor(total / 360000)
  const m = Math.floor(total / 6000) % 60
  const s = Math.floor(total / 100) % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}.${pad(total % 100)}`
}

function assText(text: string): string {
  return text
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\\/g, '\\​')
    .replace(/\{/g, '\\{')
    .replace(/\r?\n/g, '\\N')
}

/**
 * ASS sizes a font by its full line height while CSS sizes it by the em box, so `lineRatio`
 * (line height / em of the chosen font) keeps the export the same size as the on-screen preview.
 * With an installed `face`, libass is given that face's full name ("Pretendard SemiBold") and no
 * bold flag, which selects exactly the face the preview shows instead of a synthesized bold.
 */
export function buildAss(clips: Clip[], style: SubtitleStyle, width: number, height: number, lineRatio = 1, face: FontFace | null = null): string {
  const size = Math.round((height * style.sizePct) / 100)
  const assSize = Math.round(size * lineRatio)
  const marginV = Math.round((height * style.marginPct) / 100)
  const marginH = Math.round(width * 0.03)
  const borderStyle = style.box ? 3 : 1
  const outline = style.box ? Math.round(size * 0.18) : Math.max(1, Math.round(size * 0.08))
  const outlineColour = style.box ? '&H59000000' : '&H00000000'
  const fontName = (face?.fullName ?? style.font).replace(/,/g, ' ')
  const bold = face ? 0 : (style.weight ?? 700) >= 600 ? -1 : 0

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${assSize},&H00FFFFFF,&H00FFFFFF,${outlineColour},&H00000000,${bold},0,0,0,100,100,0,0,${borderStyle},${outline},0,2,${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  const events = visibleCues(clips)
    .map((clip) => `Dialogue: 0,${assTime(clip.start)},${assTime(clip.end)},Default,,0,0,0,,${assText(clip.text.trim())}`)
  return [...header, ...events, ''].join('\n')
}
