import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58, bech32, bech32m, createBase58check } from '@scure/base'
import { Address } from '@ton/core'
import { detectFamilies, fingerprint, parseChain, sameAddress, toChecksumAddress, validateForChain } from '../src/vault/addresses.ts'

const b58c = createBase58check(sha256)
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)

test('EVM: EIP-55 vectors pass, a flipped case fails, lowercase passes with a note', () => {
  for (const a of [
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ]) {
    const r = validateForChain('ethereum', a)
    assert.ok(r.ok, a)
    assert.equal(r.ok && r.display, a)
    assert.equal(toChecksumAddress(a.toLowerCase()), a)
  }
  const bad = validateForChain('base', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')
  assert.equal(bad.ok, false)
  const lower = validateForChain('base', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')
  assert.ok(lower.ok && lower.note && lower.display === '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
  assert.equal(validateForChain('ethereum', '0x1234').ok, false)
})

test('TON: UQ, EQ, 0Q, kQ and raw forms of one wallet are the same address', () => {
  const addr = new Address(0, Buffer.from(bytes(32, 0xab)))
  const forms = [
    addr.toRawString(),
    addr.toString({ bounceable: false }),
    addr.toString({ bounceable: true }),
    addr.toString({ bounceable: false, testOnly: true }),
    addr.toString({ bounceable: true, testOnly: true }),
  ]
  for (const f of forms) assert.ok(validateForChain('ton', f).ok, f)
  for (const f of forms) assert.ok(sameAddress('ton', forms[0], f), f)
  const other = new Address(0, Buffer.from(bytes(32, 0xac))).toString({ bounceable: false })
  assert.equal(sameAddress('ton', forms[1], other), false)
  // One changed character breaks the CRC.
  const f = forms[1]
  const broken = f.slice(0, 10) + (f[10] === 'A' ? 'B' : 'A') + f.slice(11)
  assert.equal(validateForChain('ton', broken).ok, false)
})

test('Solana: 32-byte base58 keys pass, other lengths and non-base58 fail', () => {
  assert.ok(validateForChain('solana', '11111111111111111111111111111111').ok)
  assert.ok(validateForChain('solana', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').ok)
  assert.ok(validateForChain('solana', base58.encode(bytes(32, 9))).ok)
  assert.equal(validateForChain('solana', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5D0').ok, false)
  assert.equal(validateForChain('solana', base58.encode(bytes(64, 9))).ok, false)
})

test('Bitcoin: base58check P2PKH, bech32 v0 and bech32m v1 pass; bad checksums fail', () => {
  assert.ok(validateForChain('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').ok)
  assert.equal(validateForChain('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb').ok, false)
  const v0 = bech32.encode('bc', [0, ...bech32.toWords(bytes(20, 7))])
  const v1 = bech32m.encode('bc', [1, ...bech32m.toWords(bytes(32, 7))])
  assert.ok(validateForChain('bitcoin', v0).ok, v0)
  assert.ok(validateForChain('bitcoin', v1).ok, v1)
  // Taproot encoded with the wrong checksum variant (bech32 instead of bech32m) must fail.
  const wrong = bech32.encode('bc', [1, ...bech32.toWords(bytes(32, 7))])
  assert.equal(validateForChain('bitcoin', wrong).ok, false)
  assert.equal(validateForChain('bitcoin', v0.slice(0, -1) + (v0.endsWith('q') ? 'p' : 'q')).ok, false)
})

test('Tron: base58check with version 0x41 passes; Bitcoin version bytes do not', () => {
  const tron = b58c.encode(new Uint8Array([0x41, ...bytes(20, 5)]))
  assert.ok(tron.startsWith('T'))
  assert.ok(validateForChain('tron', tron).ok, tron)
  assert.ok(validateForChain('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').ok)
  assert.equal(validateForChain('tron', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').ok, false)
})

test('detectFamilies gives a format family, never a chain', () => {
  assert.deepEqual(detectFamilies('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), ['evm'])
  assert.deepEqual(detectFamilies('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), ['bitcoin'])
  assert.deepEqual(detectFamilies('hello there'), [])
})

test('parseChain accepts names and aliases', () => {
  assert.equal(parseChain('SOL'), 'solana')
  assert.equal(parseChain('gram'), 'ton')
  assert.equal(parseChain('base'), 'base')
  assert.equal(parseChain('dogecoin'), undefined)
})

test('fingerprint shows start, middle and end', () => {
  const a = 'UQAbcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL'
  const fp = fingerprint(a)
  assert.ok(fp.startsWith('UQAbcd') && fp.endsWith('GHIJKL'))
  assert.equal(fp.split('…').length, 3)
})
