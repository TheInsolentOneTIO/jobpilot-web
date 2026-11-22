import {memo, useEffect, useRef, useState} from 'react'
import {ArrowUpRight, ChevronDown} from 'lucide-react'

function plainText(value) {
  if (typeof value !== 'string') return ''
  if (!/[<&]/.test(value)) return value.trim()
  // Source descriptions may contain HTML. Read only text from an inert fragment.
  const template = document.createElement('template')
  template.innerHTML = value
  const fragment = template.content
  fragment.querySelectorAll('script, style, template').forEach(node => node.remove())
  fragment.querySelectorAll('li').forEach(node => {
    if (node.textContent.trim()) node.prepend('• ')
  })
  fragment.querySelectorAll('br, p, div, li, tr').forEach(node => node.after('\n'))
  return fragment.textContent.replace(/\u00a0/g, ' ').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim()
}

const years = new Intl.NumberFormat('ru', {style: 'unit', unit: 'year', unitDisplay: 'long'})
function experienceText(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const count = Number(value)
    if (count === 0) return 'Без опыта'
    return Number.isInteger(count) && count > 0 ? years.format(count) : ''
  }
  return plainText(value)
}

function joinText(...values) {
  return [...new Set(values.map(plainText).filter(Boolean))].join('\n')
}

function originalUrl(value) {
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol)) return url
  } catch { /* Some older records have no URL. */ }
  return null
}

function addresses(job) {
  return joinText(...(Array.isArray(job.work_addresses) ? job.work_addresses : []), job.work_address)
}

export default memo(function VacancyDetails({job, apiUrl, onLoaded}) {
  const [open, setOpen] = useState(false)
  const [extra, setExtra] = useState(null), [status, setStatus] = useState('idle')
  const request = useRef(null)
  useEffect(() => () => request.current?.abort(), [])
  const url = originalUrl(job.url)
  const conditions = {...job.work_conditions}
  for (const [key, value] of Object.entries(extra?.work_conditions || {})) {
    if (value != null && value !== '') conditions[key] = value
  }
  const address = addresses(extra || {}) || addresses(job)

  async function toggle() {
    setOpen(!open)
    if (open || extra || request.current || !url || !['trudvsem.ru', 'www.trudvsem.ru'].includes(url.hostname)) return
    if (plainText(conditions.duty) && address) return
    const ids = url.pathname.match(/^\/vacancy\/card\/([\w-]{1,64})\/([\w-]{1,64})\/?$/)
    if (!ids) return
    const controller = new AbortController()
    request.current = controller
    setStatus('loading')
    try {
      const response = await fetch(`${apiUrl}/api/vacancies/${ids[1]}/${ids[2]}`, {signal: controller.signal})
      if (!response.ok) throw new Error()
      const item = await response.json()
      if (item.id !== job.id) throw new Error()
      if (!controller.signal.aborted) {
        setExtra(item)
        setStatus('ready')
        onLoaded(job.id, {
          schedule: item.work_conditions?.schedule || conditions.schedule,
          employment: item.work_conditions?.employment || conditions.employment,
        })
      }
    } catch {
      if (!controller.signal.aborted) setStatus('error')
    } finally {
      request.current = null
    }
  }
  const rows = open ? [
    ['Должностные обязанности', plainText(conditions.duty)],
    ['Место работы', address || plainText(extra?.city || job.city)],
    ['Описание', plainText(conditions.description)],
    ['Требования', joinText(conditions.requirements, conditions.qualification)],
    ['Образование', plainText(conditions.required_education) || plainText(conditions.education)],
    ['Опыт', experienceText(conditions.experience_years ?? conditions.experience)],
    ['График', plainText(conditions.schedule)],
    ['Занятость', plainText(conditions.employment)],
    ['Условия', joinText(conditions.conditions, conditions.terms)],
  ].filter(([, text]) => text) : []
  return <div className="vacancy-details">
    <button type="button" aria-expanded={open} aria-controls="vacancy-description" onClick={toggle}>
      Подробнее о вакансии <ChevronDown aria-hidden="true"/>
    </button>
    <div id="vacancy-description" className="details-body" hidden={!open} tabIndex={0} role="region" aria-label="Подробности вакансии">
      {open && url && <a className="original-vacancy" href={url.href} target="_blank" rel="noopener noreferrer">
        Открыть вакансию на «Работе России» <ArrowUpRight aria-hidden="true"/>
      </a>}
      {open && status === 'loading' && <p role="status">Загружаем подробности…</p>}
      {open && status === 'error' && <p role="status">Не удалось загрузить полные сведения.</p>}
      {open && (rows.length ? <dl>{rows.map(([label, text]) =>
        <div key={label}><dt>{label}</dt><dd>{text}</dd></div>
      )}</dl> : status !== 'loading' && status !== 'error' && <p>Дополнительных сведений в ответе нет.</p>)}
    </div>
  </div>
})
