import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'danger-outline'
  size?: 'normal' | 'small'
  children: React.ReactNode
  className?: string
}

export function Button({
  variant = 'primary',
  size = 'normal',
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'secondary'
      ? 'btn-secondary'
      : variant === 'danger'
      ? 'btn-danger'
      : variant === 'success'
      ? 'btn-success'
      : 'btn-secondary text-red-700 hover:bg-red-50 hover:border-red-300'

  const sizeClass = size === 'small' ? 'btn-small' : ''
  const combined = `${variantClass} ${sizeClass} ${className}`.trim()

  return (
    <button className={combined} disabled={disabled} {...props}>
      {children}
    </button>
  )
}
