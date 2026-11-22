const PAGE_SIZE = 50
const MAX_DEPTH = 500

export function createSearchProgress() {
  return {items: [], sourceTotal: 0, matchedTotal: 0, nextPage: 0, done: false}
}

// Keep the same upstream limit throughout the search: offset is a page number.
export async function searchPages(apiUrl, params, depth, signal, fetcher = fetch, {
  progress = createSearchProgress(), onPage = () => {},
} = {}) {
  const pages = Math.ceil(Math.min(MAX_DEPTH, Math.max(PAGE_SIZE, Number(depth) || 100)) / PAGE_SIZE)
  while (!progress.done && progress.nextPage < pages) {
    signal?.throwIfAborted()
    const query = new URLSearchParams({
      ...params, page: String(progress.nextPage), per_page: String(PAGE_SIZE), source_limit: String(PAGE_SIZE),
    })
    let data
    try {
      const response = await fetcher(`${apiUrl}/api/vacancies?${query}`, {signal})
      if (!response.ok) return {failedPage: progress.nextPage}
      data = await response.json()
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error
      return {failedPage: progress.nextPage}
    }
    signal?.throwIfAborted()
    if (data?.source_errors?.length || !Array.isArray(data?.items)) {
      return {failedPage: progress.nextPage}
    }

    progress.items.push(...data.items)
    const sourceCount = data.source_total ?? data.items.length
    progress.sourceTotal += sourceCount
    progress.matchedTotal += data.matched_total ?? data.items.length
    progress.nextPage += 1
    // Filtered items can be empty even if more source records exist.
    progress.done = sourceCount < PAGE_SIZE || progress.nextPage === pages
    onPage(progress)
  }
  return {failedPage: null}
}
