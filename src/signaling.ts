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
