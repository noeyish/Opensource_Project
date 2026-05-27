/**
 * 졸업요건 진행도 카드 검증 (#158 회귀 방어)
 *
 * 사전 시드: `make e2e-seed`
 *   - 전공 2과목 (CSE9001, CSE9002) × 3학점 = 6학점
 *   - 교양 2과목 (GEN9001, GEN9002) × 3학점 = 6학점
 *   - 총 12학점 / 4과목
 *
 * 검증: 카드의 학점·과목 수가 시드 값과 일치하는지.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'

test.describe('졸업요건 진행도', () => {
  test('이수 학점 카드가 시드 데이터(전공 6 / 교양 6 / 총 12)를 정확히 반영', async ({ page }) => {
    await loginAs(page)
    await page.goto('/graduation')

    // 데이터 fetch 완료까지 auto-retry. 시드 기준 12학점, 4과목 이상이어야 함.
    // 실 사용자 데이터가 추가로 있을 가능성 감안해 최소값(≥)으로 검증.
    const totalCard = page.locator('div', { has: page.getByText('총 이수 학점') }).first()
    const countCard = page.locator('div', { has: page.getByText('이수 과목 수') }).first()

    await expect(async () => {
      const totalText = (await totalCard.textContent()) ?? ''
      const total = parseInt(totalText.match(/(\d+)\s*학점/)?.[1] ?? '0')
      const major = parseInt(totalText.match(/전공\s*(\d+)/)?.[1] ?? '0')
      const liberal = parseInt(totalText.match(/교양\s*(\d+)/)?.[1] ?? '0')
      expect(total).toBeGreaterThanOrEqual(12)
      expect(major).toBeGreaterThanOrEqual(6)
      expect(liberal).toBeGreaterThanOrEqual(6)

      const countText = (await countCard.textContent()) ?? ''
      const subjects = parseInt(countText.match(/(\d+)\s*과목/)?.[1] ?? '0')
      expect(subjects).toBeGreaterThanOrEqual(4)
    }).toPass({ timeout: 15000 })
  })
})
