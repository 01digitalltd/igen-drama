/** Realistic live-action dramas cannot use Seedance (Volcengine) video models. */

export function isRealisticDramaStyle(value?: string | null) {
  return String(value || '').trim().toLowerCase() === 'realistic'
}

export function isSeedanceVideoConfig(provider?: string | null, model?: string | null) {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '').toLowerCase()
  return p === 'volcengine' || m.includes('seedance')
}

export const SEEDANCE_BLOCKED_FOR_REALISTIC_MESSAGE =
  '写实真人风格不能使用 Seedance 视频模型，请改用 Gemini Omni 或 MiniMax H3'

export function assertSeedanceAllowedForStyle(
  style?: string | null,
  provider?: string | null,
  model?: string | null,
) {
  if (isRealisticDramaStyle(style) && isSeedanceVideoConfig(provider, model)) {
    throw new Error(SEEDANCE_BLOCKED_FOR_REALISTIC_MESSAGE)
  }
}
