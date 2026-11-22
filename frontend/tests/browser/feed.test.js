import assert from 'node:assert/strict'
import {after, before, test} from 'node:test'
import {chromium} from 'playwright-core'
import {createServer} from 'vite'

let browser, server, origin
before(async () => {
  server = await createServer({server: {host: '127.0.0.1', port: 0}, logLevel: 'error'})
  await server.listen()
  origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({channel: 'chrome'})
})
after(async () => { await browser?.close(); await server?.close() })

const first = {
  id: '1', title: 'Первая вакансия', source: 'Работа России', company: 'Тест', city: 'Москва',
  url: 'https://trudvsem.ru/vacancy/card/123/1', salary_from: 37500, salary_to: '37500', currency: 'руб.',
  work_address: 'г Москва, улица Тестовая, 1',
  work_conditions: {duty: '<p>Первая строка</p><p>Вторая строка</p>', qualification: 'Допуск',
    experience_years: 0, schedule: 'По сменам', terms: 'Проезд оплачивается. '.repeat(200)},
}
const similar = {...first, id: '2', url: 'https://example.org/2'}
const second = {id: '3', title: 'Вторая вакансия', source: first.source, url: 'https://example.org/3'}
const third = {...second, id: '4', title: 'Третья вакансия', url: 'https://example.org/4',
  work_conditions: {schedule: 'Гибкий график'}}

async function touchSwipe(page, card) {
  const session = await page.context().newCDPSession(page)
  const {x, y, width} = await card.boundingBox()
  const start = x + width / 2
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: start, y: y + 20}]})
  for (const delta of [15, 45, 75, 100]) {
    await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: start - delta, y: y + 20}]})
  }
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []})
  await session.detach()
}

for (const [width, height] of [[375, 667], [390, 844], [1440, 900]]) {
  test(`disclosure, stack and decisions at ${width}px`, async t => {
    const mobile = width < 720
    const context = await browser.newContext({viewport: {width, height}, isMobile: mobile, hasTouch: mobile,
      reducedMotion: width === 390 ? 'reduce' : 'no-preference'})
    t.after(() => context.close())
    const page = await context.newPage()
    let requests = 0
    const extraCard = {...second, id: '5', title: 'Ещё одна вакансия', url: 'https://example.org/5'}
    await page.route('**/api/vacancies?**', route => {
      requests++
      return route.fulfill({json: {items: [first, similar, extraCard, second, third], source_total: 5, matched_total: 5}})
    })
    await page.goto(origin, {waitUntil: 'domcontentloaded'})
    const toggle = page.getByRole('button', {name: 'Подробнее о вакансии'})
    const skip = page.getByRole('button', {name: 'Пропустить', exact: true})
    const like = page.getByRole('button', {name: 'В понравившиеся', exact: true})
    await page.getByRole('heading', {name: first.title}).waitFor()
    assert.deepEqual(await page.locator('.card-back').allTextContents(), ['', '', ''])
    assert.equal(await page.getByText(second.title).count(), 0)
    assert.equal((await page.locator('.card-salary').innerText()).replace(/\s/g, ''), '37500₽')
    const initialY = (await skip.boundingBox()).y
    await toggle.click()
    const details = page.getByRole('region', {name: 'Подробности вакансии'})
    assert.equal(await details.locator(':scope > :first-child').getAttribute('href'), first.url)
    assert.match(await details.innerText(), /улица Тестовая/)
    assert.match(await details.innerText(), /Первая строка\s+Вторая строка/)
    assert.match(await details.innerText(), /Без опыта/)
    assert.equal(await details.evaluate(el => el.scrollHeight > el.clientHeight), true)
    assert.equal((await skip.boundingBox()).y, initialY)
    const box = await details.boundingBox()
    assert.ok(box.y >= initialY + (await skip.boundingBox()).height)
    if (mobile) assert.ok(box.y + box.height <= (await page.locator('.mobile').boundingBox()).y + 1)
    await toggle.click()
    assert.equal(await details.count(), 0)
    await toggle.click()
    if (mobile) await touchSwipe(page, page.locator('.card'))
    else {
      await like.evaluate(el => { el.click(); el.click() })
      assert.equal(await page.locator('.card.exiting').count(), 1)
    }
    await page.getByRole('heading', {name: extraCard.title}).waitFor()
    assert.equal(await page.locator('.card-back').count(), 2)
    await skip.click()
    await page.getByRole('heading', {name: second.title}).waitFor()
    assert.equal(await page.locator('.card-back').count(), 1)
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    await toggle.click()
    assert.equal(await details.locator('a').getAttribute('href'), second.url)
    assert.match(await details.innerText(), /Дополнительных сведений в ответе нет/)
    assert.equal((await skip.boundingBox()).y, initialY)
    await skip.click()
    await page.getByRole('heading', {name: third.title}).waitFor()
    assert.equal(await page.locator('.card-back').count(), 0)
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    await toggle.click()
    assert.deepEqual(await details.locator('dd').allTextContents(), ['Гибкий график'])
    await like.click()
    await page.getByText('Все найденные вакансии просмотрены').waitFor()
    assert.equal(await toggle.count(), 0)
    const reactions = await page.evaluate(() => JSON.parse(localStorage.getItem('jobpilot.history')).map(x => x.reaction))
    assert.deepEqual(reactions, ['liked', 'skipped', 'skipped', mobile ? 'skipped' : 'liked'])
    await page.getByRole('button', {name: 'История', exact: true}).click()
    const historyEntry = page.locator('.history article').first()
    assert.equal(await historyEntry.locator('.history-tags li').innerText(), 'Гибкий график')
    assert.ok((await historyEntry.locator('.reaction').boundingBox()).width < (await historyEntry.boundingBox()).width / 2)
    assert.equal(requests, 1)
  })
}

test('loads missing details once on demand and keeps the original accessible on timeout', async t => {
  const context = await browser.newContext({viewport: {width: 375, height: 480}, reducedMotion: 'reduce'})
  t.after(() => context.close())
  const page = await context.newPage()
  const brief = {...second, id: 'trudvsem-3', url: 'https://trudvsem.ru/vacancy/card/123/3',
    work_conditions: {experience_years: 0, education: 'Высшее'}}
  const last = {...third, id: 'trudvsem-4', url: 'https://trudvsem.ru/vacancy/card/123/4', work_addresses: ['Адрес из списка']}
  await page.route('**/api/vacancies?**', r => r.fulfill({json: {items: [brief, last], source_total: 2, matched_total: 2}}))
  let calls = 0
  await page.route('**/api/vacancies/123/*', r => {
    calls++
    return r.request().url().endsWith('/3') ? r.fulfill({json: {...brief, work_addresses: ['Первый адрес', 'Второй адрес'],
      work_conditions: {duty: '<ul><li>Подготовка договоров</li><li>Проверка отчётов</li></ul>', schedule: 'По сменам',
        education: '   ', experience_years: null}}})
      : r.fulfill({status: 504, json: {detail: 'Timeout'}})
  })
  await page.goto(origin, {waitUntil: 'domcontentloaded'})
  const toggle = page.getByRole('button', {name: 'Подробнее о вакансии'})
  await toggle.waitFor()
  assert.equal(calls, 0)
  await toggle.click()
  const details = page.getByRole('region', {name: 'Подробности вакансии'})
  await details.getByText('Должностные обязанности', {exact: true}).waitFor()
  assert.match(await details.innerText(), /• Подготовка договоров\s+• Проверка отчётов/)
  assert.match(await details.innerText(), /Первый адрес\s+Второй адрес/)
  assert.match(await details.innerText(), /Без опыта/)
  assert.match(await details.innerText(), /Высшее/)
  assert.equal(await details.locator(':scope > :first-child').getAttribute('href'), brief.url)
  await toggle.click()
  await toggle.click()
  assert.equal(calls, 1)
  await page.getByRole('button', {name: 'Пропустить', exact: true}).click()
  await toggle.click()
  await details.getByRole('status').filter({hasText: 'Не удалось'}).waitFor()
  assert.equal(await details.locator('a').getAttribute('href'), last.url)
  assert.match(await details.innerText(), /Гибкий график/)
  assert.match(await details.innerText(), /Адрес из списка/)
  await page.getByRole('button', {name: 'История', exact: true}).click()
  assert.equal(await page.locator('.history-tags li').innerText(), 'По сменам')
  assert.equal(calls, 2)
})

test('renders the Abakan teacher list fields immediately and omits absent fields', async t => {
  const page = await browser.newPage()
  t.after(() => page.close())
  const job = {...first, title: 'Преподаватель английского языка', company: 'Языковая школа Окей',
    city: 'Абакан', work_address: null,
    work_conditions: {duty: 'Уроки в школе и онлайн', requirements: 'Английский В2',
      qualification: '<p>Условия: Работа в школе и онлайн</p>', schedule: 'Полный рабочий день',
      required_education: 'Не указано', experience_years: 0}}
  let detailCalls = 0
  await page.route('**/api/vacancies/*/*', route => { detailCalls++; return route.fulfill({status: 504}) })
  await page.route('**/api/vacancies?**', route => route.fulfill({json: {items: [job], source_total: 1}}))
  await page.goto(origin, {waitUntil: 'domcontentloaded'})
  await page.getByRole('button', {name: 'Подробнее о вакансии'}).click()
  const panel = page.getByRole('region', {name: 'Подробности вакансии'})
  const sections = await panel.locator('dl > div').evaluateAll(rows => Object.fromEntries(
    rows.map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent])))
  assert.deepEqual(sections, {'Должностные обязанности': 'Уроки в школе и онлайн', 'Место работы': 'Абакан',
    'Требования': 'Английский В2', 'Условия': 'Работа в школе и онлайн', 'График': 'Полный рабочий день', 'Опыт': 'Без опыта'})
  assert.equal(detailCalls, 0)
})

test('a stalled detail request with no list fields leaves the original link and one explanation', async t => {
  const page = await browser.newPage()
  t.after(() => page.close())
  const brief = {id: 'trudvsem-3', title: 'Вакансия', url: 'https://trudvsem.ru/vacancy/card/123/3'}
  await page.route('**/api/vacancies?**', route => route.fulfill({json: {items: [brief], source_total: 1}}))
  await page.route('**/api/vacancies/123/3', () => {}) // Leave the request pending until the browser deadline.
  await page.goto(origin, {waitUntil: 'domcontentloaded'})
  const toggle = page.getByRole('button', {name: 'Подробнее о вакансии'})
  await toggle.waitFor()
  await page.clock.install()
  const requested = page.waitForRequest('**/api/vacancies/123/3')
  await toggle.click()
  await requested
  await page.clock.fastForward(20_001)
  const details = page.getByRole('region', {name: 'Подробности вакансии'})
  await details.getByRole('status').filter({hasText: 'Не удалось'}).waitFor()
  assert.equal(await details.locator('p').count(), 1)
  assert.equal(await details.locator('dl').count(), 0)
  assert.equal(await details.getByRole('link').getAttribute('href'), brief.url)
})
