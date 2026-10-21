import type { ReactNode } from 'react'

export function FilterField({label,children}:{label:string;children:ReactNode}) {
  return <label className="filter-field ui-field"><span className="filter-field-label">{label}</span>{children}</label>
}
