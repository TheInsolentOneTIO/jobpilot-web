import test from 'node:test'
import assert from 'node:assert/strict'
import { createSearchProgress, searchPages } from '../src/searchPages.js'
import { claimDecision, collapseConsecutive, isViewed, uniqueUnseen } from '../src/vacancyIdentity.js'

const ok = (items, sourceTotal = 50) => ({
  ok: true,
  json: async () => ({items, source_total: sourceTotal, source_errors: []}),
})
const timedOut = () => ({
  ok: true,
  json: async () => ({items: [], source_errors: [{status: 504}]}),
})
const vacancy = (id) => ({id, source: 'Работа России', url: `https://example.org/${id}`})
const pageOf = (url) => Number(new URL(url).searchParams.get('page'))

test('loads pages in sequence, publishes progress and keeps filters and page size fixed', async () => {
  const events = []
  const fetcher = async (url) => {
    const query = new URL(url).searchParams
    const page = pageOf(url)
    assert.equal(query.get('per_page'), '50')
    assert.equal(query.get('source_limit'), '50')
    assert.equal(query.get('city'), 'Москва')
    events.push(`request-${page}`)
    return ok(page === 0 ? [] : [vacancy(page)], page === 2 ? 10 : 50)
  }
  const progress = createSearchProgress()
  const result = await searchPages('https://api.example', {city: 'Москва'}, 500, null, fetcher, {
    progress, onPage: ({nextPage}) => events.push(`ready-${nextPage - 1}`),
  })
  assert.equal(result.failedPage, null)
  assert.deepEqual(events, ['request-0', 'ready-0', 'request-1', 'ready-1', 'request-2', 'ready-2'])
  assert.equal(progress.sourceTotal, 110)
  assert.equal(progress.matchedTotal, 2)
  assert.equal(progress.done, true)
})

test('first-page timeout stops the search and a manual retry starts at page zero', async () => {
  const calls = []
  const progress = createSearchProgress()
  const fetcher = async (url) => {
    calls.push(pageOf(url))
    return calls.length === 1 ? timedOut() : ok([vacancy('first')], 1)
  }
  const run = () => searchPages('https://api.example', {}, 500, null, fetcher, {progress})
  assert.equal((await run()).failedPage, 0)
  assert.deepEqual(progress.items, [])
  assert.deepEqual(calls, [0])
  assert.equal((await run()).failedPage, null)
  assert.deepEqual(calls, [0, 0])
  assert.deepEqual(progress.items.map(({id}) => id), ['first'])
})

test('later timeout retains cards and resumes at the failed page without repeating a swipe', async () => {
  const calls = []
  const progress = createSearchProgress()
  const seen = new Set()
  const fetcher = async (url) => {
    const page = pageOf(url)
    calls.push(page)
    if (page === 0) return ok([vacancy('a'), vacancy('b')])
    if (calls.length === 2) return timedOut()
    return ok([vacancy('a'), vacancy('c')], 2)
  }
  const queue = () => collapseConsecutive(uniqueUnseen(progress.items, new Set(), []))
  const run = () => searchPages('https://api.example', {}, 200, null, fetcher, {progress})
  assert.equal((await run()).failedPage, 1)
  assert.deepEqual(calls, [0, 1])
  assert.deepEqual(queue().map(({id}) => id), ['a', 'b'])
  assert.equal(claimDecision({current: false}, seen, queue()[0]), true)
  assert.equal((await run()).failedPage, null)
  assert.deepEqual(calls, [0, 1, 1])
  assert.equal(progress.sourceTotal, 52)
  assert.deepEqual(queue().map(({id}) => id), ['a', 'b', 'c'])
  const restored = new Set(JSON.parse(JSON.stringify([...seen])))
  assert.deepEqual(queue().filter((job) => !isViewed(restored, job)).map(({id}) => id), ['b', 'c'])
})

test('bounds depth and propagates cancellation without another request', async () => {
  let calls = 0
  await searchPages('https://api.example', {}, 900, null, async () => { calls++; return ok([]) })
  assert.equal(calls, 10)
  const controller = new AbortController()
  const progress = createSearchProgress()
  const fetcher = async () => { controller.abort(); return ok([vacancy('a')]) }
  await assert.rejects(searchPages('https://api.example', {}, 100, controller.signal, fetcher, {progress}), {name: 'AbortError'})
  assert.deepEqual(progress.items, [])
})
