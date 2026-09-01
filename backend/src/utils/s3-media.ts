/**
 * Shared mkt-ai media bucket (S3 + CloudFront).
 * Playback uses unsigned CloudFront URLs (browser has signed cookies).
 * BytePlus/Seedance fetch uses long-lived S3 presigned GET URLs.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const KEY_PREFIX = 'drama'
const BYTEPLUS_PRESIGN_SECONDS = 604800 // 7 days, matches mkt-ai BytePlus reference URLs

function env(name: string): string {
  return String(process.env[name] || '').trim()
}

export function isS3Enabled(): boolean {
  const bucket = env('AWS_S3_BUCKET')
  const access = env('AWS_S3_ACCESS_KEY_ID') || env('AWS_ACCESS_KEY_ID')
  const secret = env('AWS_S3_SECRET_ACCESS_KEY') || env('AWS_SECRET_ACCESS_KEY')
  return Boolean(bucket && access && secret)
}

export function s3Bucket(): string {
  return env('AWS_S3_BUCKET') || 'ai-marketing-bucket'
}

export function s3Region(): string {
  return env('AWS_REGION') || 'ap-east-1'
}

export function cloudfrontDomain(): string {
  return env('CLOUDFRONT_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

export function useCloudfrontMediaUrls(): boolean {
  return env('USE_CLOUDFRONT_MEDIA_URLS').toLowerCase() === 'true' && Boolean(cloudfrontDomain())
}

let client: S3Client | null = null

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: s3Region(),
      credentials: {
        accessKeyId: env('AWS_S3_ACCESS_KEY_ID') || env('AWS_ACCESS_KEY_ID'),
        secretAccessKey: env('AWS_S3_SECRET_ACCESS_KEY') || env('AWS_SECRET_ACCESS_KEY'),
      },
    })
  }
  return client
}

export function encodeKeyPathForUrl(key: string): string {
  return String(key || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

export function deliveryUrlForKey(key: string): string {
  const clean = String(key || '').replace(/^\/+/, '')
  if (useCloudfrontMediaUrls()) {
    return `https://${cloudfrontDomain()}/${encodeKeyPathForUrl(clean)}`
  }
  return `https://${s3Bucket()}.s3.${s3Region()}.amazonaws.com/${encodeKeyPathForUrl(clean)}`
}

export function makeObjectKey(subDir: string, filename: string): string {
  const dir = String(subDir || 'uploads').replace(/^\/+|\/+$/g, '')
  return `${KEY_PREFIX}/${dir}/${filename}`
}

export function parseMediaUrlToKey(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (!/^https?:\/\//i.test(raw)) {
    if (raw.startsWith(`${KEY_PREFIX}/`)) return raw.split('?')[0]
    return null
  }

  try {
    const u = new URL(raw)
    const hostname = u.hostname.toLowerCase()
    const key = decodeURIComponent((u.pathname || '').replace(/^\/+/, '')).split('?')[0]
    if (!key) return null

    const cf = cloudfrontDomain().toLowerCase()
    if (cf && hostname === cf) return key

    if (hostname === `${s3Bucket().toLowerCase()}.s3.${s3Region().toLowerCase()}.amazonaws.com`) return key
    if (hostname === `${s3Bucket().toLowerCase()}.s3.amazonaws.com`) return key
    if (/\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i.test(hostname) && key.startsWith(`${KEY_PREFIX}/`)) {
      return key
    }
  } catch {
    return null
  }
  return null
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  await s3().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  )
  return deliveryUrlForKey(key)
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }))
  if (!res.Body) throw new Error(`S3 object empty: ${key}`)
  return Buffer.from(await res.Body.transformToByteArray())
}

export async function presignGetUrl(key: string, expiresIn = BYTEPLUS_PRESIGN_SECONDS): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: s3Bucket(), Key: key }),
    { expiresIn },
  )
}

/** Seedance/BytePlus cannot use CloudFront cookies — mint a long-lived S3 GET URL. */
export async function toVendorFetchableUrl(value: string): Promise<string> {
  const raw = String(value || '').trim()
  if (!raw || !isS3Enabled()) return raw
  const key = parseMediaUrlToKey(raw)
  if (!key) return raw
  return presignGetUrl(key)
}
