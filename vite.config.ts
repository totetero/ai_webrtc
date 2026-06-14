import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
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
})
