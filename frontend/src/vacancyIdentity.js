export function normalizedUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|yclid|fbclid)$/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.href
  } catch { return null }
}

export function vacancyKeys(job) {
  const source = String(job.source || '').trim().toLowerCase()
  const keys = []
  if (job.id != null && String(job.id)) keys.push(`id:${source}:${String(job.id)}`)
  const url = normalizedUrl(job.url)
  if (url) keys.push(`url:${url}`)
  const group = groupKey(job)
  if (group) keys.push(group)
  for (const member of job.members || []) {
    if (member.id != null && String(member.id)) keys.push(`id:${String(member.source || '').trim().toLowerCase()}:${String(member.id)}`)
    const memberUrl = normalizedUrl(member.url)
    if (memberUrl) keys.push(`url:${memberUrl}`)
  }
  return keys
}

function groupKey(job) {
  const clean = (value) => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim() : ''
  const conditions = job.work_conditions
  if (!conditions || typeof conditions !== 'object') return null
  const values = [job.company, job.title, job.city, job.work_address, job.currency].map(clean)
  if (values.some((value) => !value) || !/\d/.test(values[3])) return null
  if (!(Number(job.salary_from) > 0 || Number(job.salary_to) > 0)) return null
  const fields = ['duty', 'requirements', 'schedule', 'employment', 'experience', 'education']
  if (!fields.every((field) => conditions[field] == null || typeof conditions[field] === 'string')) return null
  const details = fields.map((field) => clean(conditions[field]))
  if (!details[0] || !details[1] || !details[2]) return null
  return `group:${JSON.stringify([...values, job.salary_from || null, job.salary_to || null, ...details])}`
}

export function isViewed(seen, job) {
  return seen.has(job.id) || vacancyKeys(job).some((key) => seen.has(key))
}

export function markViewed(seen, job) {
  vacancyKeys(job).forEach((key) => seen.add(key))
}

export function migrateViewed(seen, history, liked) {
  const result = new Set(seen)
  for (const job of [...history.map((entry) => entry.job).filter(Boolean), ...liked]) {
    if (isViewed(result, job)) markViewed(result, job)
  }
  return result
}

export function uniqueUnseen(jobs, seen, liked) {
  const known = new Set(seen)
  liked.forEach((job) => markViewed(known, job))
  const groups = [], groupMap = new Map(), identityMap = new Map()
  for (const job of jobs) {
    const identity = vacancyKeys(job).filter((key) => !key.startsWith('group:'))
    const key = groupKey(job)
    const index = identity.map((item) => identityMap.get(item)).find((value) => value !== undefined) ?? (key ? groupMap.get(key) : undefined)
    const member = {id: job.id, source: job.source, url: job.url}
    if (index === undefined) {
      const next = groups.length
      groups.push({...job, members: [member]})
      if (key) groupMap.set(key, next)
      identity.forEach((item) => identityMap.set(item, next))
    } else {
      const group = groups[index]
      if (!group.members.some((item) => item.id === member.id && item.source === member.source && item.url === member.url)) group.members.push(member)
      identity.forEach((item) => identityMap.set(item, index))
      if (key) groupMap.set(key, index)
    }
  }
  return groups.filter((group) => !isViewed(known, group))
}

// This is a presentation-only bundle: each posting keeps its own decision and identity.
export function collapseConsecutive(jobs) {
  const clean = (value) => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim() : ''
  const signature = (job) => {
    const title = clean(job.title), company = clean(job.company)
    if (!title || !company) return null
    return JSON.stringify([title, company, clean(job.city), job.salary_from || null, job.salary_to || null, clean(job.currency), clean(job.source)])
  }
  const result = []
  let last = null
  for (const job of jobs) {
    const key = signature(job)
    if (key && key === last) result[result.length - 1].alternatives.push(job)
    else { result.push({...job, alternatives: []}); last = key }
  }
  return result
}

export function claimDecision(lock, seen, job) {
  if (!job || lock.current || isViewed(seen, job)) return false
  lock.current = true
  markViewed(seen, job)
  return true
}

export function swipeDecision(start, endX) {
  const x = endX - start.x
  return start.dragging && Math.abs(x) > 65 ? x > 0 : null
}
