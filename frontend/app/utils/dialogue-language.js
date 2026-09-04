export const DIALOGUE_LANGUAGE_CODES = ['yue-HK', 'cmn-TW', 'cmn-CN', 'en-US']

export const DIALOGUE_LANGUAGE_OPTIONS = [
  { label: '粤语（香港）', value: 'yue-HK' },
  { label: '国语（台湾）', value: 'cmn-TW' },
  { label: '普通话（大陆）', value: 'cmn-CN' },
  { label: '英文', value: 'en-US' },
]

export function normalizeDialogueLanguage(raw) {
  const code = String(raw || '').trim().replace(/_/g, '-')
  if (DIALOGUE_LANGUAGE_CODES.includes(code)) return code
  const lower = code.toLowerCase()
  if (lower.startsWith('yue') || lower === 'zh-hk' || lower.includes('-hk')) return 'yue-HK'
  if (lower === 'cmn-tw' || lower.startsWith('zh-tw') || lower === 'zh-hant') return 'cmn-TW'
  if (lower === 'cmn-cn' || lower.startsWith('zh-cn') || lower === 'zh-hans') return 'cmn-CN'
  if (lower.startsWith('en')) return 'en-US'
  return 'cmn-TW'
}

export function dialogueLanguageLabel(code) {
  const normalized = normalizeDialogueLanguage(code)
  return DIALOGUE_LANGUAGE_OPTIONS.find(opt => opt.value === normalized)?.label || normalized
}

export function dialogueLanguageInstruction(codeRaw) {
  const code = normalizeDialogueLanguage(codeRaw)
  const label = dialogueLanguageLabel(code)
  const spokenRule =
    code === 'yue-HK'
      ? '粤语使用香港口语书面（你／嚟／唔／嘅／喺），不要写成普通话。'
      : code === 'en-US'
        ? 'Spoken lines must be natural English. Keep camera / action / atmosphere descriptions in the writing language.'
        : code === 'cmn-CN'
          ? '对白用大陆普通话语气。'
          : '对白用台湾国语口语。'
  return [
    `【对白语言｜必须遵守】生成影片里角色开口与旁白必须是 ${label}（${code}）。`,
    '画面、运镜、景别、氛围描述仍用产品写作语言；不要整段提示词都改成对白语言。',
    '从分镜 description 抽出的「角色名说：「…」」「旁白：…」必须翻译／改写成该对白语言的自然口语，意思不变，不要创作新台词。',
    spokenRule,
    '不要把对白写成屏幕字幕、标题或可读文字。',
  ].join('')
}
