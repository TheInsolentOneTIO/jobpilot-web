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

test('twenty repeated records across and within pages do not recur after swiping', () => {
  const repeated = job('same', 'https://example.org/vacancy/1')
  const page0 = Array.from({length: 10}, () => ({...repeated}))
  const page1 = [...Array.from({length: 10}, (_, i) => job(`duplicate-${i}`, 'https://example.org/vacancy/1?utm_source=feed')), job('next', 'https://example.org/vacancy/2')]
  const seen = new Set(), lock = {current: false}
  const queue = uniqueUnseen([...page0, ...page1], seen, [])
  assert.deepEqual(queue.map((item) => item.id), ['same', 'next'])
  assert.equal(claimDecision(lock, seen, queue[0]), true)
  assert.equal(queue.slice(1).find((item) => !isViewed(seen, item)).id, 'next')
  const reloaded = new Set(JSON.parse(JSON.stringify([...seen])))
  assert.deepEqual(uniqueUnseen([...page0, ...page1], reloaded, []).map((item) => item.id), ['next'])
})

test('visually identical records with different IDs and URLs remain separate', () => {
  const items = Array.from({length: 20}, (_, i) => job(`id-${i}`, `https://example.org/vacancy/${i}`))
  assert.equal(uniqueUnseen(items, new Set(), []).length, 20)
})

test('groups twenty equivalent postings across pages and persists the group decision', () => {
  const common = {company: 'Ашан', title: 'Водитель электроштабелера', city: 'Москва', work_address: 'г Москва, ул Лесная, д 12', salary_from: 90000, salary_to: 100000, currency: 'RUB', work_conditions: {duty: 'Погрузка', requirements: 'Опыт', schedule: 'Сменный'}}
  const items = Array.from({length: 20}, (_, i) => ({...job(`id-${i}`, `https://example.org/vacancy/${i}`), ...common}))
  const seen = new Set(), lock = {current: false}
  const queue = uniqueUnseen([...items.slice(0, 10), ...items.slice(10)], seen, [])
  assert.equal(queue.length, 1)
  assert.equal(queue[0].members.length, 20)
  assert.equal(swipeDecision({x: 100, dragging: true}, 20), false)
  assert.equal(claimDecision(lock, seen, queue[0]), true)
  const stored = new Set(JSON.parse(JSON.stringify([...seen])))
  assert.equal(uniqueUnseen([...items, {...items[0], id: 'new', url: 'https://example.org/vacancy/new'}], stored, []).length, 0)
  assert.equal(uniqueUnseen(items, new Set(), JSON.parse(JSON.stringify(queue))).length, 0)
})

test('different addresses, conditions or missing details are never grouped', () => {
  const common = {...job('1', 'https://example.org/1'), company: 'Ашан', city: 'Москва', work_address: 'Москва, ул Лесная, 12', salary_from: 90000, salary_to: 100000, currency: 'RUB', work_conditions: {duty: 'Погрузка', requirements: 'Опыт', schedule: 'Сменный'}}
  const otherAddress = {...common, id: '2', url: 'https://example.org/2', work_address: 'Москва, ул Лесная, 14'}
  const otherSchedule = {...common, id: '3', url: 'https://example.org/3', work_conditions: {...common.work_conditions, schedule: 'Ночной'}}
  const unknown = {...common, id: '4', url: 'https://example.org/4', work_address: null}
  assert.equal(uniqueUnseen([common, otherAddress, otherSchedule, unknown], new Set(), []).length, 4)
})
