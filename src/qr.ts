import QRCode from 'qrcode'
import jsQR from 'jsqr'

/**
 * ペイロード文字列から QR コードの dataURL を生成する（FR-15）。
 * 方式A（単一QR + 圧縮）想定。誤り訂正レベルは 'L' を起点とする。
 */
export async function generateQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width: 320,
  })
}

/**
 * canvas へ QR を描画する（任意の用途向け）。
 */
export async function drawQrToCanvas(
  canvas: HTMLCanvasElement,
  payload: string,
): Promise<void> {
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width: 320,
  })
}

/**
 * <video> の現在フレームを <canvas> 経由で ImageData 化し、jsQR でデコードする（FR-16）。
 * 検出できなければ null を返す。
 */
export function scanQrFromVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): string | null {
  const width = video.videoWidth
  const height = video.videoHeight
  if (width === 0 || height === 0) {
    return null
  }
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return null
  }
  ctx.drawImage(video, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  const result = jsQR(imageData.data, width, height, {
    inversionAttempts: 'dontInvert',
  })
  return result ? result.data : null
}

/**
 * スキャン用カメラ（背面優先）のストリームを取得する（FR-17）。
 */
export async function getScannerStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  })
}
