import { useEffect, useRef, useState } from 'react'
import { getScannerStream, scanQrFromVideo } from '../qr'
import { FrameCollector } from '../signaling'

interface QRScannerProps {
  title: string
  caption: string
  /** QR またはデバッグ入力でペイロードを取得したときに呼ぶ。 */
  onPayload: (payload: string) => void
  /** スキャン継続中に表示するヒント（誤種別・デコード失敗など / FR-21, 章7）。 */
  hint: string | null
  /** ?debug=1 のとき true。ペイロード直貼り入力欄を出す（FR-27/28）。 */
  debug: boolean
}

/** カメラから QR を読み取る（FR-16/17）。?debug=1 時は貼り付け入力も出す。 */
export function QRScanner({ title, caption, onPayload, hint, debug }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onPayloadRef = useRef(onPayload)
  useEffect(() => {
    onPayloadRef.current = onPayload
  }, [onPayload])

  const [cameraError, setCameraError] = useState<string | null>(null)
  const [pasteValue, setPasteValue] = useState('')
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  // 受信済みフレーム番号（1 始まり）。どの番号を受信済みかをドット列で示す（案B）。
  const [receivedIndices, setReceivedIndices] = useState<number[]>([])

  // フレームを自動収集するコレクタ。コンポーネントで 1 つだけ保持する。
  const collectorRef = useRef<FrameCollector | null>(null)
  if (collectorRef.current === null) {
    collectorRef.current = new FrameCollector()
  }
  // 全フレーム完成時に onPayload を 1 回だけ呼ぶための重複防止ガード。
  const completedRef = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let rafId = 0
    let stopped = false
    const collector = collectorRef.current!

    const tick = () => {
      if (stopped) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.readyState >= video.HAVE_CURRENT_DATA) {
        const data = scanQrFromVideo(video, canvas)
        if (data && !completedRef.current) {
          collector.add(data)
          setProgress(collector.progress)
          setReceivedIndices(collector.receivedIndices)
          if (collector.isComplete()) {
            const result = collector.result()
            if (result) {
              completedRef.current = true
              onPayloadRef.current(result)
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick)
    }

    // クリーンアップで参照する <video> を effect スコープに固定する。
    const videoEl = videoRef.current

    const start = async () => {
      try {
        stream = await getScannerStream()
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoEl) {
          videoEl.srcObject = stream
          await videoEl.play().catch(() => {})
        }
        rafId = requestAnimationFrame(tick)
      } catch {
        if (!stopped) {
          // カメラが無い/拒否でも、デバッグ貼り付けは使えるようにする。
          setCameraError('カメラを起動できませんでした。')
        }
      }
    }

    start()

    return () => {
      stopped = true
      cancelAnimationFrame(rafId)
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
      }
      if (videoEl) {
        videoEl.srcObject = null
      }
    }
  }, [])

  const submitPaste = () => {
    const trimmed = pasteValue.trim()
    if (trimmed) {
      onPayloadRef.current(trimmed)
    }
  }

  return (
    <div className="qr-scanner">
      <h2>{title}</h2>
      <p className="hint">{caption}</p>
      <div className="scanner-video-wrap">
        <video
          ref={videoRef}
          className="scanner-video"
          playsInline
          autoPlay
          muted
        />
      </div>
      <canvas ref={canvasRef} className="scanner-canvas" hidden />
      {progress ? (
        <p className="hint" data-testid="scan-progress">
          {progress.received}/{progress.total} 読取済み
        </p>
      ) : null}
      {progress ? (
        <div className="qr-frame-dots" data-testid="scan-frame-dots">
          {Array.from({ length: progress.total }, (_, i) => (
            <span
              key={i}
              className={
                receivedIndices.includes(i + 1) ? 'qr-frame-dot active' : 'qr-frame-dot'
              }
              aria-hidden="true"
            />
          ))}
        </div>
      ) : null}
      {cameraError ? <p className="hint">{cameraError}</p> : null}
      {hint ? <p className="error">{hint}</p> : null}
      {debug ? (
        <div className="debug-box" data-testid="debug-paste-box">
          <p className="debug-label">debug paste</p>
          <textarea
            className="debug-payload"
            data-testid="debug-paste-input"
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="相手のペイロード文字列を貼り付け"
            rows={4}
          />
          <button type="button" data-testid="debug-paste-submit" onClick={submitPaste}>
            貼り付けて適用
          </button>
        </div>
      ) : null}
    </div>
  )
}
