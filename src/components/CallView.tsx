import { useEffect, useRef } from 'react'

interface CallViewProps {
  localStream: MediaStream
  remoteStream: MediaStream | null
  onHangup: () => void
}

/** 通話画面（FR-22/23/24）。相手映像を全面、自分プレビューを隅に表示する。 */
export function CallView({ localStream, remoteStream, onHangup }: CallViewProps) {
  const localRef = useRef<HTMLVideoElement | null>(null)
  const remoteRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = localRef.current
    if (video && video.srcObject !== localStream) {
      video.srcObject = localStream
      video.play().catch(() => {})
    }
  }, [localStream])

  useEffect(() => {
    const video = remoteRef.current
    if (video && remoteStream && video.srcObject !== remoteStream) {
      video.srcObject = remoteStream
      // FR-26: ユーザー操作起点に近い遷移直後の play。失敗は黙殺。
      video.play().catch(() => {})
    }
  }, [remoteStream])

  return (
    <div className="call-view">
      <video
        ref={remoteRef}
        className="remote-video"
        playsInline
        autoPlay
        data-testid="remote-video"
      />
      <video
        ref={localRef}
        className="local-preview"
        playsInline
        autoPlay
        muted
        data-testid="local-preview"
      />
      <div className="call-controls">
        <button type="button" className="hangup" onClick={onHangup} data-testid="hangup">
          通話終了
        </button>
      </div>
    </div>
  )
}
