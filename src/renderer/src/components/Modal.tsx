import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  description?: string
  children: ReactNode
  footer: ReactNode
  onClose?: () => void
  className?: string
}

/** Native modal behavior contains keyboard focus and makes the editor behind it inert. */
export function Modal({ title, description, children, footer, onClose, className = '' }: ModalProps) {
  const element = useRef<HTMLDialogElement>(null)
  const backdropPress = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = element.current
    if (!dialog) return
    const previous = document.activeElement
    dialog.showModal()
    // Focus the dialog itself: screen readers announce the title, Tab reaches the first control,
    // and no focus ring lands on the close button before anyone has pressed a key.
    dialog.focus()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={element}
      className={'modal ' + className}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose?.() }}
      onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget) onClose?.()
        backdropPress.current = false
      }}
    >
      <div className="modal-content">
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          {onClose && (
            <button className="quiet icon-button dialog-close" onClick={onClose} aria-label={title + ' 닫기'} title="닫기 (Esc)">
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </header>
        {description && <p className="dialog-description" id={descriptionId}>{description}</p>}
        <div className="dialog-body">{children}</div>
        <footer className="dialog-footer">{footer}</footer>
      </div>
    </dialog>
  )
}
