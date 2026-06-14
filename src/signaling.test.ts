import { describe, it, expect } from 'vitest'
import {
  encode,
  decode,
  minifySdp,
  MAX_FRAME_BODY,
  newSessionId,
  buildFrames,
  parseFrame,
  FrameCollector,
} from './signaling'

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

describe('newSessionId', () => {
  it('returns a 4-character lowercase alphanumeric id', () => {
    for (let i = 0; i < 50; i++) {
      const sid = newSessionId()
      expect(sid).toMatch(/^[a-z0-9]{4}$/)
    }
  })
})

describe('buildFrames', () => {
  const sid = 'ab12'

  it('throws on empty payload', () => {
    expect(() => buildFrames('', sid)).toThrow()
  })

  it('produces a single frame when payload fits MAX_FRAME_BODY', () => {
    const payload = 'x'.repeat(MAX_FRAME_BODY)
    const frames = buildFrames(payload, sid)
    expect(frames).toHaveLength(1)
    const parsed = parseFrame(frames[0])
    expect(parsed).not.toBeNull()
    expect(parsed!.idx).toBe(1)
    expect(parsed!.total).toBe(1)
    expect(parsed!.body).toBe(payload)
  })

  it('produces two frames when payload exceeds MAX_FRAME_BODY by one', () => {
    const payload = 'x'.repeat(MAX_FRAME_BODY + 1)
    const frames = buildFrames(payload, sid)
    expect(frames).toHaveLength(2)
  })

  it('keeps every body within MAX_FRAME_BODY', () => {
    const payload = 'y'.repeat(MAX_FRAME_BODY * 3 + 7)
    const frames = buildFrames(payload, sid)
    for (const f of frames) {
      const parsed = parseFrame(f)
      expect(parsed).not.toBeNull()
      expect(parsed!.body.length).toBeLessThanOrEqual(MAX_FRAME_BODY)
    }
  })

  it('respects a custom maxBody', () => {
    const payload = 'z'.repeat(25)
    const frames = buildFrames(payload, sid, 10)
    expect(frames).toHaveLength(3)
    for (const f of frames) {
      expect(parseFrame(f)!.body.length).toBeLessThanOrEqual(10)
    }
  })
})

describe('parseFrame', () => {
  it('parses a well-formed frame', () => {
    expect(parseFrame('ab12.1.3.HELLO')).toEqual({
      sid: 'ab12',
      idx: 1,
      total: 3,
      body: 'HELLO',
    })
  })

  it('keeps the remainder as body even though body never contains dots', () => {
    // body は base64url のみだが、パースは「先頭3つの.」で行うことを確認
    const parsed = parseFrame('sid0.2.4.aBcD_-12')
    expect(parsed).toEqual({ sid: 'sid0', idx: 2, total: 4, body: 'aBcD_-12' })
  })

  it('returns null for missing fields', () => {
    expect(parseFrame('ab12.1.3')).toBeNull()
    expect(parseFrame('ab12.1')).toBeNull()
    expect(parseFrame('')).toBeNull()
  })

  it('returns null for non-integer idx/total', () => {
    expect(parseFrame('ab12.1.5x.body')).toBeNull()
    expect(parseFrame('ab12.1.5.5.body')).toEqual({
      sid: 'ab12',
      idx: 1,
      total: 5,
      body: '5.body',
    })
    expect(parseFrame('ab12.x.3.body')).toBeNull()
  })

  it('returns null when idx is out of range', () => {
    expect(parseFrame('ab12.0.3.body')).toBeNull()
    expect(parseFrame('ab12.4.3.body')).toBeNull()
  })

  it('returns null when total is below 1', () => {
    expect(parseFrame('ab12.1.0.body')).toBeNull()
  })

  it('returns null for empty sid or body', () => {
    expect(parseFrame('.1.1.body')).toBeNull()
    expect(parseFrame('ab12.1.1.')).toBeNull()
  })
})

describe('FrameCollector', () => {
  const sid = 'ab12'

  it('reassembles frames back into the original payload', () => {
    const payload = encode('offer', OFFER_SDP)
    const frames = buildFrames(payload, sid, 40)
    const collector = new FrameCollector()
    for (const f of frames) {
      collector.add(f)
    }
    expect(collector.isComplete()).toBe(true)
    expect(collector.result()).toBe(payload)
  })

  it('reassembles a single-frame payload', () => {
    const collector = new FrameCollector()
    collector.add(`${sid}.1.1.ONLYBODY`)
    expect(collector.isComplete()).toBe(true)
    expect(collector.result()).toBe('ONLYBODY')
  })

  it('reassembles frames added out of order', () => {
    const payload = 'abcdefghijklmnop'
    const frames = buildFrames(payload, sid, 4)
    const collector = new FrameCollector()
    const shuffled = [...frames].reverse()
    for (const f of shuffled) {
      collector.add(f)
    }
    expect(collector.result()).toBe(payload)
  })

  it('is idempotent for duplicate idx', () => {
    const payload = 'abcdefgh'
    const frames = buildFrames(payload, sid, 4)
    const collector = new FrameCollector()
    collector.add(frames[0])
    collector.add(frames[0])
    collector.add(frames[0])
    expect(collector.isComplete()).toBe(false)
    expect(collector.progress).toEqual({ received: 1, total: 2 })
    collector.add(frames[1])
    expect(collector.isComplete()).toBe(true)
    expect(collector.result()).toBe(payload)
  })

  it('reports progress', () => {
    const collector = new FrameCollector()
    expect(collector.progress).toBeNull()
    collector.add(`${sid}.1.3.AA`)
    expect(collector.progress).toEqual({ received: 1, total: 3 })
    collector.add(`${sid}.2.3.BB`)
    expect(collector.progress).toEqual({ received: 2, total: 3 })
  })

  it('resets when a frame with a different sid arrives', () => {
    const collector = new FrameCollector()
    collector.add(`ab12.1.2.AA`)
    expect(collector.progress).toEqual({ received: 1, total: 2 })
    // 別 sid のフレーム → リセットして追従
    collector.add(`cd34.1.3.XX`)
    expect(collector.progress).toEqual({ received: 1, total: 3 })
    collector.add(`cd34.2.3.YY`)
    collector.add(`cd34.3.3.ZZ`)
    expect(collector.isComplete()).toBe(true)
    expect(collector.result()).toBe('XXYYZZ')
  })

  it('ignores invalid frames without corrupting state', () => {
    const collector = new FrameCollector()
    collector.add(`${sid}.1.2.AA`)
    collector.add('garbage')
    collector.add(`${sid}.9.2.BB`) // idx > total
    collector.add('')
    expect(collector.progress).toEqual({ received: 1, total: 2 })
    expect(collector.isComplete()).toBe(false)
    collector.add(`${sid}.2.2.BB`)
    expect(collector.isComplete()).toBe(true)
    expect(collector.result()).toBe('AABB')
  })

  it('clears state on reset', () => {
    const collector = new FrameCollector()
    collector.add(`${sid}.1.2.AA`)
    collector.reset()
    expect(collector.progress).toBeNull()
    expect(collector.isComplete()).toBe(false)
    expect(collector.result()).toBeNull()
  })
})
