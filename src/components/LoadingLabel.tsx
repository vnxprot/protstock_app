export function LoadingLabel({ children }: { children: string }) {
  return <><span className="inline-spinner" aria-hidden="true"/> {children}</>
}
