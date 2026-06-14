import { defineConfig, devices } from '@playwright/test'

// 結合テスト（AC-06/07/08）。Chromium を fake media デバイスで起動し、
// dev サーバ上で握手 → connected 到達を検証する。
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173/ai_webrtc/',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://localhost:5173/ai_webrtc/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
