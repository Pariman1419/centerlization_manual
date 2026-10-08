import React from 'react'

export function containsThai(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text)
}

interface UserTextProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'ul' | 'ol' | 'li'
  children?: React.ReactNode
  text?: string
  className?: string
}

export function UserText({
  as: Component = 'span',
  children,
  text,
  className = '',
  ...props
}: UserTextProps) {
  const content = text ?? (typeof children === 'string' ? children : '')
  const hasThai = typeof content === 'string' && containsThai(content)

  const thaiClasses = hasThai ? 'leading-relaxed tracking-normal [word-break:auto-phrase]' : ''
  const combinedClass = `${className} ${thaiClasses}`.trim()

  return (
    <Component
      lang={hasThai ? 'th' : undefined}
      className={combinedClass || undefined}
      {...props}
    >
      {children ?? text}
    </Component>
  )
}
