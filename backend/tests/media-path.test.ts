import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toLocalStaticPath } from '../src/utils/media-path.ts'

test('toLocalStaticPath maps BFF and origin still URLs onto storage paths', () => {
  assert.equal(toLocalStaticPath('static/images/a.png'), 'static/images/a.png')
  assert.equal(toLocalStaticPath('/static/images/a.png'), 'static/images/a.png')
  assert.equal(toLocalStaticPath('/api/drama/static/images/a.png'), 'static/images/a.png')
  assert.equal(
    toLocalStaticPath('http://localhost:3000/api/drama/static/images/a.png'),
    'static/images/a.png',
  )
  assert.equal(toLocalStaticPath('https://cdn.example/x.png'), null)
  assert.equal(toLocalStaticPath('data:image/png;base64,abc'), null)
})
