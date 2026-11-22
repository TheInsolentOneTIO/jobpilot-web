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
  url: 'https://example.org/1', salary_from: 37500, salary_to: '37500', currency: '₽',
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
    await page.route('**/api/vacancies?**', route => {
      requests++
      return route.fulfill({json: {items: [first, similar, second, third], source_total: 4, matched_total: 4}})
    })
    await page.goto(origin, {waitUntil: 'domcontentloaded'})
    const toggle = page.getByRole('button', {name: 'Подробнее о вакансии'})
    const skip = page.getByRole('button', {name: 'Пропустить', exact: true})
    const like = page.getByRole('button', {name: 'В понравившиеся', exact: true})
    await page.getByRole('heading', {name: first.title}).waitFor()
    assert.equal(await page.locator('.card-back').textContent(), '')
    assert.equal(await page.getByText(second.title).count(), 0)
    assert.equal((await page.locator('.card-salary').innerText()).replace(/\s/g, ''), '37500₽')
    const initialY = (await skip.boundingBox()).y
    await toggle.click()
    const details = page.getByRole('region', {name: 'Подробности вакансии'})
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
    await page.getByRole('heading', {name: second.title}).waitFor()
    assert.equal(await page.locator('.card-back').count(), 1)
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    await toggle.click()
    assert.equal(await details.innerText(), 'Источник не указал подробности.')
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
    assert.deepEqual(reactions, ['liked', 'skipped', mobile ? 'skipped' : 'liked'])
    assert.equal(requests, 1)
  })
}
