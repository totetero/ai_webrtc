import { useEffect, useState } from 'react'
import { generateQrDataUrl } from '../qr'
import { buildFrames, newSessionId } from '../signaling'

interface QRDisplayProps {
  payload: string
  title: string
  caption: string
  /** ?debug=1 のとき true。ペイロード文字列の表示/コピーを出す（FR-27/28）。 */
  debug: boolean
}

/** 表示フレームの循環間隔（ミリ秒）。実機調整可能な定数。 */
const CYCLE_INTERVAL_MS = 700

/** 確定 SDP のペイロードを複数 QR フレームに分割し、自動循環表示する（FR-15）。 */
export function QRDisplay({ payload, title, caption, debug }: QRDisplayProps) {
  // フレームごとの dataURL を初回にまとめて生成して保持する。
  const [dataUrls, setDataUrls] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  const [copied, setCopied] = useState(false)

  // payload が変わったときのみフレームを生成し、全フレームの dataURL をまとめて作る。
  useEffect(() => {
    let cancelled = false
    setDataUrls([])
    setError(null)
    setCurrent(0)

    const sid = newSessionId()
    const frames = buildFrames(payload, sid)
    Promise.all(frames.map((frame) => generateQrDataUrl(frame)))
      .then((urls) => {
        if (!cancelled) {
          setDataUrls(urls)
        }
      })
      .catch(() => {
        if (!cancelled) {
          // 容量超過などで QR 化できない場合（章7）
          setDataUrls([])
          setError('QR を生成できませんでした。同じ WiFi に接続して再試行してください。')
        }
      })

    return () => {
      cancelled = true
    }
  }, [payload])

  // フレームを 1 枚ずつ循環表示する。アンマウント／フレーム変更で確実に解除する。
  useEffect(() => {
    if (dataUrls.length <= 1) {
      return
    }
    const id = setInterval(() => {
      setCurrent((prev) => (prev + 1) % dataUrls.length)
    }, CYCLE_INTERVAL_MS)
    return () => {
      clearInterval(id)
    }
  }, [dataUrls])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const total = dataUrls.length
  const idx = total > 0 ? current + 1 : 0
  const dataUrl = total > 0 ? dataUrls[current] : null

  return (
    <div className="qr-display">
      <h2>{title}</h2>
      <p className="hint">{caption}</p>
      {error ? (
        <p className="error">{error}</p>
      ) : dataUrl ? (
        <img className="qr-image" src={dataUrl} alt="接続用QRコード" width={320} height={320} />
      ) : (
        <p className="hint">生成中…</p>
      )}
      {total > 0 ? (
        <div className="qr-frame-indicator" data-testid="qr-frame-indicator">
          <p className="hint" data-testid="qr-frame-counter">
            {idx} / {total}
          </p>
          <div className="qr-frame-dots" data-testid="qr-frame-dots">
            {dataUrls.map((_, i) => (
              <span
                key={i}
                className={i === current ? 'qr-frame-dot active' : 'qr-frame-dot'}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      ) : null}
      {debug ? (
        <div className="debug-box" data-testid="debug-payload-box">
          <p className="debug-label">debug payload</p>
          <textarea
            readOnly
            className="debug-payload"
            data-testid="debug-payload"
            value={payload}
            rows={4}
          />
          <button type="button" onClick={handleCopy}>
            {copied ? 'コピーしました' : 'ペイロードをコピー'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
