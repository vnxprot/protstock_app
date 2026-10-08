import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

export type FeedbackTone = 'success' | 'warning' | 'error'
export type FeedbackMessage = { text: string; tone: FeedbackTone }

export function FeedbackToast({ feedback }: { feedback: FeedbackMessage | null }) {
  if (!feedback) return null
  const Icon = feedback.tone === 'success' ? CheckCircle2 : feedback.tone === 'warning' ? AlertTriangle : XCircle
  return <div className="toast" data-tone={feedback.tone} role={feedback.tone === 'error' ? 'alert' : 'status'}><Icon size={18} aria-hidden="true"/>{feedback.text}</div>
}
