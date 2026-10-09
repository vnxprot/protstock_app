import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Database, Search, ShieldCheck, X } from 'lucide-react'
import { guideTerms, guideTopics, normalizeGuideText, type GuideStatus, type GuideTerm, type GuideTopic } from '../lib/guideContent'
import './guide-hub.css'

const topicCategories = ['Tổng quan', 'Dữ liệu', 'Tín hiệu', 'Chiến lược', 'Quyết định']
const termGroups = ['Tất cả', ...new Set(guideTerms.map(term => term.group))]
const journey = ['Nguồn dữ liệu', 'Kiểm tra chất lượng', 'Chỉ báo & mẫu hình', 'Engine & quy tắc', 'Cổng rủi ro', 'Tín hiệu công bố', 'Quyết định & nhật ký']
const prompts = [
  { label: 'Vì sao bị WATCH?', query: 'WATCH' },
  { label: 'Dữ liệu cập nhật khi nào?', query: 'độ phủ' },
  { label: 'Điểm 90 nghĩa là gì?', query: 'điểm đồng thuận' },
  { label: 'Challenger có đặt lệnh không?', query: 'Challenger' },
]

function lookupFromHash() {
  const query = location.hash.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  return { topic: params.get('guide'), term: params.get('term') }
}
function navigateTo(id: string, kind: 'guide' | 'term') {
  location.hash = `settings?${kind}=${encodeURIComponent(id)}`
}
function Status({ value }: { value?: GuideStatus }) {
  return value ? <span className={`guide-status guide-status-${value === 'Công bố' ? 'published' : value === 'Nghiên cứu' ? 'research' : value === 'Cá nhân' ? 'personal' : 'limit'}`}>{value}</span> : null
}
function scoreMatch(query: string, title: string, aliases: string[], text: string) {
  if (!query) return 0
  const titleText = normalizeGuideText(title)
  const aliasText = aliases.map(normalizeGuideText)
  const bodyText = normalizeGuideText(text)
  if (titleText === query || aliasText.includes(query)) return 5
  if (titleText.startsWith(query) || aliasText.some(alias => alias.startsWith(query))) return 4
  if (titleText.includes(query) || aliasText.some(alias => alias.includes(query))) return 3
  if (bodyText.includes(query)) return 1
  const words = query.split(/\s+/).filter(Boolean)
  return words.length > 1 && (words.every(word => titleText.includes(word)) || aliasText.some(alias => words.every(word => alias.includes(word)))) ? 2 : 0
}

export function GuideHub({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState('')
  const [termGroup, setTermGroup] = useState('Tất cả')
  const [selected, setSelected] = useState(lookupFromHash)
  const detailRef = useRef<HTMLElement>(null)
  const termRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const sync = () => setSelected(lookupFromHash())
    addEventListener('hashchange', sync)
    return () => removeEventListener('hashchange', sync)
  }, [])
  useEffect(() => {
    const target = selected.term ? termRef.current : selected.topic ? detailRef.current : null
    if (!target) return
    const timer = window.setTimeout(() => { target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }) }, 0)
    return () => window.clearTimeout(timer)
  }, [selected])

  const activeTopic = guideTopics.find(topic => topic.id === selected.topic) ?? null
  const activeTerm = guideTerms.find(term => term.id === selected.term) ?? null
  const needle = normalizeGuideText(search)
  const results = useMemo(() => {
    if (!needle) return []
    const topics = guideTopics.map(item => ({ kind: 'guide' as const, item, score: scoreMatch(needle, item.title, item.aliases ?? [], `${item.summary} ${item.details.join(' ')}`) }))
    const terms = guideTerms.map(item => ({ kind: 'term' as const, item, score: scoreMatch(needle, item.label, item.aliases ?? [], `${item.meaning} ${item.reading}`) }))
    return [...topics, ...terms].filter(result => result.score > 0).sort((a, b) => b.score - a.score || (a.kind === 'guide' ? -1 : 1)).slice(0, 25)
  }, [needle])
  const visibleTerms = guideTerms.filter(term => termGroup === 'Tất cả' || term.group === termGroup)
  const chooseTopic = (topic: GuideTopic) => navigateTo(topic.id, 'guide')
  const chooseTerm = (term: GuideTerm) => navigateTo(term.id, 'term')

  return <div className="guide-hub">
    <header className="guide-hero panel">
      <div className="guide-hero-copy"><span className="guide-eyebrow">BẢN ĐỒ HỆ THỐNG</span><h2>Hiểu Prot Stock, tìm đúng điều cần đọc</h2><p>Từ nguồn dữ liệu đến quyết định cá nhân: xem bức tranh chung, làm theo một quy trình hoặc tra ngay thuật ngữ trên màn hình.</p></div>
      <label className="guide-search"><Search size={20}/><span className="sr-only">Tìm trong Hướng dẫn</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm WATCH, MACD, độ phủ, chiến lược…" aria-controls="guide-search-results"/>{search && <button type="button" aria-label="Xóa từ tìm kiếm" onClick={() => setSearch('')}><X size={18}/></button>}</label>
      {!needle && <div className="guide-prompts" aria-label="Tìm kiếm gợi ý">{prompts.map(prompt => <button type="button" key={prompt.label} onClick={() => setSearch(prompt.query)}>{prompt.label}</button>)}</div>}
    </header>

    {needle && <section id="guide-search-results" className="panel guide-results" aria-live="polite"><div className="guide-section-head"><div><span className="guide-eyebrow">TRA CỨU</span><h3>{results.length ? `${results.length} kết quả phù hợp` : 'Chưa tìm thấy kết quả'}</h3></div><button type="button" className="text-button" onClick={() => setSearch('')}>Xem mục lục</button></div>
      {results.length ? <div className="guide-result-list">{results.map(result => <button key={`${result.kind}-${result.item.id}`} type="button" onClick={() => result.kind === 'guide' ? chooseTopic(result.item) : chooseTerm(result.item)}><span className="guide-result-meta">{result.kind === 'guide' ? `Bài hướng dẫn · ${result.item.category}` : `Từ điển · ${result.item.group} / ${result.item.subgroup}`}</span><strong>{result.kind === 'guide' ? result.item.title : result.item.label}</strong><small>{result.kind === 'guide' ? result.item.summary : result.item.meaning}</small><Status value={result.item.status}/></button>)}</div> : <p>Thử tên tiếng Việt, tiếng Anh, mã kỹ thuật hoặc một từ ngắn hơn. Ví dụ: “WATCH”, “phân kỳ”, “stop”.</p>}
    </section>}

    <nav className="guide-index panel" aria-label="Mục lục Hướng dẫn"><span className="guide-eyebrow">ĐI ĐẾN</span><div>{topicCategories.map(category => <a key={category} href={`#guide-${normalizeGuideText(category).replace(/\s+/g, '-')}`} onClick={event => { event.preventDefault(); document.getElementById(`guide-${normalizeGuideText(category).replace(/\s+/g, '-')}`)?.scrollIntoView({ behavior: 'smooth' }) }}>{category}</a>)}<a href="#guide-dictionary" onClick={event => { event.preventDefault(); document.getElementById('guide-dictionary')?.scrollIntoView({ behavior: 'smooth' }) }}>Từ điển</a><a href="#guide-deep" onClick={event => { event.preventDefault(); document.getElementById('guide-deep')?.scrollIntoView({ behavior: 'smooth' }) }}>Quy tắc chi tiết</a></div></nav>

    <section className="guide-orientation panel" aria-labelledby="guide-orientation-title"><div className="guide-section-head"><div><span className="guide-eyebrow">01 · HIỂU NHANH</span><h3 id="guide-orientation-title">Hệ thống vận hành như thế nào?</h3></div><ShieldCheck size={24}/></div><p>Dữ liệu được kiểm tra trước khi thành tín hiệu. Tín hiệu là giả thuyết có điều kiện; quyết định và nhật ký thuộc về người dùng.</p><ol className="guide-journey">{journey.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></li>)}</ol><div className="guide-start-paths"><button type="button" onClick={() => chooseTopic(guideTopics[1])}><BookOpen size={20}/><span><strong>Bắt đầu sử dụng</strong><small>Đi theo một mã từ dữ liệu đến nhật ký</small></span></button><button type="button" onClick={() => chooseTopic(guideTopics[6])}><ShieldCheck size={20}/><span><strong>Hiểu một tín hiệu</strong><small>Ứng viên, cổng kiểm soát và lý do WATCH</small></span></button><button type="button" onClick={() => document.getElementById('guide-dictionary')?.scrollIntoView({ behavior: 'smooth' })}><Database size={20}/><span><strong>Tra từ điển</strong><small>Thuật ngữ, công thức và chiến lược</small></span></button></div></section>

    <div className="guide-topic-sections">{topicCategories.map(category => <section className="guide-topic-section" id={`guide-${normalizeGuideText(category).replace(/\s+/g, '-')}`} key={category} aria-labelledby={`guide-heading-${normalizeGuideText(category).replace(/\s+/g, '-')}`}><div className="guide-section-head"><div><span className="guide-eyebrow">02 · THEO CHỦ ĐỀ</span><h3 id={`guide-heading-${normalizeGuideText(category).replace(/\s+/g, '-')}`}>{category}</h3></div><small>{guideTopics.filter(item => item.category === category).length} bài</small></div><div className="guide-topic-grid">{guideTopics.filter(item => item.category === category).map(topic => <button type="button" key={topic.id} className={activeTopic?.id === topic.id ? 'guide-topic-card active' : 'guide-topic-card'} onClick={() => chooseTopic(topic)} aria-pressed={activeTopic?.id === topic.id}><span><Status value={topic.status}/></span><strong>{topic.title}</strong><small>{topic.summary}</small></button>)}</div></section>)}</div>

    {activeTopic && <article className="panel guide-article" ref={detailRef} tabIndex={-1} aria-labelledby="guide-active-title"><div className="guide-article-breadcrumb">Hướng dẫn / {activeTopic.category}</div><div className="guide-section-head"><div><h3 id="guide-active-title">{activeTopic.title}</h3><p>{activeTopic.summary}</p></div><Status value={activeTopic.status}/></div>{activeTopic.details.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{activeTopic.route && (isAdmin || !['rules','backtest','portfolio','journal'].includes(activeTopic.route)) && <a className="secondary-button" href={`#${activeTopic.route}`}>{activeTopic.routeLabel ?? 'Mở màn hình liên quan'}</a>}</article>}

    <section className="guide-dictionary panel" id="guide-dictionary" aria-labelledby="guide-dictionary-title"><div className="guide-section-head"><div><span className="guide-eyebrow">03 · TRA CỨU SÂU</span><h3 id="guide-dictionary-title">Từ điển hệ thống</h3><p>Chọn nhóm để xem thuật ngữ, chiến lược, nhãn tín hiệu và cách đọc.</p></div><small>{guideTerms.length} mục</small></div><div className="guide-group-filter" role="group" aria-label="Nhóm từ điển">{termGroups.map(group => <button type="button" key={group} className={termGroup === group ? 'active' : ''} aria-pressed={termGroup === group} onClick={() => setTermGroup(group)}>{group}</button>)}</div><div className="guide-term-table-wrap"><table className="guide-term-table"><thead><tr><th>Nhóm</th><th>Thuật ngữ</th><th>Ý nghĩa ngắn</th><th>Trạng thái</th></tr></thead><tbody>{visibleTerms.map(term => <tr key={term.id}><td><span>{term.subgroup}</span></td><td><button type="button" onClick={() => chooseTerm(term)} aria-expanded={activeTerm?.id === term.id}>{term.label}</button></td><td>{term.meaning}</td><td><Status value={term.status}/></td></tr>)}</tbody></table></div></section>

    {activeTerm && <article className="panel guide-term-detail" ref={termRef} tabIndex={-1} aria-labelledby="guide-term-title"><div className="guide-article-breadcrumb">Từ điển / {activeTerm.group} / {activeTerm.subgroup}</div><div className="guide-section-head"><h3 id="guide-term-title">{activeTerm.label}</h3><Status value={activeTerm.status}/></div><p><strong>Ý nghĩa.</strong> {activeTerm.meaning}</p><p><strong>Cách đọc trong Prot Stock.</strong> {activeTerm.reading}</p>{activeTerm.route && (isAdmin || !['rules','backtest','portfolio','journal'].includes(activeTerm.route)) && <a className="secondary-button" href={`#${activeTerm.route}`}>Mở màn hình liên quan</a>}</article>}
  </div>
}
