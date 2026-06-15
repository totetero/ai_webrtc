import { deflate, inflate } from 'pako'

export type SignalType = 'offer' | 'answer'

export interface DecodedSignal {
  type: SignalType
  sdp: string
}

/**
 * SDP を最小化する。
 * - host 以外の ICE 候補行（srflx / relay / prflx）を除去する。
 * - 余分な空行を整理する。
 * setRemoteDescription に必要な行（m= / c= / a=fingerprint / a=ice-* / a=setup /
 * a=mid / a=rtpmap 等）は保持する。
 */
export function minifySdp(sdp: string): string {
  const lines = sdp.split(/\r\n|\r|\n/)
  const kept: string[] = []
  for (const line of lines) {
    // host 以外の candidate 行を除去する
    if (line.startsWith('a=candidate:') && !/\btyp host\b/.test(line)) {
      continue
    }
    kept.push(line)
  }
  // 末尾の空行を整理しつつ、行末に改行を1つ付ける（SDP は LF 区切り）
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
    kept.pop()
  }
  return kept.join('\n') + '\n'
}

const TYPE_TO_TAG: Record<SignalType, 'o' | 'a'> = {
  offer: 'o',
  answer: 'a',
}

const TAG_TO_TYPE: Record<string, SignalType> = {
  o: 'offer',
  a: 'answer',
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('invalid base64url payload')
  }
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  const binary =
    typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 最小化済み SDP を deflate 圧縮し、type タグと結合して base64url の単一文字列にする。
 * 形式: 先頭1文字が type タグ('o' | 'a')、残りが deflate 済み SDP の base64url。
 */
export function encode(type: SignalType, sdp: string): string {
  const tag = TYPE_TO_TAG[type]
  if (!tag) {
    throw new Error(`unknown signal type: ${type}`)
  }
  const minified = minifySdp(sdp)
  const compressed = deflate(minified)
  return tag + bytesToBase64url(compressed)
}

/**
 * encode の逆変換。type と最小化済み SDP を復元する。
 * 不正・破損文字列には例外を投げる。
 */
export function decode(payload: string): DecodedSignal {
  if (!payload || payload.length < 2) {
    throw new Error('empty or too short payload')
  }
  const tag = payload[0]
  const type = TAG_TO_TYPE[tag]
  if (!type) {
    throw new Error(`unknown signal tag: ${tag}`)
  }
  const body = payload.slice(1)
  const bytes = base64urlToBytes(body)
  let sdp: string
  try {
    sdp = inflate(bytes, { to: 'string' })
  } catch (e) {
    throw new Error('failed to inflate payload', { cause: e })
  }
  return { type, sdp }
}

// ---------------------------------------------------------------------------
// フレーム層
//
// encode() が返すフル文字列を複数の QR フレームに分割し、読取側で自動収集して
// 元のフル文字列へ復元するための層。既存の encode/decode/minifySdp は不変。
//
// フレーム形式: `${sid}.${idx}.${total}.${body}`
//   - sid:   生成ごとのセッションID（4 文字 [a-z0-9]）
//   - idx:   フレーム番号（1 始まり）
//   - total: フレーム総数
//   - body:  フル文字列の一部（base64url 文字のみ。`.` を含まない）
// ---------------------------------------------------------------------------

/** 1 フレームの body 最大文字数（QR 密度の上限）。実機検証後に調整可能。 */
export const MAX_FRAME_BODY = 180

const SID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const SID_LENGTH = 4

/** 4 文字のセッションID（crypto 由来、[a-z0-9]）を生成する。 */
export function newSessionId(): string {
  const bytes = new Uint8Array(SID_LENGTH)
  crypto.getRandomValues(bytes)
  let sid = ''
  for (let i = 0; i < SID_LENGTH; i++) {
    sid += SID_ALPHABET[bytes[i] % SID_ALPHABET.length]
  }
  return sid
}

/**
 * フル文字列を maxBody 以内に分割し、フレーム文字列配列を返す。
 * - フレーム数 = ceil(payload.length / maxBody)。各 body 長はなるべく均等に分配する。
 * - 空文字列は不正入力として例外を投げる。
 */
export function buildFrames(
  payload: string,
  sid: string,
  maxBody: number = MAX_FRAME_BODY,
): string[] {
  if (!payload) {
    throw new Error('buildFrames: empty payload')
  }
  const total = Math.ceil(payload.length / maxBody)
  // body 長をなるべく均等に分配する（差は高々 1 文字）。
  const base = Math.floor(payload.length / total)
  const remainder = payload.length % total
  const frames: string[] = []
  let offset = 0
  for (let i = 0; i < total; i++) {
    const size = base + (i < remainder ? 1 : 0)
    const body = payload.slice(offset, offset + size)
    offset += size
    frames.push(`${sid}.${i + 1}.${total}.${body}`)
  }
  return frames
}

export interface ParsedFrame {
  sid: string
  idx: number
  total: number
  body: string
}

/**
 * フレーム文字列をパースする。書式・数値妥当性を検証し、不正なら null。
 * 先頭から 3 つの `.` までを sid / idx / total とし、残り全体を body とする。
 */
export function parseFrame(s: string): ParsedFrame | null {
  if (!s) {
    return null
  }
  const first = s.indexOf('.')
  if (first <= 0) {
    return null
  }
  const second = s.indexOf('.', first + 1)
  if (second < 0) {
    return null
  }
  const third = s.indexOf('.', second + 1)
  if (third < 0) {
    return null
  }
  const sid = s.slice(0, first)
  const idxStr = s.slice(first + 1, second)
  const totalStr = s.slice(second + 1, third)
  const body = s.slice(third + 1)
  if (!sid || !body) {
    return null
  }
  if (!/^\d+$/.test(idxStr) || !/^\d+$/.test(totalStr)) {
    return null
  }
  const idx = Number(idxStr)
  const total = Number(totalStr)
  if (total < 1 || idx < 1 || idx > total) {
    return null
  }
  return { sid, idx, total, body }
}

/**
 * 複数フレームを自動収集し、そろったら元のフル文字列へ復元するコレクタ。
 * - 不正フレームは無視。
 * - 収集中と異なる sid のフレームが来たらリセットして新しい sid を採用する。
 * - 同一 idx の重複投入は冪等（上書き）。
 */
export class FrameCollector {
  private sid: string | null = null
  private total = 0
  private bodies = new Map<number, string>()

  add(frame: string): void {
    const parsed = parseFrame(frame)
    if (!parsed) {
      return
    }
    if (this.sid !== parsed.sid) {
      // 新しい sid（初回 or 別 sid）に切り替えてリセットする。
      this.sid = parsed.sid
      this.total = parsed.total
      this.bodies = new Map()
    }
    // 同一 idx は上書き（冪等）。
    this.bodies.set(parsed.idx, parsed.body)
  }

  /**
   * 受信済みフレーム番号（1 始まり）を昇順にソートした配列を返す。
   * まだ何も受信していない / reset 後は空配列。内部状態は変更しない（純粋な導出）。
   */
  get receivedIndices(): number[] {
    return Array.from(this.bodies.keys()).sort((a, b) => a - b)
  }

  get progress(): { received: number; total: number } | null {
    if (this.sid === null) {
      return null
    }
    return { received: this.bodies.size, total: this.total }
  }

  isComplete(): boolean {
    if (this.sid === null || this.total < 1) {
      return false
    }
    for (let i = 1; i <= this.total; i++) {
      if (!this.bodies.has(i)) {
        return false
      }
    }
    return true
  }

  result(): string | null {
    if (!this.isComplete()) {
      return null
    }
    let out = ''
    for (let i = 1; i <= this.total; i++) {
      out += this.bodies.get(i)!
    }
    return out
  }

  reset(): void {
    this.sid = null
    this.total = 0
    this.bodies = new Map()
  }
}
