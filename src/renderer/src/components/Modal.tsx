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
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={element}
      className={'modal ' + className}
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
          {onClose && <button className="quiet dialog-close" onClick={onClose} aria-label={title + ' 닫기'}>닫기</button>}
        </header>
        {description && <p className="dialog-description" id={descriptionId}>{description}</p>}
        <div className="dialog-body">{children}</div>
        <footer className="dialog-footer">{footer}</footer>
      </div>
    </dialog>
  )
}
