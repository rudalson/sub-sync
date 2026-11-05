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
      <button disabled={disabled} onClick={onSave} title={label + ' (' + shortcut + ')'}>{label}</button>
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
        >⌄</summary>
        <div className="save-menu-content">
          <button
            disabled={disabled}
            onClick={() => {
              if (menu.current) {
                menu.current.open = false
                menu.current.querySelector('summary')?.focus()
              }
              onSaveAs()
            }}
          >
            <span>{saveAsLabel}</span><kbd>{saveAsShortcut}</kbd>
          </button>
        </div>
      </details>
    </div>
  )
}
