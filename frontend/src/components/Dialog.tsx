import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

export function Dialog({ title, onClose, busy = false, className = '', children }: {
  title: string; onClose: () => void; busy?: boolean; className?: string; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${className}`}
    onCancel={event => { event.preventDefault(); if (!busy && !ref.current?.querySelector('fieldset')?.disabled) onClose() }}>
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5">
      <h2 id={titleId} className="text-xl font-semibold text-slate-900">{title}</h2>
      <button type="button" aria-label={`Close ${title}`} className="dialog-close" disabled={busy} onClick={() => { if (!busy && !ref.current?.querySelector('fieldset')?.disabled) onClose() }}><Icon name="close" size={18} /></button>
    </div>
    {children}
  </dialog>
}
