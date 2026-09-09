import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPublicUuid,
  newPublicUuid,
  parseNumericId,
  publicId,
  toPublicDrama,
  toPublicEpisode,
} from '../src/utils/public-id.ts'

test('newPublicUuid is a uuid', () => {
  const id = newPublicUuid()
  assert.equal(isPublicUuid(id), true)
})

test('isPublicUuid rejects numeric ids', () => {
  assert.equal(isPublicUuid('4'), false)
  assert.equal(isPublicUuid('7'), false)
  assert.equal(isPublicUuid(4), false)
})

test('parseNumericId accepts integers and numeric strings', () => {
  assert.equal(parseNumericId(4), 4)
  assert.equal(parseNumericId('7'), 7)
  assert.equal(parseNumericId('04'), 4)
  assert.equal(parseNumericId(newPublicUuid()), null)
  assert.equal(parseNumericId('not-an-id'), null)
})

test('public drama/episode payloads expose uuid as id', () => {
  const drama = { id: 4, uuid: '11111111-1111-4111-8111-111111111111', title: 'igen 廣告' }
  const episode = {
    id: 7,
    uuid: '22222222-2222-4222-8222-222222222222',
    dramaId: 4,
    title: '第1集',
  }
  const publicDrama = toPublicDrama(drama)
  const publicEpisode = toPublicEpisode(episode, drama)
  assert.equal(publicDrama.id, drama.uuid)
  assert.equal(publicDrama.uuid, undefined)
  assert.equal(publicEpisode.id, episode.uuid)
  assert.equal(publicEpisode.drama_id, drama.uuid)
  assert.equal(publicEpisode.uuid, undefined)
  assert.equal(publicId(drama), drama.uuid)
})

test('publicId falls back to numeric pk when uuid is missing', () => {
  assert.equal(publicId({ id: 4, uuid: null }), '4')
})
