import { defineConfig, devices } from '@playwright/test'

// 結合テスト（AC-06/07/08）。Chromium を fake media デバイスで起動し、
// dev サーバ上で握手 → connected 到達を検証する。
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  // 初回(コールド)起動時は dev サーバのビルドと WebRTC 初期化に時間がかかるため、
  // 一過性の遅延でこけないよう CI では 1 回だけリトライする。
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    // dev サーバは vite の basicSsl() で HTTPS 配信されるため https で揃える。
    baseURL: 'https://localhost:5173/ai_webrtc/',
    // 自己署名証明書を許容（basicSsl 由来）。これがないと webServer ヘルスチェックや
    // ページ遷移が証明書エラーで失敗する。
    ignoreHTTPSErrors: true,
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
    url: 'https://localhost:5173/ai_webrtc/',
    // webServer ヘルスチェックの url フェッチも自己署名証明書（basicSsl）を許容する。
    // use.ignoreHTTPSErrors はブラウザ context 用で、ヘルスチェックの取得には効かないため
    // webServer 側にも明示する（これがないと起動時に証明書エラーでタイムアウトする）。
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    // 初回ビルドを含むコールド起動を見込んで余裕を持たせる。
    timeout: 120_000,
  },
})
