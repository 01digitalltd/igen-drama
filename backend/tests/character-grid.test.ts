import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  ORANGE_GRID_COLOR,
  applyCharacterOrangeGridToRefs,
  composeVideoPromptAfterCharacterGrid,
  gridLineWidth,
  isCharacterMediaRef,
  normalizeMediaKey,
  overlayOrangeGrid,
  overlayOrangeGridOnRef,
  withOrangeGridRemovalPrompt,
} from '../src/services/character-grid.ts'

function hexToRgb(hex: string) {
  const n = hex.replace('#', '')
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  }
}

async function pixelAt(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return { r: data[i], g: data[i + 1], b: data[i + 2], width: info.width, height: info.height }
}

function isOrange(px: { r: number; g: number; b: number }) {
  const target = hexToRgb(ORANGE_GRID_COLOR)
  return Math.abs(px.r - target.r) < 40 && Math.abs(px.g - target.g) < 50 && px.b < 40
}

test('grid line width scales with the shorter side', () => {
  assert.equal(gridLineWidth(1920, 1080), 7)
  assert.equal(gridLineWidth(768, 768), 5)
  assert.equal(gridLineWidth(96, 96), 3)
})

test('normalizeMediaKey strips host, query, and leading slash', () => {
  assert.equal(normalizeMediaKey('/static/images/hero.png'), 'static/images/hero.png')
  assert.equal(
    normalizeMediaKey('https://cdn.example.com/tenant/static/images/hero.png?w=8'),
    'static/images/hero.png',
  )
  assert.equal(normalizeMediaKey('static/images/hero.png'), 'static/images/hero.png')
})

test('isCharacterMediaRef matches CDN stills to stored static paths', () => {
  const keys = ['static/images/hero.png', 'https://cdn.example.com/static/images/other.jpg']
  assert.equal(isCharacterMediaRef('/static/images/hero.png', keys), true)
  assert.equal(isCharacterMediaRef('https://cdn.example.com/x/static/images/hero.png', keys), true)
  assert.equal(isCharacterMediaRef('static/images/scene.png', keys), false)
  assert.equal(isCharacterMediaRef('data:image/jpeg;base64,aaa', keys), false)
})

test('overlayOrangeGridOnRef returns a jpeg data URL', async () => {
  const source = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 8, g: 16, b: 24 } },
  }).png().toBuffer()
  const dataUrl = await overlayOrangeGridOnRef(`data:image/png;base64,${source.toString('base64')}`)
  assert.match(dataUrl, /^data:image\/jpeg;base64,/)
  const jpeg = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  const meta = await sharp(jpeg).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.ok((meta.width || 0) <= 768)
})

test('overlayOrangeGrid paints orange lines and keeps cell centers', async () => {
  const size = 96
  const source = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  }).png().toBuffer()
  const gridded = await overlayOrangeGrid(source, { format: 'png' })
  const stroke = gridLineWidth(size, size)
  const line = await pixelAt(gridded, Math.round(stroke / 2), Math.round(size / 2))
  assert.ok(isOrange(line), `expected orange on grid line, got ${JSON.stringify(line)}`)
  const cell = size / 6
  const center = await pixelAt(gridded, Math.round(cell * 2.5), Math.round(cell * 2.5))
  assert.ok(center.b > 200 && center.r < 40, `expected blue cell center, got ${JSON.stringify(center)}`)
})

test('applyCharacterOrangeGridToRefs only overlays matching character stills', async () => {
  const scene = 'static/images/cafe.png'
  const { refs, overlaidCount } = await applyCharacterOrangeGridToRefs(
    [scene],
    ['static/images/hero.png'],
  )
  assert.equal(overlaidCount, 0)
  assert.deepEqual(refs, [scene])
})

test('withOrangeGridRemovalPrompt appends zh/en once', () => {
  const next = withOrangeGridRemovalPrompt('0-3秒：抬头。')
  assert.match(next, /橙色 6×6/)
  assert.match(next, /orange 6x6/i)
  assert.doesNotMatch(next, /切开|五官拼回|split facial|Reassemble/i)
  assert.equal(withOrangeGridRemovalPrompt(next), next)
})

test('compose strips leftover white-grid copy then injects orange removal', () => {
  const stored =
    '0-3秒：抬头。\n去掉参考图整张画面上的白色6×6网格（不透明度100%、线宽约12px），把被网格切开的五官重新拼成完整眉眼鼻口耳，还原无网格的自然画面，不得残留格子或白色线。Remove the white 6x6 grid covering the entire reference image (100% opacity, 12px-thick lines); reassemble split facial features into complete eyebrows, eyes, nose, mouth and ears; restore the natural scene with no lattice overlay.'
  const next = composeVideoPromptAfterCharacterGrid(stored, 1)
  assert.doesNotMatch(next, /白色/)
  assert.match(next, /^0-3秒：抬头。/)
  assert.match(next, /橙色 6×6/)
  assert.match(next, /orange 6x6/i)
})

test('compose does not inject orange removal when nothing was overlaid', () => {
  assert.equal(composeVideoPromptAfterCharacterGrid('0-3秒：空镜。', 0), '0-3秒：空镜。')
})

test('scene-only refs stay untouched so no orange-grid prompt is injected', async () => {
  const scene = 'static/images/cafe.png'
  const { refs, overlaidCount } = await applyCharacterOrangeGridToRefs(
    [scene],
    ['static/images/hero.png'],
  )
  assert.equal(overlaidCount, 0)
  assert.deepEqual(refs, [scene])
  assert.equal(composeVideoPromptAfterCharacterGrid('0-3秒：空镜。', overlaidCount), '0-3秒：空镜。')
})
