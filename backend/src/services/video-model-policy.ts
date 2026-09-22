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

export const MINIMAX_H3_MISSING_MESSAGE =
  '未启用 MiniMax-H3 视频服务，请先在设置中添加并启用 MiniMax 视频配置'

export const MINIMAX_BALANCE_NO_SEEDANCE_MESSAGE =
  'MiniMax 帳戶餘額不足（1008），且未啟用 Seedance 視頻服務。請儲值 MiniMax，或在設置中啟用火山 Seedance 後再出片。'

export function canFallbackMiniMaxToSeedance(opts: {
  style?: string | null
  provider?: string | null
  alreadyFallback?: boolean
}) {
  if (opts.alreadyFallback) return false
  if (String(opts.provider || '').toLowerCase() !== 'minimax') return false
  if (isRealisticDramaStyle(opts.style)) return false
  return true
}

export function expectedVideoProvider(model?: string | null): 'gemini' | 'minimax' | 'volcengine' | null {
  const m = String(model || '').trim().toLowerCase()
  if (!m) return null
  if (m.includes('seedance')) return 'volcengine'
  if (m.includes('omni') || m.includes('gemini')) return 'gemini'
  if (m.includes('minimax') || m.includes('h3')) return 'minimax'
  return null
}

export function videoModelFitsProvider(provider?: string | null, model?: string | null) {
  const want = expectedVideoProvider(model)
  if (!want) return true
  return String(provider || '').trim().toLowerCase() === want
}

export function assertSeedanceAllowedForStyle(
  style?: string | null,
  provider?: string | null,
  model?: string | null,
) {
  if (isRealisticDramaStyle(style) && isSeedanceVideoConfig(provider, model)) {
    throw new Error(SEEDANCE_BLOCKED_FOR_REALISTIC_MESSAGE)
  }
}
