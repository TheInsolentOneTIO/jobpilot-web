import test from 'node:test'
import assert from 'node:assert/strict'
import { claimDecision, isViewed, migrateViewed, normalizedUrl, swipeDecision, uniqueUnseen } from '../src/vacancyIdentity.js'

const job = (id, url, source = 'Работа России') => ({ id, url, source, title: 'Менеджер' })

test('deduplicates API items by source ID or normalized URL, not title', () => {
  const jobs = [job('1', 'https://example.org/a/?utm_source=x#top'), job('2', 'https://example.org/a'), job('3', 'https://example.org/b'), job('3', 'https://example.org/b?utm_campaign=x')]
  assert.deepEqual(uniqueUnseen(jobs, new Set(), []).map((item) => item.id), ['1', '3'])
  assert.equal(normalizedUrl('https://EXAMPLE.org/a/?b=2&a=1#x'), 'https://example.org/a?a=1&b=2')
  assert.equal(uniqueUnseen([job('1', 'https://example.org/a'), job('1', 'https://example.org/b', 'Другой источник')], new Set(), []).length, 2)
})

test('viewed identity survives reload, API pages and changed IDs', () => {
  const seen = new Set()
  const lock = { current: false }
  assert.equal(claimDecision(lock, seen, job('old', 'https://example.org/vacancy/1')), true)
  const restored = new Set(JSON.parse(JSON.stringify([...seen])))
  assert.equal(uniqueUnseen([job('new', 'https://example.org/vacancy/1/?utm_source=app'), job('other', 'https://example.org/vacancy/2')], restored, []).length, 1)
  assert.equal(uniqueUnseen([job('new', 'https://example.org/vacancy/1')], new Set(), []).length, 1)
})

test('migrates legacy viewed IDs using history without marking unviewed history', () => {
  const history = [{ job: job('old', 'https://example.org/a') }, { job: job('unseen', 'https://example.org/b') }]
  const seen = migrateViewed(['old'], history, [])
  assert.equal(isViewed(seen, job('changed', 'https://example.org/a/')), true)
  assert.equal(isViewed(seen, job('unseen', 'https://example.org/b')), false)
})

test('mobile swipes and repeated taps commit only once', () => {
  const seen = new Set(), lock = { current: false }, first = job('1', 'https://example.org/a')
  assert.equal(swipeDecision({ x: 100, dragging: true }, 180), true)
  assert.equal(swipeDecision({ x: 100, dragging: true }, 20), false)
  assert.equal(swipeDecision({ x: 100, dragging: true }, 120), null)
  assert.equal(swipeDecision({ x: 100, dragging: false }, 200), null)
  assert.equal(claimDecision(lock, seen, first), true)
  assert.equal(claimDecision(lock, seen, first), false)
  lock.current = false
  assert.equal(claimDecision(lock, seen, job('2', 'https://example.org/a/')), false)
  assert.equal(claimDecision(lock, seen, job('3', 'https://example.org/b')), true)
})
