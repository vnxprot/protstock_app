import type { ButtonHTMLAttributes, DetailsHTMLAttributes, ReactNode } from 'react'

export function CardDetailsButton({ context, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { context: string }) {
  return <button {...props} type="button" className={`card-details-button ${className}`} aria-label={`Chi tiết ${context}`}>Chi tiết</button>
}

export function CardHeader({ title, subtitle, status, onDetails }: { title: string; subtitle?: ReactNode; status?: ReactNode; onDetails?: () => void }) {
  return <header className="card-header"><div className="card-header-line"><h3>{title}</h3>{onDetails && <CardDetailsButton context={title} onClick={onDetails}/>}</div>{subtitle && <p className="card-header-subtitle">{subtitle}</p>}{status && <div className="card-header-status">{status}</div>}</header>
}

// Native disclosure keeps keyboard behavior and expansion state for guide/method cards.
export function CardDisclosure({ title, summaryTitle, className = '', children, ...props }: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title'> & { title: ReactNode; summaryTitle?: string }) {
  return <details {...props} className={`card-disclosure ${className}`}><summary title={summaryTitle}><span className="card-disclosure-title">{title}</span><span className="card-details-label">Chi tiết</span></summary>{children}</details>
}
