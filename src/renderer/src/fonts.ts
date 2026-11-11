import { useEffect, useState } from 'react'
import { pickFace } from '../../shared/fonts'
import type { FontFace, FontFamily, SubtitleStyle } from '../../shared/types'

/** The preview's own family name, bound by `@font-face` to exactly the face the export uses. */
const CAPTION_FAMILY = 'Sub Sync Caption'

let catalog: Promise<FontFamily[]> | null = null

/** Read once per session; the Rust side scans the font folders on first use. */
export function loadFonts(): Promise<FontFamily[]> {
  catalog ??= Promise.resolve()
    .then(() => window.api.listFonts())
    .then((list) => list ?? [])
    .catch(() => [])
  return catalog
}

export function useFonts(): FontFamily[] | null {
  const [fonts, setFonts] = useState<FontFamily[] | null>(null)
  useEffect(() => {
    let active = true
    void loadFonts().then((list) => { if (active) setFonts(list) })
    return () => { active = false }
  }, [])
  return fonts
}

const quote = (name: string) => `"${name.replace(/["\\]/g, '')}"`

/** The CSS font for the caption: the bound face first, then the family by name if `local()` misses. */
export function captionFont(style: SubtitleStyle, face: FontFace | null) {
  return {
    fontFamily: `${face ? quote(CAPTION_FAMILY) + ', ' : ''}${quote(style.font)}, "Malgun Gothic", sans-serif`,
    fontWeight: face?.weight ?? style.weight
  }
}

/**
 * Picks the installed face for the style and binds the caption family to it by its unique names.
 * Several installed families give every face the same weight class, so naming the face is the only
 * way to show the one libass will draw.
 */
export function useCaptionFace(style: SubtitleStyle): FontFace | null {
  const fonts = useFonts()
  const face = fonts ? pickFace(fonts, style.font, style.weight) : null
  const rule = face
    ? `@font-face { font-family: ${quote(CAPTION_FAMILY)}; src: local(${quote(face.postscript)}), local(${quote(face.fullName)}); font-weight: ${face.weight}; }`
    : ''
  useEffect(() => {
    let element = document.getElementById('caption-face') as HTMLStyleElement | null
    if (!element) {
      element = document.createElement('style')
      element.id = 'caption-face'
      document.head.append(element)
    }
    element.textContent = rule
  }, [rule])
  return face
}
