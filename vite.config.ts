/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages はリポジトリ名のサブパス配信（NFR-03 / Q1）。
  base: '/ai_webrtc/',
  // basicSsl: 同一ネットワークのスマホ等から IP でアクセスする際、WebRTC の
  // getUserMedia（カメラ/マイク）は localhost 以外では HTTPS が必須なため自己署名証明書で配信する。
  plugins: [react(), basicSsl()],
  server: {
    // 仮想環境/コンテナ内で起動してもホスト側ブラウザから到達できるよう
    // 全ネットワークインターフェース（0.0.0.0）で待ち受ける。
    host: true,
    port: 5173,
    strictPort: true,
  },
  test: {
    // signaling のユニットテストは純粋関数（pako / base64）なので node 環境で十分。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
