/**
 * 메인 저니: 로그인 → 강의 검색 → 시간표 슬롯에 담기
 *
 * 서비스 핵심 행위 한 줄기. UI 디테일 변경엔 둔감하게, 결과로 검증.
 *
 * 사전 시드: `make e2e-seed`
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'

const SEARCH_KEYWORD = '컴퓨터'

test.describe('메인 저니: 강의 검색 → 시간표 담기', () => {
  test('검색 결과의 첫 강의를 슬롯에 담으면 "담김" 으로 표시', async ({ page }) => {
    await loginAs(page)
    await expect(page).toHaveURL('/dashboard')

    // 과목 테이블이 로드되어야 검색 가능
    await expect(page.locator('table').first()).toBeVisible({ timeout: 15000 })

    // 검색어 입력 → 검색
    await page.fill('input[placeholder*="검색"]', SEARCH_KEYWORD)
    await page.click('button:has-text("검색")')

    // 결과 1개 이상
    const firstRow = page.locator('table tbody tr').first()
    await expect(firstRow).toBeVisible({ timeout: 5000 })

    // 첫 행의 "추가" 버튼 → 슬롯 dropdown 펼침
    const firstAddBtn = firstRow.locator('button:has-text("추가")')
    await firstAddBtn.click()

    // 아직 담기지 않은 슬롯이 있으면 거기 클릭. 모두 이미 담겨있으면 skip.
    const availableSlot = page.locator('button[title*="에 추가"]').first()
    if ((await availableSlot.count()) > 0) {
      await availableSlot.click()
      // 다시 dropdown 펼쳐서 상태 재확인
      await firstAddBtn.click()
    }

    // 최종: 적어도 한 슬롯은 "이미 담김" 상태 — 멱등
    await expect(page.locator('button[title="이미 담김"]').first()).toBeVisible({ timeout: 5000 })
  })
})
