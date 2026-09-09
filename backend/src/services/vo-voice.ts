/**
 * Off-screen narrator timbre for MiniMax / Omni clips.
 * Each shot is a separate POST; without a locked voice the model picks male/female at random.
 */

export const VO_VOICE_CODES = ['female', 'male'] as const
export type VoVoice = (typeof VO_VOICE_CODES)[number]

export const DEFAULT_VO_VOICE: VoVoice = 'female'

const SPECS: Record<VoVoice, { zh: string; zhLabel: string; en: string; timbre: string }> = {
  female: {
    zh: '女声旁白',
    zhLabel: '女声',
    en: 'female',
    timbre: '成年女声，中音，温暖清晰的广告口播音色',
  },
  male: {
    zh: '男声旁白',
    zhLabel: '男声',
    en: 'male',
    timbre: '成年男声，中音，沉稳清晰的广告口播音色',
  },
}

export function isVoVoice(value: unknown): value is VoVoice {
  return typeof value === 'string' && (VO_VOICE_CODES as readonly string[]).includes(value)
}

export function normalizeVoVoice(raw?: string | null): VoVoice {
  const code = String(raw || '').trim().toLowerCase()
  if (isVoVoice(code)) return code
  if (code === 'f' || code.includes('female') || code.includes('女')) return 'female'
  if (code === 'm' || code.includes('male') || code.includes('男')) return 'male'
  return DEFAULT_VO_VOICE
}

export function voVoiceLabel(code?: string | null) {
  return SPECS[normalizeVoVoice(code)].zhLabel
}

export function narratorInlineLabel(code?: string | null) {
  const spec = SPECS[normalizeVoVoice(code)]
  return `${spec.zh}（S1，${spec.timbre}）`
}

/** Rewrite 旁白 / 女声旁白 / 男声旁白 to the project's locked speaker. Skip 无旁白. */
export function rewriteNarratorLabels(prompt: string, voiceRaw?: string | null) {
  const labeled = narratorInlineLabel(voiceRaw)
  return String(prompt || '').replace(
    /(?<![无無])(?:女声|男声|女聲|男聲)?旁白(?:（[^）]*）)?/g,
    labeled,
  )
}

/** Agent instruction: keep one narrator timbre; character dialogue stays per-character. */
export function voVoiceInstruction(codeRaw?: string | null) {
  const voice = normalizeVoVoice(codeRaw)
  const spec = SPECS[voice]
  const other = voice === 'female' ? '男声' : '女声'
  return [
    `【旁白声线｜必须遵守】本项目旁白固定为${spec.zhLabel}（S1）。`,
    `凡旁白必须写成「${narratorInlineLabel(voice)}：内容」。`,
    `同一项目每一镜都用这一个声线，不要换成${other}，也不要镜间换音色。`,
    '角色开口仍用该角色自己的声音，不要用 S1。',
    '无旁白的段写「无旁白」，不要硬加旁白。',
  ].join('')
}

export function appendVoVoiceDirective(prompt: string, voiceRaw?: string | null) {
  const voice = normalizeVoVoice(voiceRaw)
  const spec = SPECS[voice]
  const otherEn = voice === 'female' ? 'male' : 'female'
  const base = String(prompt || '').trim()
  const tag = `[VO_NARRATOR: ${spec.en} | speaker=S1 | One consistent off-screen narrator for this entire project. ${spec.timbre}. Every 旁白 / voice-over / narrator line MUST use this same S1 voice. Do NOT switch to a ${otherEn} narrator between shots. If the shot says 无旁白 / no voice-over, do not add a narrator. On-screen character dialogue uses each character's own voice — not S1.]`
  if (base.includes('VO_NARRATOR')) return base
  return base ? `${base}\n\n${tag}` : tag
}

export async function getDramaVoVoice(dramaId: number | null | undefined) {
  if (!dramaId) return DEFAULT_VO_VOICE
  const { eq } = await import('../db/query.js')
  const { db, schema } = await import('../db/index.js')
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  return normalizeVoVoice(drama?.voVoice)
}
