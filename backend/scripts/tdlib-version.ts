// Checks that TDLib loads on this machine. No login, no credentials, no network.
//   npm run tdlib:version
import { getTdjson } from 'prebuilt-tdlib'
import * as tdl from 'tdl'
import { configureTdlib } from '../src/telegram.ts'

configureTdlib()
const version = tdl.execute({ _: 'getOption', name: 'version' })
const commit = tdl.execute({ _: 'getOption', name: 'commit_hash' })
const show = (v: unknown) => (v && typeof v === 'object' && 'value' in v ? String((v as { value: unknown }).value) : JSON.stringify(v))
console.log(`tdjson: ${getTdjson()}`)
console.log(`TDLib version: ${show(version)}`)
console.log(`TDLib commit:  ${show(commit)}`)
