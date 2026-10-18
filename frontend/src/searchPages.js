// Each source page contains at most 100 records; the backend filters before returning them.
export async function searchPages(apiUrl, params, depth, signal, fetcher = fetch) {
  const pages = Math.max(1, Math.min(5, Math.ceil(Number(depth || 100) / 100)))
  const results = await Promise.all(Array.from({length: pages}, async (_, page) => {
    try {
      const query = new URLSearchParams({...params, page: String(page), per_page: '100'})
      const response = await fetcher(`${apiUrl}/api/vacancies?${query}`, {signal})
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Ошибка API: ${response.status}`)
      return {page, data}
    } catch (error) {
      if (error.name === 'AbortError') throw error
      return {page, error: error.message || 'Ошибка сети'}
    }
  }))
  const items = [], errors = []
  let sourceTotal = 0, matchedTotal = 0, successfulPages = 0
  for (const {page, data, error} of results) {
    if (error) { errors.push({source: `Страница ${page + 1}`, status: 'ошибка', detail: error}); continue }
    const sourceErrors = data.source_errors || []
    if (sourceErrors.length) {
      errors.push(...sourceErrors.map((item) => ({...item, source: `${item.source} · страница ${page + 1}`})))
      continue
    }
    successfulPages += 1
    const pageItems = Array.isArray(data.items) ? data.items : []
    items.push(...pageItems)
    sourceTotal += data.source_total ?? pageItems.length
    matchedTotal += data.matched_total ?? pageItems.length
  }
  return {items, errors, sourceTotal, matchedTotal, successfulPages}
}
