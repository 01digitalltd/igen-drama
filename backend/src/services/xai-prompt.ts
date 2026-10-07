import type { ShotImageRef } from './storyboard-prompt.js'

const KIND_RANK: Record<ShotImageRef['kind'], number> = {
  character: 0,
  scene: 1,
  prop: 2,
  continuity: 3,
}

/** Characters first, then the location, then props. Drop continuity stills. */
export function orderXaiImageRefs(refs: ShotImageRef[]): ShotImageRef[] {
  return [...refs]
    .filter((ref) => ref.kind !== 'continuity' && String(ref.url || '').trim())
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
    .slice(0, 7)
    .map((ref, index) => ({
      ...ref,
      index,
      tag: `<IMAGE_${index}>`,
    }))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Point stored prompts at the reference_images array xAI actually receives.
 * `<IMAGE_REF_N>` follows the original still order; `@名字` follows the asset name.
 */
export function rewriteXaiPrompt(
  prompt: string,
  ordered: Array<Pick<ShotImageRef, 'name' | 'index' | 'url'> & { sourceUrl?: string }>,
  sourceOrder: Array<Pick<ShotImageRef, 'index' | 'url'>> = [],
) {
  let text = String(prompt || '')
    .replace(/\n\n\[VO_AUDIO_REFS:[\s\S]*?(?=\n\n\[|$)/gu, '')
    .replace(/\n\n\[AUDIO: Speak only[\s\S]*?\]/gu, '')
    .trim()
  const indexByUrl = new Map(ordered.map((ref) => [ref.sourceUrl || ref.url, ref.index]))
  text = text.replace(/<IMAGE_REF_(\d+)>/g, (token, raw) => {
    const source = sourceOrder.find((ref) => ref.index === Number(raw))
    if (!source) return token
    const next = indexByUrl.get(source.url)
    return next == null ? token : `<IMAGE_${next}>`
  })
  const named = [...ordered]
    .filter((ref) => String(ref.name || '').trim())
    .sort((a, b) => String(b.name).length - String(a.name).length)
  for (const ref of named) {
    text = text.replace(new RegExp(`@${escapeRegExp(String(ref.name).trim())}`, 'g'), `<IMAGE_${ref.index}>`)
  }
  return text
}
