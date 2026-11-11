import type { FontFace, FontFamily } from './types'

/** Korean names for the usual weight steps; in-between weights take the nearest step's name. */
const WEIGHT_NAMES: [number, string][] = [
  [100, '가장 얇게'], [200, '아주 얇게'], [300, '얇게'], [350, '조금 얇게'], [400, '보통'],
  [500, '중간'], [600, '조금 굵게'], [700, '굵게'], [800, '아주 굵게'], [900, '가장 굵게']
]

export function weightName(weight: number): string {
  const [, name] = WEIGHT_NAMES.reduce((best, step) => (Math.abs(step[0] - weight) < Math.abs(best[0] - weight) ? step : best))
  return `${name} (${weight})`
}

export const fontLabel = (family: FontFamily) => (family.localName ? `${family.localName} (${family.family})` : family.family)

export const findFamily = (families: readonly FontFamily[], font: string) =>
  families.find((family) => family.family.toLowerCase() === font.toLowerCase()) ?? null

/** The installed face closest to the wanted weight; ties go to the heavier one, as CSS does above 500. */
export function pickFace(families: readonly FontFamily[], font: string, weight: number): FontFace | null {
  const family = findFamily(families, font)
  if (!family || family.weights.length === 0) return null
  return family.weights.reduce((best, face) => {
    const distance = Math.abs(face.weight - weight) - Math.abs(best.weight - weight)
    return distance < 0 || (distance === 0 && face.weight > best.weight) ? face : best
  })
}
