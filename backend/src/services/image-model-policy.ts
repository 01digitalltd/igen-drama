/** Realistic asset and storyboard stills render on APIMart gpt-image-2. */

import { isRealisticDramaStyle } from './video-model-policy.js'

export const APIMART_ASSET_IMAGE_MODEL = 'gpt-image-2.5-sunburst'

export const APIMART_ASSET_IMAGE_MISSING_MESSAGE =
  '未启用 APIMart 图片服务，请先设置 APIMART_API_KEY 并启用 gpt-image-2.5-sunburst'

export function isApimartGptImageModel(model?: string | null) {
  const name = String(model || '').trim()
  return /^gpt-image-2(?:[.-]|$)/.test(name)
}

/** Keep a configured gpt-image-2 model; otherwise use the APIMart official id. */
export function apimartAssetImageModel(configured?: string | null) {
  const model = String(configured || '').trim()
  return isApimartGptImageModel(model) ? model : APIMART_ASSET_IMAGE_MODEL
}

function positiveId(value?: number | null) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0
}

/** Realistic characters, scenes, props, and storyboard stills. Other styles stay on Gemini. */
export function isRealisticAssetImageJob(opts: {
  style?: string | null
  storyboardId?: number | null
  characterId?: number | null
  sceneId?: number | null
  propId?: number | null
}) {
  if (!isRealisticDramaStyle(opts.style)) return false
  return positiveId(opts.storyboardId)
    || positiveId(opts.characterId)
    || positiveId(opts.sceneId)
    || positiveId(opts.propId)
}
