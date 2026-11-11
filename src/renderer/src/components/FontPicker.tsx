import { findFamily, fontLabel, pickFace, weightName } from '../../../shared/fonts'
import type { FontFamily, SubtitleStyle } from '../../../shared/types'
import { useFonts } from '../fonts'
import { useStore } from '../store'

function FamilyOptions({ label, families }: { label: string; families: FontFamily[] }) {
  if (families.length === 0) return null
  return (
    <optgroup label={label}>
      {families.map((family) => <option key={family.family} value={family.family}>{fontLabel(family)}</option>)}
    </optgroup>
  )
}

/** The subtitle font and weight, chosen from the fonts installed on this PC. */
export function FontPicker({ compact = false }: { compact?: boolean }) {
  const style = useStore((state) => state.settings.style)
  const fonts = useFonts()
  const family = fonts ? findFamily(fonts, style.font) : null
  const face = fonts ? pickFace(fonts, style.font, style.weight) : null
  const change = (value: Partial<SubtitleStyle>) => useStore.getState().updateSettings({ style: { ...style, ...value } })

  const chooseFamily = (name: string) => {
    // Keep the weight the user had, as close as the new family allows.
    const next = fonts ? pickFace(fonts, name, style.weight) : null
    change({ font: name, weight: next?.weight ?? style.weight })
  }

  return (
    <div className={compact ? 'font-picker compact' : 'font-picker'}>
      <select
        className="font-family"
        aria-label="자막 글꼴"
        title="자막 글꼴"
        value={family?.family ?? style.font}
        disabled={!fonts}
        onChange={(event) => chooseFamily(event.target.value)}
      >
        {!family && <option value={style.font}>{fonts ? `${style.font} (설치되지 않음)` : style.font}</option>}
        {fonts && <FamilyOptions label="한글 지원" families={fonts.filter((font) => font.hangul)} />}
        {fonts && <FamilyOptions label="영문 글꼴" families={fonts.filter((font) => !font.hangul)} />}
      </select>
      <select
        className="font-weight"
        aria-label="자막 굵기"
        title="자막 굵기"
        value={face?.weight ?? style.weight}
        disabled={!family || family.weights.length < 2}
        onChange={(event) => change({ weight: Number(event.target.value) })}
      >
        {(family?.weights.map((weight) => weight.weight) ?? [style.weight]).map((weight) => (
          <option key={weight} value={weight}>{weightName(weight)}</option>
        ))}
      </select>
    </div>
  )
}
