import { useEffect, useState } from 'react'
import { generateQrDataUrl } from '../qr'

interface QRDisplayProps {
  payload: string
  title: string
  caption: string
  /** ?debug=1 のとき true。ペイロード文字列の表示/コピーを出す（FR-27/28）。 */
  debug: boolean
}

/** 確定 SDP のペイロードを QR として表示する（FR-15）。 */
export function QRDisplay({ payload, title, caption, debug }: QRDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    generateQrDataUrl(payload)
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          // 容量超過などで QR 化できない場合（章7）
          setDataUrl(null)
          setError('QR を生成できませんでした。同じ WiFi に接続して再試行してください。')
        }
      })
    return () => {
      cancelled = true
    }
  }, [payload])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

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
