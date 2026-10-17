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
  return keys
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
  const result = []
  for (const job of jobs) {
    const duplicate = isViewed(known, job)
    markViewed(known, job)
    if (!duplicate) result.push(job)
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
