/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages はリポジトリ名のサブパス配信（NFR-03 / Q1）。
  base: '/ai_webrtc/',
  plugins: [react()],
  test: {
    // signaling のユニットテストは純粋関数（pako / base64）なので node 環境で十分。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
