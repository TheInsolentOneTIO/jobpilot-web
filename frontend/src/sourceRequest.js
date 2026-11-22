// Allow the backend's 35-second source deadline plus time for its HTTP response.
const REQUEST_TIMEOUT_MS = 40_000

export async function fetchSourceJson(url, signal, fetcher = fetch) {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', cancel, {once: true})
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetcher(url, {signal: controller.signal})
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    // Reading a timed-out body can throw AbortError; keep it distinct from navigation.
    controller.signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
