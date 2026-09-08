/**
 * Overlay a full-frame 6x6 orange grid on live-action character stills
 * right before video generation. Canonical character assets stay clean.
 */
import sharp from 'sharp'
import { parseDataUrl, readStoredBytes } from '../utils/storage.js'
import { stripVideoFaceGridPrompt } from './face-grid.js'

export const ORANGE_GRID_COLOR = '#FF6A00'
export const ORANGE_GRID_CELLS = 6
export const ORANGE_GRID_RECIPE = 'v1'
export const VENDOR_IMAGE_MAX = 768

export const VIDEO_ORANGE_GRID_REMOVAL_ZH =
  '去掉角色参考图上的橙色 6×6 辅助线，成片不要出现网格，保持人物外貌、服装与场景不变。'
export const VIDEO_ORANGE_GRID_REMOVAL_EN =
  'Remove the orange 6x6 helper lines on character reference image(s). Do not show any grid. Keep appearance, clothing and scene the same.'

const gridCache = new Map<string, string>()

export function gridLineWidth(width: number, height: number) {
  const w = Math.max(1, Math.round(Number(width) || 0))
  const h = Math.max(1, Math.round(Number(height) || 0))
  return Math.max(3, Math.round(Math.min(w, h) / 160))
}

/** Strip query/hash/host so CDN URLs match stored static/ paths. */
export function normalizeMediaKey(value: string): string {
  const raw = String(value || '').trim()
  if (!raw || raw.startsWith('data:')) return raw
  let path = raw.split('#')[0].split('?')[0]
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname
  } catch { /* keep path */ }
  try {
    path = decodeURIComponent(path)
  } catch { /* keep encoded */ }
  path = path.replace(/^\/+/, '')
  const staticAt = path.indexOf('static/')
  if (staticAt >= 0) return path.slice(staticAt)
  return path
}

export function isCharacterMediaRef(ref: string, characterKeys: string[]): boolean {
  const key = normalizeMediaKey(ref)
  if (!key || key.startsWith('data:')) return false
  return characterKeys.some((candidate) => {
    const other = normalizeMediaKey(candidate)
    if (!other || other.startsWith('data:')) return false
    return key === other || key.endsWith(`/${other}`) || other.endsWith(`/${key}`) || key.endsWith(other) || other.endsWith(key)
  })
}

function gridSvg(width: number, height: number, stroke: number) {
  const inset = stroke / 2
  const innerW = Math.max(1, width - stroke)
  const innerH = Math.max(1, height - stroke)
  const lines: string[] = []
  for (let i = 0; i <= ORANGE_GRID_CELLS; i++) {
    const x = inset + (innerW * i) / ORANGE_GRID_CELLS
    const y = inset + (innerH * i) / ORANGE_GRID_CELLS
    lines.push(`<line x1="${x}" y1="${inset}" x2="${x}" y2="${height - inset}" />`)
    lines.push(`<line x1="${inset}" y1="${y}" x2="${width - inset}" y2="${y}" />`)
  }
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g stroke="${ORANGE_GRID_COLOR}" stroke-width="${stroke}" stroke-linecap="square" fill="none">
    ${lines.join('\n    ')}
  </g>
</svg>`
}

export async function overlayOrangeGrid(
  input: Buffer,
  opts?: { format?: 'jpeg' | 'png' },
): Promise<Buffer> {
  const meta = await sharp(input).rotate().metadata()
  const width = meta.width || 1
  const height = meta.height || 1
  const stroke = gridLineWidth(width, height)
  const svg = Buffer.from(gridSvg(width, height, stroke))
  const composed = sharp(input).rotate().composite([{ input: svg, blend: 'over' }])
  if (opts?.format === 'png') return composed.png().toBuffer()
  return composed.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
}

async function loadRefBytes(ref: string): Promise<Buffer> {
  const raw = String(ref || '').trim()
  if (raw.startsWith('data:')) {
    const parsed = parseDataUrl(raw)
    if (!parsed) throw new Error('invalid data URL')
    return Buffer.from(parsed.data, 'base64')
  }
  return readStoredBytes(raw.startsWith('/static/') ? raw.slice(1) : raw)
}

async function resizeForVendor(buffer: Buffer): Promise<Buffer> {
  const resized = sharp(buffer).rotate().resize({
    width: VENDOR_IMAGE_MAX,
    height: VENDOR_IMAGE_MAX,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  if (metadata.hasAlpha) {
    return resized.flatten({ background: '#ffffff' }).png().toBuffer()
  }
  return resized.png().toBuffer()
}

/** Resize to vendor size, overlay the 6x6 grid, return a JPEG data URL. */
export async function overlayOrangeGridOnRef(ref: string): Promise<string> {
  const cacheKey = `${normalizeMediaKey(ref)}|${VENDOR_IMAGE_MAX}|${ORANGE_GRID_RECIPE}`
  const hit = gridCache.get(cacheKey)
  if (hit) return hit
  const source = await loadRefBytes(ref)
  const resized = await resizeForVendor(source)
  const gridded = await overlayOrangeGrid(resized, { format: 'jpeg' })
  const dataUrl = `data:image/jpeg;base64,${gridded.toString('base64')}`
  gridCache.set(cacheKey, dataUrl)
  return dataUrl
}

export async function applyCharacterOrangeGridToRefs(
  refs: string[],
  characterKeys: string[],
  onWarn?: (ref: string, error: string) => void,
): Promise<{ refs: string[]; overlaidCount: number }> {
  if (!refs.length || !characterKeys.length) return { refs, overlaidCount: 0 }
  let overlaidCount = 0
  const next: string[] = []
  for (const ref of refs) {
    if (!isCharacterMediaRef(ref, characterKeys)) {
      next.push(ref)
      continue
    }
    try {
      next.push(await overlayOrangeGridOnRef(ref))
      overlaidCount += 1
    } catch (err) {
      onWarn?.(ref, (err as Error).message)
      next.push(ref)
    }
  }
  return { refs: next, overlaidCount }
}

export function withOrangeGridRemovalPrompt(prompt: string) {
  const text = String(prompt || '').trim()
  if (text.includes('橙色 6×6') || /orange 6x6/i.test(text)) return text
  return [text, VIDEO_ORANGE_GRID_REMOVAL_ZH, VIDEO_ORANGE_GRID_REMOVAL_EN].filter(Boolean).join('\n')
}

/** Strip leftover white-grid copy, then inject orange-grid removal only if a still was overlaid. */
export function composeVideoPromptAfterCharacterGrid(prompt: string, overlaidCount: number) {
  const stripped = stripVideoFaceGridPrompt(prompt)
  if (overlaidCount > 0) return withOrangeGridRemovalPrompt(stripped)
  return stripped
}
