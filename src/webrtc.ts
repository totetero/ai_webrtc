export type PeerConnectionStatus =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed'

export interface PeerSessionHandlers {
  /** リモートの MediaStream が利用可能になったとき */
  onRemoteStream?: (stream: MediaStream) => void
  /** 接続状態が変化したとき */
  onStatusChange?: (status: PeerConnectionStatus) => void
}

const ICE_GATHERING_TIMEOUT_MS = 5000

/**
 * RTCPeerConnection を `{ iceServers: [] }`（host候補のみ / STUN・TURN無し）で
 * 包む薄いラッパ。non-trickle 方式で、SDP は ICE 収集完了まで待ってから確定する。
 */
export class PeerSession {
  private pc: RTCPeerConnection
  private localStream: MediaStream
  private remoteStream: MediaStream | null = null
  private handlers: PeerSessionHandlers
  private closed = false

  constructor(localStream: MediaStream, handlers: PeerSessionHandlers = {}) {
    this.localStream = localStream
    this.handlers = handlers
    this.pc = new RTCPeerConnection({ iceServers: [] })

    // ローカルの全トラックを追加（FR-05）
    for (const track of localStream.getTracks()) {
      this.pc.addTrack(track, localStream)
    }

    // リモートトラック受信（FR-08）
    this.pc.ontrack = (event) => {
      const stream = event.streams[0] ?? this.ensureRemoteStream(event.track)
      this.remoteStream = stream
      this.handlers.onRemoteStream?.(stream)
    }

    // 接続状態通知（FR-09）
    this.pc.onconnectionstatechange = () => {
      this.handlers.onStatusChange?.(this.pc.connectionState as PeerConnectionStatus)
    }
  }

  private ensureRemoteStream(track: MediaStreamTrack): MediaStream {
    if (!this.remoteStream) {
      this.remoteStream = new MediaStream()
    }
    this.remoteStream.addTrack(track)
    return this.remoteStream
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream
  }

  /** ICE 収集が complete になるまで待つ（最大 5 秒のフォールバック付き / FR-07） */
  private async waitForIceGatheringComplete(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') {
      return
    }
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.pc.removeEventListener('icegatheringstatechange', onChange)
        resolve()
      }
      const onChange = () => {
        if (this.pc.iceGatheringState === 'complete') {
          finish()
        }
      }
      const timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS)
      this.pc.addEventListener('icegatheringstatechange', onChange)
    })
  }

  /** 発信側: offer を生成し、ICE 収集完了まで待って確定 SDP を返す（FR-06/07） */
  async createOffer(): Promise<string> {
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    await this.waitForIceGatheringComplete()
    return this.pc.localDescription?.sdp ?? offer.sdp ?? ''
  }

  /** 応答側: answer を生成し、ICE 収集完了まで待って確定 SDP を返す（FR-06/07） */
  async createAnswer(): Promise<string> {
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    await this.waitForIceGatheringComplete()
    return this.pc.localDescription?.sdp ?? answer.sdp ?? ''
  }

  /** 相手の SDP を適用する */
  async setRemoteDescription(
    type: 'offer' | 'answer',
    sdp: string,
  ): Promise<void> {
    await this.pc.setRemoteDescription({ type, sdp })
  }

  /** PeerConnection を閉じ、ローカル/リモート両トラックを停止する（FR-10） */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const track of this.localStream.getTracks()) {
      track.stop()
    }
    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) {
        track.stop()
      }
    }
    this.pc.ontrack = null
    this.pc.onconnectionstatechange = null
    this.pc.close()
    this.handlers.onStatusChange?.('closed')
  }
}

/** カメラ/マイクを取得する（FR-02） */
export async function getLocalMediaStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true })
}
