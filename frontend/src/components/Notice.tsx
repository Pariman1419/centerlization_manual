import React from 'react'

export interface NoticeProps {
  type?: 'success' | 'error' | 'info'
  message?: string
  children?: React.ReactNode
  className?: string
  onDismiss?: () => void
}

export function Notice({
  type = 'success',
  message,
  children,
  className = '',
  onDismiss,
}: NoticeProps) {
  const content = message ?? children
  if (!content) return null

  const isError = type === 'error'
  const isInfo = type === 'info'

  const styleClass = isError
    ? 'border-red-200 bg-red-50 text-red-800'
    : isInfo
    ? 'border-blue-200 bg-blue-50 text-blue-900'
    : 'border-emerald-200 bg-emerald-50 text-emerald-900'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`mb-5 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${styleClass} ${className}`.trim()}
    >
      <div className="flex-1 min-w-0">{content}</div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-black/5 opacity-70 hover:opacity-100 transition-opacity"
        >
          &times;
        </button>
      )}
    </div>
  )
}
