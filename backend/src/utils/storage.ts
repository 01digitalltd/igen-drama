/**
 * Drama media persistence.
 * When AWS_S3_BUCKET + credentials are set, files go to the shared mkt-ai
 * bucket (CloudFront delivery). Otherwise they stay on local STORAGE_PATH.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'
import {
  getObjectBuffer,
  isS3Enabled,
  makeObjectKey,
  parseMediaUrlToKey,
  putObject,
} from './s3-media.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

function scratchRoot(): string {
  return process.env.DRAMA_SCRATCH_PATH || path.join(os.tmpdir(), 'drama-scratch')
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  }
  return map[mimeType] || (mimeType.startsWith('video/') ? '.mp4' : '.png')
}

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname)
    if (ext && ext.length <= 5) return ext
  } catch {}
  const ext = path.extname(url.split('?')[0] || '')
  if (ext && ext.length <= 5) return ext
  return '.bin'
}

export function isRemoteStored(value: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim())
}

export function publicMediaUrl(stored: string): string {
  if (!stored) return stored
  if (isRemoteStored(stored)) return stored
  return stored.startsWith('/') ? stored : `/${stored}`
}

/** 由图片相对路径推导缩略图路径：static/images/x.png → static/images/x_thumb.webp */
export function thumbPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./?#]+(?=($|\?|#))/, '_thumb.webp')
}

function persistLocal(buffer: Buffer, subDir: string, ext: string): string {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })
  const filename = `${uuid()}${ext}`
  fs.writeFileSync(path.join(dir, filename), buffer)
  return `static/${subDir}/${filename}`
}

async function persistBuffer(buffer: Buffer, subDir: string, ext: string, contentType?: string): Promise<string> {
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`
  if (isS3Enabled()) {
    const filename = `${uuid()}${safeExt}`
    const key = makeObjectKey(subDir, filename)
    return putObject(key, buffer, contentType || extToMime(safeExt))
  }
  return persistLocal(buffer, subDir, safeExt)
}

export async function downloadFile(url: string, subDir: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
  const buffer = Buffer.from(await resp.arrayBuffer())
  const ext = getExtFromUrl(url)
  const contentType = resp.headers.get('content-type') || extToMime(ext)
  return persistBuffer(buffer, subDir, ext, contentType)
}

export async function saveUploadedFile(data: ArrayBuffer, subDir: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName) || '.bin'
  return persistBuffer(Buffer.from(data), subDir, ext, extToMime(ext))
}

export async function saveBase64Image(base64Data: string, mimeType: string, subDir: string): Promise<string> {
  const ext = mimeTypeToExt(mimeType)
  return persistBuffer(Buffer.from(base64Data, 'base64'), subDir, ext, mimeType)
}

export async function saveBase64Video(base64Data: string, mimeType: string, subDir: string): Promise<string> {
  const ext = mimeTypeToExt(mimeType || 'video/mp4')
  return persistBuffer(Buffer.from(base64Data, 'base64'), subDir, ext, mimeType || 'video/mp4')
}

export async function persistLocalFile(absPath: string, subDir: string): Promise<string> {
  const buffer = fs.readFileSync(absPath)
  const ext = path.extname(absPath) || '.bin'
  return persistBuffer(buffer, subDir, ext, extToMime(ext))
}

/** Write a local file to the sibling CDN/local path derived from an existing stored URL. */
export async function persistDerivedFile(
  sourceStored: string,
  absPath: string,
  derive: (stored: string) => string,
  contentType: string,
): Promise<string> {
  const dest = derive(sourceStored)
  const buffer = fs.readFileSync(absPath)
  if (isS3Enabled()) {
    const key = parseMediaUrlToKey(dest)
    if (key) {
      await putObject(key, buffer, contentType)
      return dest
    }
  }
  const destAbs = getAbsolutePath(dest)
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  fs.writeFileSync(destAbs, buffer)
  return dest
}

/**
 * 获取本地文件的绝对路径（仅 local STORAGE_PATH）。
 * 远程 CDN URL 请用 materializeLocalFile。
 */
export function getAbsolutePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) {
    return path.join(STORAGE_ROOT, '..', relativePath)
  }
  return path.join(STORAGE_ROOT, relativePath)
}

export async function readStoredBytes(stored: string): Promise<Buffer> {
  const raw = String(stored || '').trim()
  if (isS3Enabled()) {
    const key = parseMediaUrlToKey(raw)
    if (key) return getObjectBuffer(key)
  }
  if (isRemoteStored(raw)) {
    const resp = await fetch(raw)
    if (!resp.ok) throw new Error(`Fetch media failed: ${resp.status}`)
    return Buffer.from(await resp.arrayBuffer())
  }
  return fs.readFileSync(getAbsolutePath(raw))
}

export async function materializeLocalFile(stored: string): Promise<{ filePath: string; cleanup: () => void }> {
  const raw = String(stored || '').trim()
  if (!isRemoteStored(raw)) {
    const filePath = getAbsolutePath(raw)
    if (fs.existsSync(filePath)) return { filePath, cleanup: () => {} }
  }
  const buffer = await readStoredBytes(raw)
  const ext = getExtFromUrl(raw)
  const dir = scratchRoot()
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${uuid()}${ext}`)
  fs.writeFileSync(filePath, buffer)
  return {
    filePath,
    cleanup: () => {
      try { fs.unlinkSync(filePath) } catch {}
    },
  }
}

/**
 * 为已落盘图片生成列表页缩略图（宽 400 WebP，与原图同目录）。
 * 失败（文件损坏/格式异常等）返回 null，不阻断主流程。
 */
export async function generateImageThumb(relativePath: string): Promise<string | null> {
  try {
    const thumbRel = thumbPathFor(relativePath)
    const source = await readStoredBytes(relativePath)
    const output = await sharp(source)
      .rotate()
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()

    if (isS3Enabled() && parseMediaUrlToKey(relativePath)) {
      const thumbKey = parseMediaUrlToKey(thumbRel) || makeObjectKey('images', path.basename(thumbRel.split('?')[0]))
      await putObject(thumbKey, output, 'image/webp')
      return thumbRel
    }

    const thumbAbs = getAbsolutePath(thumbRel)
    fs.mkdirSync(path.dirname(thumbAbs), { recursive: true })
    fs.writeFileSync(thumbAbs, output)
    return thumbRel
  } catch (err) {
    console.warn(`[storage] 缩略图生成失败 ${relativePath}:`, (err as Error).message)
    return null
  }
}

export function readImageAsDataUrl(relativePath: string): string {
  const filePath = getAbsolutePath(relativePath)
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  return `data:${extToMime(ext)};base64,${buffer.toString('base64')}`
}

export async function readImageAsCompressedDataUrl(
  relativePath: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const buffer = await readStoredBytes(relativePath)
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const resized = sharp(buffer).rotate().resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  const output = metadata.hasAlpha
    ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  return `data:image/jpeg;base64,${output.toString('base64')}`
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    data: match[2],
  }
}

export function ensureScratchDir(): string {
  const dir = scratchRoot()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
