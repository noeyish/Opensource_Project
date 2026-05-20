import { Page } from '@playwright/test'

// 테스트 전용 계정 — pytest conftest test_user와 동일.
// `make e2e-seed`로 팀 DB에 1회 시드. 환경마다 다른 계정 쓰려면 env로 override.
export const TEST_USER = {
  email: process.env.E2E_TEST_EMAIL || 'test@sogang.ac.kr',
  password: process.env.E2E_TEST_PASSWORD || 'password123',
}

/**
 * 로그인 후 대시보드(/dashboard)로 이동하는 공통 헬퍼
 */
export async function loginAs(page: Page, email = TEST_USER.email, password = TEST_USER.password) {
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type="submit"]')
  await page.waitForURL('/dashboard', { timeout: 10000 })
}
