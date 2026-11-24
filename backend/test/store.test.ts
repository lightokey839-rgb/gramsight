import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { VaultStore, entryLabel, normalizeName } from '../src/vault/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'gramsight-store-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const SOL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SOL2 = '11111111111111111111111111111111'
const EVM_LOWER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'

test('upsert, replace, list, remove', () => {
  const store = new VaultStore(join(dir, 'a.json'))
  assert.deepEqual(store.list(), [])
  const first = store.upsert('solana', 'Main', SOL)
  assert.equal(first.previous, undefined)
  assert.equal(first.entry.name, 'main')
  assert.equal(entryLabel(first.entry), 'Solana main')

  const second = store.upsert('solana', 'main', SOL2)
  assert.equal(second.previous?.address, SOL)
  assert.equal(store.get('solana', 'main')?.address, SOL2)
  assert.equal(store.get('solana', 'main')?.addedAt, first.entry.addedAt)

  const evm = store.upsert('base', 'main', EVM_LOWER)
  assert.equal(evm.entry.address, '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed') // stored in checksum form
  assert.deepEqual(store.list().map(entryLabel), ['Base main', 'Solana main'])
  assert.equal(store.byChain('base').length, 1)

  assert.equal(store.remove('solana', 'main')?.address, SOL2)
  assert.equal(store.remove('solana', 'main'), undefined)
  assert.equal(store.list().length, 1)
})

test('invalid addresses and names are refused, nothing is written', () => {
  const store = new VaultStore(join(dir, 'b.json'))
  assert.throws(() => store.upsert('solana', 'main', EVM_LOWER), /Not a valid Solana address/)
  assert.throws(() => store.upsert('ethereum', 'bad name!', EVM_LOWER), /Name must be/)
  assert.deepEqual(store.list(), [])
  assert.equal(normalizeName('Cold-2'), 'cold-2')
  assert.equal(normalizeName(''), undefined)
})

test('starters are recorded once and the file holds only public data', () => {
  const path = join(dir, 'c.json')
  const store = new VaultStore(path)
  assert.equal(store.recordStarter(42, 'ada'), true)
  assert.equal(store.recordStarter(42, 'ada'), false)
  assert.equal(store.starters()['42']?.username, 'ada')
  store.upsert('solana', 'main', SOL)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(Object.keys(raw).sort(), ['contacts', 'entries', 'starters', 'version'])
})
