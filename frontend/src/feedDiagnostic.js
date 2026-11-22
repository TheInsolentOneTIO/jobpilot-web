import { normalizedUrl } from './vacancyIdentity'

// Opt-in, local console only. No vacancy text, IDs, URLs or user profile leave the browser.
export async function logFeedDecision(job, index) {
  try {
    if (sessionStorage.getItem('jobpilot.debugFeed') !== '1' || !globalThis.crypto?.subtle) return
    const hash = async (value) => {
      if (value == null || value === '') return null
      const bytes = new TextEncoder().encode(String(value))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
    const [idHash, sourceHash, urlHash, normalizedUrlHash, visibleHash] = await Promise.all([
      hash(job.id), hash(job.source), hash(job.url), hash(normalizedUrl(job.url)),
      hash(JSON.stringify([job.title, job.company, job.city, job.salary_from, job.salary_to, job.currency, job.source]))
    ])
    console.info('[JobPilot feed diagnostic]', {index, idHash, sourceHash, urlHash, normalizedUrlHash, visibleHash})
  } catch {
    // Diagnostics must never affect decisions or the feed.
  }
}
