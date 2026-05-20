/**
 * 시나리오: 인증 필수 흐름 (메인 저니 진입점)
 * - 정상 로그인 → /dashboard 도달 + JWT 저장
 * - 미로그인 상태로 보호 페이지 접근 → /login 리다이렉트
 *
 * 사전 시드: `make e2e-seed`
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'

test.describe('로그인 흐름', () => {
  test('정상 로그인 → 대시보드 이동 및 JWT 저장', async ({ page }) => {
    await loginAs(page)

    await expect(page).toHaveURL('/dashboard')

    const token = await page.evaluate(() => localStorage.getItem('access_token'))
    expect(token).not.toBeNull()

    await expect(page.getByText('로그아웃')).toBeVisible()
  })

  test('미로그인 상태로 대시보드 접근 → /login 리다이렉트', async ({ page }) => {
    // /dashboard는 토큰 없으면 /login으로 (redirect 쿼리 파라미터 포함될 수 있음)
    await page.goto('/dashboard')
    await page.waitForURL(/\/login(\?|$)/, { timeout: 10000 })
    await expect(page).toHaveURL(/\/login(\?|$)/)
  })
})
