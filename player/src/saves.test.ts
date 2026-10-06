import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestPersistence } from './saves.ts'

test('requestPersistence: already, granted, denied, unsupported, throwing', async () => {
  const s = (persisted: boolean, grant: boolean) => ({ persisted: async () => persisted, persist: async () => grant })
  assert.equal(await requestPersistence(s(true, false)), 'persisted')
  assert.equal(await requestPersistence(s(false, true)), 'persisted')
  assert.equal(await requestPersistence(s(false, false)), 'denied')
  assert.equal(await requestPersistence(undefined), 'unsupported')
  assert.equal(await requestPersistence({ persisted: async () => { throw new Error('x') }, persist: async () => true }), 'unsupported')
})
