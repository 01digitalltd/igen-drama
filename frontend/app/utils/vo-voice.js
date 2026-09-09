export const VO_VOICE_CODES = ['female', 'male']

export const DEFAULT_VO_VOICE = 'female'

export const VO_VOICE_OPTIONS = [
  { label: '女声', value: 'female' },
  { label: '男声', value: 'male' },
]

export function normalizeVoVoice(raw) {
  const code = String(raw || '').trim().toLowerCase()
  if (VO_VOICE_CODES.includes(code)) return code
  if (code === 'f' || code.includes('female') || code.includes('女')) return 'female'
  if (code === 'm' || code.includes('male') || code.includes('男')) return 'male'
  return DEFAULT_VO_VOICE
}

export function voVoiceLabel(code) {
  const normalized = normalizeVoVoice(code)
  return VO_VOICE_OPTIONS.find(opt => opt.value === normalized)?.label || normalized
}

export function voVoiceInstruction(codeRaw) {
  const voice = normalizeVoVoice(codeRaw)
  const label = voVoiceLabel(voice)
  const other = voice === 'female' ? '男声' : '女声'
  const timbre = voice === 'female'
    ? '成年女声，中音，温暖清晰的广告口播音色'
    : '成年男声，中音，沉稳清晰的广告口播音色'
  const zh = voice === 'female' ? '女声旁白' : '男声旁白'
  return [
    `【旁白声线｜必须遵守】本项目旁白固定为${label}（S1）。`,
    `凡旁白必须写成「${zh}（S1，${timbre}）：内容」。`,
    `同一项目每一镜都用这一个声线，不要换成${other}，也不要镜间换音色。`,
    '角色开口仍用该角色自己的声音，不要用 S1。',
    '无旁白的段写「无旁白」，不要硬加旁白。',
  ].join('')
}
