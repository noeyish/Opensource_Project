import { defineConfig } from '@playwright/test'

// 기본은 로컬 (`make dev`) 대상. CI/팀 서버 대상 실행 시 E2E_BASE_URL env로 override.
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,       // OCR 대기 포함해서 2분
  retries: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
})
