import { expect, test, type Page } from '@playwright/test'

/** 시작 → 캐릭터 선택 → 입장. 처음 입장하면 뜨는 조작법 안내는 닫는다 */
async function enterArena(page: Page, character = '삐에로') {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Fight Club' })).toBeVisible()
  await page.getByRole('button', { name: '시작' }).click()
  await page.getByRole('radio', { name: new RegExp(`^${character}`) }).click()
  await page.getByRole('button', { name: '입장' }).click()
  await expect(page.locator('.hud-arena')).toContainText(/경기장 #\d+/, { timeout: 20_000 })
  await page.getByRole('button', { name: '닫기' }).click()
}

test('시작 → 캐릭터 선택 → 입장 → 탈락 → 결과 → 다시 하기 (US-01·02·08)', async ({ page }) => {
  await page.goto('/')
  // 시작 화면: 제목·접속자 수·시작·조작법 (FR-02)
  await expect(page.locator('.title-online')).toContainText('명이 싸우는 중')
  await page.getByRole('button', { name: '조작법' }).click()
  await expect(page.getByRole('dialog', { name: '조작법' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '시작' }).click()

  // 캐릭터 선택: 5종, 🎲로 이름 다시 뽑기 (US-02)
  await expect(page.getByRole('radio')).toHaveCount(5)
  await page.getByRole('radio', { name: /^유도가/ }).click()
  await expect(page.getByRole('radio', { name: /^유도가/ })).toHaveAttribute('aria-checked', 'true')
  const first = await page.locator('.name-value').textContent()
  await page.getByRole('button', { name: '이름 다시 뽑기' }).click()
  await expect(page.locator('.name-value')).not.toHaveText(first ?? '')

  // 입장: 클릭 3번 이내 (시작·입장) — 경기장 번호와 인원 (FR-05)
  await page.getByRole('button', { name: '입장' }).click()
  await expect(page.locator('.hud-arena')).toContainText(/경기장 #\d+ · 1\/16/, { timeout: 20_000 })
  await expect(page.getByRole('dialog', { name: '조작법' })).toBeVisible()
  await page.getByRole('button', { name: '닫기' }).click()
  await expect(page.locator('.nametag.me')).toBeVisible()

  // 가장자리 밖으로 달려 나가 떨어진다 → 결과 화면 (FR-39)
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('ArrowUp')
  await expect(page.getByRole('heading', { name: '발을 헛디뎠습니다' })).toBeVisible({ timeout: 15_000 })
  await page.keyboard.up('ArrowUp')
  await page.keyboard.up('ShiftLeft')
  await expect(page.locator('.result-stats')).toContainText('최고 순위')

  // 다시 하기 → 캐릭터 선택, 새 이름 (FR-40)
  await page.getByRole('button', { name: '다시 하기' }).click()
  await expect(page.getByRole('radiogroup', { name: '캐릭터' })).toBeVisible()
  await expect(page.locator('.name-value')).not.toBeEmpty()
})

test('두 명이 같은 경기장에 들어가 서로의 이름표와 순위가 보인다 (US-09)', async ({ browser }) => {
  const a = await browser.newPage()
  const b = await browser.newPage()
  await enterArena(a, '전사')
  await enterArena(b, '닌자')
  await expect(a.locator('.hud-arena')).toContainText('2/16')
  await expect(a.locator('.nametag')).toHaveCount(2)
  await expect(a.locator('.leaderboard li')).toHaveCount(2)
  // B는 다른 사람과 먼 곳에 서므로 A의 화면 밖일 수 있다 — 이름표는 있고(화면 밖이면 숨김), 순위표에는 늘 보인다
  const bName = (await b.locator('.nametag.me .nametag-name').textContent()) ?? ''
  await expect(a.locator('.nametag-name', { hasText: bName })).toHaveCount(1)
  await expect(a.locator('.leaderboard')).toContainText(bName)
  await a.close()
  await b.close()
})
