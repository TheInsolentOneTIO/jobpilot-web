import test from 'node:test'
import assert from 'node:assert/strict'
import { searchPages } from '../src/searchPages.js'

test('loads all requested pages and returns more than twenty matches', async () => {
  const queries = []
  const fetcher = async (url) => {
    const query = new URL(url).searchParams
    queries.push(query)
    const page = Number(query.get('page'))
    return {ok: true, json: async () => ({items: Array.from({length: 50}, (_, i) => ({id: `${page}-${i}`})), source_total: 100, matched_total: 50, source_errors: []})}
  }
  const result = await searchPages('https://api.example', {city: 'Москва', work_format: 'any'}, 300, null, fetcher)
  assert.deepEqual(queries.map((q) => q.get('page')), ['0', '1', '2'])
  assert.ok(queries.every((q) => q.get('per_page') === '100' && q.get('city') === 'Москва'))
  assert.equal(result.items.length, 150)
  assert.equal(result.sourceTotal, 300)
  assert.equal(result.matchedTotal, 150)
})

test('retains successful pages and reports a source failure separately', async () => {
  const fetcher = async (url) => {
    const page = new URL(url).searchParams.get('page')
    const data = page === '0' ? {items: [{id: '1'}], source_total: 100, matched_total: 1, source_errors: []} : {items: [], source_errors: [{source: 'Работа России', status: 502, detail: 'Ошибка'}]}
    return {ok: true, json: async () => data}
  }
  const result = await searchPages('https://api.example', {}, 200, null, fetcher)
  assert.equal(result.items.length, 1)
  assert.equal(result.successfulPages, 1)
  assert.equal(result.errors[0].status, 502)
})

test('bounds depth and propagates cancellation', async () => {
  let calls = 0
  await searchPages('https://api.example', {}, 900, null, async () => { calls++; return {ok: true, json: async () => ({items: []})} })
  assert.equal(calls, 5)
  await assert.rejects(searchPages('https://api.example', {}, 100, null, async () => { throw Object.assign(new Error('aborted'), {name: 'AbortError'}) }), {name: 'AbortError'})
})
