import {memo, useState} from 'react'
import {ChevronDown} from 'lucide-react'

function plainText(value) {
  if (typeof value !== 'string') return ''
  if (!/[<&]/.test(value)) return value.trim()
  // Source descriptions may contain HTML. Read only text from an inert fragment.
  const template = document.createElement('template')
  template.innerHTML = value
  const fragment = template.content
  fragment.querySelectorAll('script, style, template').forEach(node => node.remove())
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

export default memo(function VacancyDetails({conditions}) {
  const [open, setOpen] = useState(false)
  const rows = open ? [
    ['Обязанности', plainText(conditions.duty)],
    ['Требования', joinText(conditions.requirements, conditions.qualification)],
    ['Образование', plainText(conditions.required_education) || plainText(conditions.education)],
    ['Опыт', experienceText(conditions.experience_years ?? conditions.experience)],
    ['График', plainText(conditions.schedule)],
    ['Занятость', plainText(conditions.employment)],
    ['Условия', joinText(conditions.conditions, conditions.terms)],
  ].filter(([, text]) => text) : []
  return <div className="vacancy-details">
    <button type="button" aria-expanded={open} aria-controls="vacancy-description" onClick={() => setOpen(!open)}>
      Подробнее о вакансии <ChevronDown aria-hidden="true"/>
    </button>
    <div id="vacancy-description" className="details-body" hidden={!open} tabIndex={0} role="region" aria-label="Подробности вакансии">
      {open && (rows.length ? <dl>{rows.map(([label, text]) =>
        <div key={label}><dt>{label}</dt><dd>{text}</dd></div>
      )}</dl> : <p>Источник не указал подробности.</p>)}
    </div>
  </div>
})
