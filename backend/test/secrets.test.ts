import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58, createBase58check } from '@scure/base'
import { detectSecret } from '../src/vault/secrets.ts'

const b58c = createBase58check(sha256)
const hex64 = 'a'.repeat(32) + '0123456789abcdef'.repeat(2)

test('seed phrases are detected, including numbered and comma-separated ones', () => {
  const twelve = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  assert.equal(detectSecret(twelve), 'seed phrase')
  const numbered = twelve.split(' ').map((w, i) => `${i + 1}. ${w}`).join('\n')
  assert.equal(detectSecret(numbered), 'seed phrase')
  assert.equal(detectSecret(twelve.replace(/ /g, ', ')), 'seed phrase')
})

test('ordinary chat text is not flagged', () => {
  assert.equal(detectSecret('Hey, can you send me your Solana address for the dinner money tonight please?'), undefined)
  assert.equal(detectSecret('/add solana main TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), undefined)
  assert.equal(detectSecret('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), undefined)
  assert.equal(detectSecret('abandon ability able about above absent absorb abstract absurd abuse access'), undefined) // 11 words
})

test('a 64-hex private key is detected, a TON raw address is not', () => {
  assert.equal(detectSecret(hex64), 'private key')
  assert.equal(detectSecret(`my key 0x${hex64}`), 'private key')
  assert.equal(detectSecret(`0:${hex64}`), undefined)
  assert.equal(detectSecret(`/add ton main -1:${hex64}`), undefined)
})

test('extended keys, WIF keys and Solana secret keys are detected', () => {
  const xprv =
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
  assert.equal(detectSecret(xprv), 'extended private key')
  const wif = b58c.encode(new Uint8Array([0x80, ...new Uint8Array(32).fill(3), 0x01]))
  assert.equal(detectSecret(`here: ${wif}`), 'private key')
  assert.equal(detectSecret(base58.encode(new Uint8Array(64).fill(4))), 'private key')
  assert.equal(detectSecret(`[${new Array(64).fill(17).join(',')}]`), 'private key')
})
