import { describe, it, expect } from 'vitest'
import { encode, decode, minifySdp } from './signaling'

// 代表的な offer SDP（host候補のみ + 念のため srflx を含む）
const OFFER_SDP = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
a=msid-semantic: WMS stream
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:1 1 udp 2122260223 192.168.1.10 50000 typ host generation 0
a=candidate:2 1 udp 1686052607 203.0.113.1 50000 typ srflx raddr 192.168.1.10 rport 50000 generation 0
a=ice-ufrag:abcd
a=ice-pwd:efghijklmnopqrstuvwxyz1234
a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00
a=setup:actpass
a=mid:0
a=sendrecv
a=rtpmap:111 opus/48000/2
m=video 9 UDP/TLS/RTP/SAVPF 96
c=IN IP4 0.0.0.0
a=candidate:1 1 udp 2122260223 192.168.1.10 50001 typ host generation 0
a=ice-ufrag:abcd
a=ice-pwd:efghijklmnopqrstuvwxyz1234
a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00
a=setup:actpass
a=mid:1
a=sendrecv
a=rtpmap:96 VP8/90000
`

const ANSWER_SDP = OFFER_SDP.replace(/a=setup:actpass/g, 'a=setup:active')

describe('minifySdp', () => {
  it('removes non-host candidate lines (srflx/relay/prflx)', () => {
    const min = minifySdp(OFFER_SDP)
    expect(min).not.toContain('typ srflx')
    expect(min).not.toContain('typ relay')
    expect(min).not.toContain('typ prflx')
  })

  it('keeps host candidate lines', () => {
    const min = minifySdp(OFFER_SDP)
    expect(min).toContain('typ host')
  })

  it('preserves lines required for setRemoteDescription', () => {
    const min = minifySdp(OFFER_SDP)
    for (const required of [
      'v=0',
      'm=audio',
      'm=video',
      'a=fingerprint:',
      'a=ice-ufrag:abcd',
      'a=ice-pwd:',
      'a=setup:',
      'a=mid:0',
      'a=mid:1',
      'a=rtpmap:111 opus/48000/2',
      'a=rtpmap:96 VP8/90000',
    ]) {
      expect(min).toContain(required)
    }
  })
})

describe('encode/decode roundtrip', () => {
  it('roundtrips an offer with matching type', () => {
    const payload = encode('offer', OFFER_SDP)
    const decoded = decode(payload)
    expect(decoded.type).toBe('offer')
    // 最小化済みSDPと等価（行集合が一致）
    expect(decoded.sdp).toBe(minifySdp(OFFER_SDP))
  })

  it('roundtrips an answer with matching type', () => {
    const payload = encode('answer', ANSWER_SDP)
    const decoded = decode(payload)
    expect(decoded.type).toBe('answer')
    expect(decoded.sdp).toBe(minifySdp(ANSWER_SDP))
  })

  it('produces a base64url-safe payload (no +, /, =, whitespace)', () => {
    const payload = encode('offer', OFFER_SDP)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('decoded sdp retains essential SDP structure', () => {
    const decoded = decode(encode('offer', OFFER_SDP))
    expect(decoded.sdp).toContain('v=0')
    expect(decoded.sdp).toContain('a=fingerprint:')
    expect(decoded.sdp).toContain('a=ice-ufrag:')
    expect(decoded.sdp).toContain('a=ice-pwd:')
    expect(decoded.sdp).not.toContain('typ srflx')
  })

  it('throws on corrupt payload', () => {
    expect(() => decode('!!!not-valid!!!')).toThrow()
  })

  it('throws on empty payload', () => {
    expect(() => decode('')).toThrow()
  })
})
