import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { RoleSelect } from './components/RoleSelect'
import { QRDisplay } from './components/QRDisplay'
import { QRScanner } from './components/QRScanner'
import { CallView } from './components/CallView'
import { PeerSession, getLocalMediaStream } from './webrtc'
import type { PeerConnectionStatus } from './webrtc'
import { decode, encode } from './signaling'

type Phase =
  | 'idle'
  | 'creatingOffer'
  | 'showOfferQR'
  | 'scanningAnswer'
  | 'scanningOffer'
  | 'creatingAnswer'
  | 'showAnswerQR'
  | 'inCall'
  | 'ended'

const CONNECT_TIMEOUT_MS = 30000

function useDebugFlag(): boolean {
  // ?debug=1 のときだけデバッグフックを出す（FR-27/28）。
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('debug') === '1'
}

function App() {
  const debug = useDebugFlag()

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [scanHint, setScanHint] = useState<string | null>(null)
  const [offerPayload, setOfferPayload] = useState('')
  const [answerPayload, setAnswerPayload] = useState('')
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  // 描画用にローカルストリームを state で保持する（ref はリソース管理用）。
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  // StrictMode の二重マウント・多重生成を防ぐため、可変リソースは ref で保持する（NFR-07）。
  const sessionRef = useRef<PeerSession | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 最新の phase を ref に同期する（render 中の ref 更新を避ける）。
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current)
      connectTimerRef.current = null
    }
  }, [])

  const teardown = useCallback(() => {
    clearConnectTimer()
    const hadSession = sessionRef.current !== null
    if (sessionRef.current) {
      sessionRef.current.close()
      sessionRef.current = null
    }
    // session.close() がローカルトラックも止めるが、session 未生成時の保険。
    if (localStreamRef.current && !hadSession) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    localStreamRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
  }, [clearConnectTimer])

  const handleStatus = useCallback(
    (status: PeerConnectionStatus) => {
      if (status === 'connected') {
        clearConnectTimer()
        setError(null)
        setPhase('inCall')
      } else if (status === 'disconnected' || status === 'failed') {
        if (phaseRef.current === 'inCall') {
          setError('切断されました。')
          teardown()
          setPhase('ended')
        }
      }
    },
    [clearConnectTimer, teardown],
  )

  const startConnectTimeout = useCallback(() => {
    clearConnectTimer()
    connectTimerRef.current = setTimeout(() => {
      if (phaseRef.current !== 'inCall') {
        setError('接続できませんでした。やり直してください。')
        teardown()
        setPhase('ended')
      }
    }, CONNECT_TIMEOUT_MS)
  }, [clearConnectTimer, teardown])

  const createSession = useCallback(
    (stream: MediaStream) => {
      const session = new PeerSession(stream, {
        onRemoteStream: (s) => setRemoteStream(s),
        onStatusChange: handleStatus,
      })
      sessionRef.current = session
      return session
    },
    [handleStatus],
  )

  // 発信フロー（FR-19）
  const startCaller = useCallback(async () => {
    setError(null)
    setScanHint(null)
    try {
      const stream = await getLocalMediaStream()
      localStreamRef.current = stream
      setLocalStream(stream)
      setPhase('creatingOffer')
      const session = createSession(stream)
      const sdp = await session.createOffer()
      setOfferPayload(encode('offer', sdp))
      setPhase('showOfferQR')
    } catch {
      teardown()
      setError('カメラとマイクを許可してください。')
      setPhase('idle')
    }
  }, [createSession, teardown])

  // 応答フロー（FR-20）
  const startCallee = useCallback(async () => {
    setError(null)
    setScanHint(null)
    try {
      const stream = await getLocalMediaStream()
      localStreamRef.current = stream
      setLocalStream(stream)
      createSession(stream)
      setPhase('scanningOffer')
    } catch {
      teardown()
      setError('カメラとマイクを許可してください。')
      setPhase('idle')
    }
  }, [createSession, teardown])

  const handleSelect = useCallback(
    (role: 'caller' | 'callee') => {
      if (role === 'caller') startCaller()
      else startCallee()
    },
    [startCaller, startCallee],
  )

  // 発信側: 相手の answer QR を読む（FR-19.4）
  const handleAnswerScanned = useCallback(
    async (payload: string) => {
      const session = sessionRef.current
      if (!session) return
      let decoded
      try {
        decoded = decode(payload)
      } catch {
        setScanHint('QR が読み取れませんでした。')
        return
      }
      if (decoded.type !== 'answer') {
        setScanHint('これは応答用の QR ではありません。相手の応答 QR を読み取ってください。')
        return
      }
      try {
        setScanHint(null)
        await session.setRemoteDescription('answer', decoded.sdp)
        startConnectTimeout()
      } catch {
        setScanHint('QR が読み取れませんでした。')
      }
    },
    [startConnectTimeout],
  )

  // 応答側: 相手の offer QR を読み、answer を生成（FR-20.2/3/4）
  const handleOfferScanned = useCallback(
    async (payload: string) => {
      const session = sessionRef.current
      if (!session) return
      if (phaseRef.current !== 'scanningOffer') return
      let decoded
      try {
        decoded = decode(payload)
      } catch {
        setScanHint('QR が読み取れませんでした。')
        return
      }
      if (decoded.type !== 'offer') {
        setScanHint('これは発信用の QR ではありません。相手の発信 QR を読み取ってください。')
        return
      }
      try {
        setScanHint(null)
        setPhase('creatingAnswer')
        await session.setRemoteDescription('offer', decoded.sdp)
        const sdp = await session.createAnswer()
        setAnswerPayload(encode('answer', sdp))
        startConnectTimeout()
        setPhase('showAnswerQR')
      } catch {
        setScanHint('QR が読み取れませんでした。')
        setPhase('scanningOffer')
      }
    },
    [startConnectTimeout],
  )

  const handleHangup = useCallback(() => {
    teardown()
    setPhase('ended')
  }, [teardown])

  const handleRestart = useCallback(() => {
    teardown()
    setError(null)
    setScanHint(null)
    setOfferPayload('')
    setAnswerPayload('')
    setPhase('idle')
  }, [teardown])

  // アンマウント時のクリーンアップ（StrictMode 二重マウント対策 / NFR-07）
  useEffect(() => {
    return () => {
      teardown()
    }
  }, [teardown])

  return (
    <div className="app-root">
      {phase === 'idle' ? (
        <RoleSelect onSelect={handleSelect} error={error} />
      ) : null}

      {phase === 'creatingOffer' || phase === 'creatingAnswer' ? (
        <div className="status-screen">
          <p>接続情報を生成中…</p>
        </div>
      ) : null}

      {phase === 'showOfferQR' ? (
        <>
          <QRDisplay
            payload={offerPayload}
            title="発信 QR（QR①）"
            caption="相手に読み取ってもらってください。"
            debug={debug}
          />
          <button type="button" className="next" onClick={() => setPhase('scanningAnswer')}>
            相手の応答 QR を読み取る
          </button>
        </>
      ) : null}

      {phase === 'scanningAnswer' ? (
        <QRScanner
          title="応答 QR を読み取る（QR②）"
          caption="相手の応答 QR をカメラに写してください。"
          onPayload={handleAnswerScanned}
          hint={scanHint}
          debug={debug}
        />
      ) : null}

      {phase === 'scanningOffer' ? (
        <QRScanner
          title="発信 QR を読み取る（QR①）"
          caption="相手の発信 QR をカメラに写してください。"
          onPayload={handleOfferScanned}
          hint={scanHint}
          debug={debug}
        />
      ) : null}

      {phase === 'showAnswerQR' ? (
        <QRDisplay
          payload={answerPayload}
          title="応答 QR（QR②）"
          caption="相手に読み取ってもらうと通話が始まります。"
          debug={debug}
        />
      ) : null}

      {phase === 'inCall' && localStream ? (
        <CallView
          localStream={localStream}
          remoteStream={remoteStream}
          onHangup={handleHangup}
        />
      ) : null}

      {phase === 'ended' ? (
        <div className="status-screen">
          <h2>通話を終了しました</h2>
          {error ? <p className="error">{error}</p> : null}
          <button type="button" className="primary" onClick={handleRestart}>
            最初に戻る
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default App
