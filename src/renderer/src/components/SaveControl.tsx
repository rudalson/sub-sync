import { ChevronDown, FilePenLine, Save } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface SaveControlProps {
  label: string
  disabled: boolean
  shortcut: string
  saveAsLabel: string
  saveAsShortcut: string
  onSave: () => void
  onSaveAs: () => void
}

export function SaveControl({ label, disabled, shortcut, saveAsLabel, saveAsShortcut, onSave, onSaveAs }: SaveControlProps) {
  const menu = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (disabled && menu.current) menu.current.open = false
  }, [disabled])

  useEffect(() => {
    const element = menu.current
    if (!element) return
    const onPointerDown = (event: PointerEvent) => {
      if (element.open && event.target instanceof Node && !element.contains(event.target)) element.open = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !element.open) return
      event.preventDefault()
      element.open = false
      element.querySelector('summary')?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className="save-control">
      <button disabled={disabled} onClick={onSave} title={label + ' (' + shortcut + ')'}>
        <Save size={16} aria-hidden="true" />{label}
      </button>
      <details
        className="save-menu"
        ref={menu}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
        }}
      >
        <summary
          aria-label={label + ' 옵션'}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          title={label + ' 옵션'}
          onClick={(event) => { if (disabled) event.preventDefault() }}
        ><ChevronDown size={16} strokeWidth={2} aria-hidden="true" /></summary>
        <div className="save-menu-content">
          <button
            disabled={disabled}
            onClick={(event) => {
              if (menu.current) {
                menu.current.open = false
                // Return focus only for keyboard use; a mouse user's Space must keep controlling playback.
                if (event.detail === 0) menu.current.querySelector('summary')?.focus()
              }
              onSaveAs()
            }}
          >
            <span className="save-menu-label"><FilePenLine size={16} aria-hidden="true" />{saveAsLabel}</span>
            <kbd>{saveAsShortcut}</kbd>
          </button>
        </div>
      </details>
    </div>
  )
}
