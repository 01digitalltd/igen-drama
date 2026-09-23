import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageSizeForAspectRatio } from '../src/services/image-size.ts'

test('maps drama aspect_ratio to storyboard still size', () => {
  assert.equal(imageSizeForAspectRatio('9:16'), '1080x1920')
  assert.equal(imageSizeForAspectRatio('16:9'), '1920x1080')
  assert.equal(imageSizeForAspectRatio('1:1'), '1080x1080')
  assert.equal(imageSizeForAspectRatio('21:9'), '1890x810')
  assert.equal(imageSizeForAspectRatio('3:4'), '1080x1440')
  assert.equal(imageSizeForAspectRatio('4:3'), '1440x1080')
  assert.equal(imageSizeForAspectRatio('adaptive'), '1920x1080')
  assert.equal(imageSizeForAspectRatio(null), '1920x1080')
})
