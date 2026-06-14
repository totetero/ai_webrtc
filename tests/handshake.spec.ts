import { test, expect, type Page } from '@playwright/test'

// AC-07 / AC-08: ?debug=1 のデバッグフック（QRを介さずペイロード直貼り）経由で、
// 2タブに発信/応答を作り、握手 → 双方が通話画面（= connected）へ到達することを検証する。

async function readDebugPayload(page: Page): Promise<string> {
  const textarea = page.getByTestId('debug-payload')
  await expect(textarea).toBeVisible({ timeout: 30_000 })
  // ペイロードが空でなくなるまで待つ。
  await expect
    .poll(async () => (await textarea.inputValue()).length, { timeout: 30_000 })
    .toBeGreaterThan(0)
  return textarea.inputValue()
}

async function pastePayload(page: Page, payload: string): Promise<void> {
  await page.getByTestId('debug-paste-input').fill(payload)
  await page.getByTestId('debug-paste-submit').click()
}

test('debug-fork handshake reaches connected on both peers', async ({ context }) => {
  const caller = await context.newPage()
  const callee = await context.newPage()

  await caller.goto('/?debug=1')
  await callee.goto('/?debug=1')

  // 発信側: 発信 → offer QR / ペイロード生成
  await caller.getByRole('button', { name: '発信する' }).click()
  const offerPayload = await readDebugPayload(caller)

  // 発信側: 応答 QR の読み取り（貼り付け）画面へ
  await caller.getByRole('button', { name: '相手の応答 QR を読み取る' }).click()

  // 応答側: 応答 → offer 貼り付け → answer 生成
  await callee.getByRole('button', { name: '応答する' }).click()
  await pastePayload(callee, offerPayload)
  const answerPayload = await readDebugPayload(callee)

  // 発信側: answer を貼り付け → 接続確立
  await pastePayload(caller, answerPayload)

  // 双方が通話画面（remote-video + 通話終了ボタン）へ到達 = connected
  await expect(caller.getByTestId('hangup')).toBeVisible({ timeout: 30_000 })
  await expect(callee.getByTestId('hangup')).toBeVisible({ timeout: 30_000 })
  await expect(caller.getByTestId('remote-video')).toBeVisible()
  await expect(callee.getByTestId('remote-video')).toBeVisible()
})
