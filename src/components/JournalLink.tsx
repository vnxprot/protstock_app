import { journalHref, type JournalLaunch } from '../lib/journalModel'
export function JournalLink({context}:{context:JournalLaunch}) {
  return <a className="text-button" href={journalHref(context)}>Ghi quyết định</a>
}
