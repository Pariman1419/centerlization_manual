import { Link } from 'react-router-dom'
import { Icon } from './Icon'

type BreadcrumbItem = { label: string; to?: string }

export function Breadcrumb({ items, className = '', label = 'Breadcrumb' }: {
  items: BreadcrumbItem[]
  className?: string
  label?: string
}) {
  return (
    <nav aria-label={label} className={`breadcrumb ${className}`}>
      <ol>
        {items.map((item, index) => (
          <li key={index}>
            {index > 0 && <Icon name="chevronRight" size={14} />}
            {item.to
              ? <Link to={item.to}>{item.label}</Link>
              : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function DetailNavigation({ backTo, backLabel, items }: {
  backTo: string
  backLabel: string
  items: BreadcrumbItem[]
}) {
  return (
    <div className="detail-navigation">
      <Link to={backTo} className="detail-back">
        <Icon name="arrowLeft" size={18} />
        <span>{backLabel}</span>
      </Link>
      {items.length > 0 && <Breadcrumb items={items} />}
    </div>
  )
}
