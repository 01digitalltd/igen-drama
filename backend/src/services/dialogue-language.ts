/**
 * Spoken dialogue language for generated drama clips.
 * Independent from UI locale and writing locale (zh-TW ≠ Cantonese).
 */

export const DIALOGUE_LANGUAGE_CODES = ['yue-HK', 'cmn-TW', 'cmn-CN', 'en-US'] as const
export type DialogueLanguageCode = (typeof DIALOGUE_LANGUAGE_CODES)[number]

export const DEFAULT_DIALOGUE_LANGUAGE: DialogueLanguageCode = 'cmn-TW'

const LABELS: Record<DialogueLanguageCode, string> = {
  'yue-HK': '粵語',
  'cmn-TW': '國語（台灣）',
  'cmn-CN': '普通話（大陸）',
  'en-US': '英文',
}

export function isDialogueLanguageCode(value: unknown): value is DialogueLanguageCode {
  return typeof value === 'string' && (DIALOGUE_LANGUAGE_CODES as readonly string[]).includes(value)
}

export function normalizeDialogueLanguage(raw?: string | null): DialogueLanguageCode {
  const code = String(raw || '')
    .trim()
    .replace(/_/g, '-')
  if (isDialogueLanguageCode(code)) return code
  const lower = code.toLowerCase()
  if (lower.startsWith('yue') || lower === 'zh-hk' || lower.includes('-hk')) return 'yue-HK'
  if (lower === 'cmn-tw' || lower.startsWith('zh-tw') || lower === 'zh-hant') return 'cmn-TW'
  if (lower === 'cmn-cn' || lower.startsWith('zh-cn') || lower === 'zh-hans') return 'cmn-CN'
  if (lower.startsWith('en')) return 'en-US'
  return DEFAULT_DIALOGUE_LANGUAGE
}

export function defaultDialogueLanguageFromLocale(locale?: string | null): DialogueLanguageCode {
  const raw = String(locale || '')
    .trim()
    .split(',')[0]
    .replace(/_/g, '-')
    .toLowerCase()
  if (raw.startsWith('zh-cn') || raw === 'zh-hans' || raw === 'zh') return 'cmn-CN'
  if (raw.startsWith('en')) return 'en-US'
  return DEFAULT_DIALOGUE_LANGUAGE
}

export function dialogueLanguageLabel(code?: string | null) {
  return LABELS[normalizeDialogueLanguage(code)]
}

/** Agent instruction: visual prompt stays in writing language; spoken lines follow dialogue language. */
export function dialogueLanguageInstruction(codeRaw?: string | null) {
  const code = normalizeDialogueLanguage(codeRaw)
  const label = LABELS[code]
  const spokenRule =
    code === 'yue-HK'
      ? '粵語使用香港口語書面（你／嚟／唔／嘅／喺），不要寫成普通話。'
      : code === 'en-US'
        ? 'Spoken lines must be natural English. Keep camera / action / atmosphere descriptions in the writing language.'
        : code === 'cmn-CN'
          ? '对白用大陆普通话语气。'
          : '對白用台灣國語口語。'
  return [
    `【對白語言｜必須遵守】生成影片裡角色開口與旁白必須是 ${label}（${code}）。`,
    '畫面、運鏡、景別、氛圍描述仍用產品寫作語言；不要整段提示詞都改成對白語言。',
    '從分鏡 description 抽出的「角色名說：「…」」「旁白：…」必須翻譯／改寫成該對白語言的自然口語，意思不變，不要創作新台詞。',
    spokenRule,
    '不要把對白寫成影片字幕。',
  ].join('')
}

/** Short instruction for rewriting only the lines that will be spoken aloud. */
export function spokenLineRewriteInstruction(codeRaw?: string | null) {
  const code = normalizeDialogueLanguage(codeRaw)
  const label = LABELS[code]
  const spokenRule =
    code === 'yue-HK'
      ? '粵語使用香港口語書面（你／嚟／唔／嘅／喺），不要寫成普通話。用繁體字。'
      : code === 'en-US'
        ? 'Write natural spoken English only.'
        : code === 'cmn-CN'
          ? '用大陆普通话口语，简体字。'
          : '用台灣國語口語，繁體字。'
  return [
    `把每一句改写成${label}（${code}）的自然口语，供影片配音直接朗读。`,
    '只改语言，意思不变，不要加新情节，不要加角色名、引号或旁白标签。',
    spokenRule,
    '返回 JSON：{"lines":["..."]}，条数和顺序必须与输入相同。',
  ].join('')
}

const ON_SCREEN_SCRIPT: Record<DialogueLanguageCode, string> = {
  'yue-HK': '繁體中文',
  'cmn-TW': '繁體中文',
  'cmn-CN': '简体中文',
  'en-US': 'English',
}

/** Readable glyphs inside a storyboard still. Cantonese speech is written in Traditional Chinese. */
export function storyboardImageTextInstruction(codeRaw?: string | null) {
  const code = normalizeDialogueLanguage(codeRaw)
  const label = LABELS[code]
  const script = ON_SCREEN_SCRIPT[code]
  const yue = code === 'yue-HK'
    ? '粵語口語可以保留香港用字，但畫面上的字必須是繁體中文，不要寫成簡體。'
    : ''
  return [
    `【分鏡圖文字｜必須遵守】對白語言是 ${label}（${code}）。`,
    `分鏡靜幀裡的可讀文字（招牌、包裝說明、螢幕、字卡、標題）必須使用${script}。`,
    yue,
    '官方 Logo 原件不要改寫。不要把整段對白燒成字幕；只有畫面裡本來就有的字才寫，並用上面的文字。',
  ].filter(Boolean).join('')
}

const STORYBOARD_IMAGE_TEXT_MARKER = 'STORYBOARD_IMAGE_TEXT'

export function appendStoryboardImageTextDirective(prompt: string, codeRaw?: string | null) {
  const base = String(prompt || '').trim()
  if (base.includes(STORYBOARD_IMAGE_TEXT_MARKER)) return base
  const line = `[${STORYBOARD_IMAGE_TEXT_MARKER}] ${storyboardImageTextInstruction(codeRaw)}`
  return base ? `${base}\n\n${line}` : line
}

const NO_ON_SCREEN_TEXT_MARKER = 'NO_ON_SCREEN_TEXT'

export function appendVoLanguageDirective(prompt: string, codeRaw?: string | null) {
  const code = normalizeDialogueLanguage(codeRaw)
  const label = LABELS[code]
  const base = String(prompt || '').trim()
  const tag = `[VO_DIALOGUE_LANGUAGE: ${label} | code=${code} | All spoken dialogue and voice-over must be in this language only — **audio only**; never render this language as on-screen text, subtitles, captions, titles, or CJK glyphs.]`
  const withLang = base.includes('VO_DIALOGUE_LANGUAGE')
    ? base
    : base ? `${base}\n\n${tag}` : tag
  if (withLang.includes(NO_ON_SCREEN_TEXT_MARKER) || withLang.includes('NO_BURNED_IN_SUBTITLES')) {
    return withLang
  }
  const noText = `[${NO_ON_SCREEN_TEXT_MARKER}: **Zero readable text in every frame** — no burned-in subtitles, closed captions, titles, or CJK glyphs. Dialogue and VO are audio only.]`
  return `${withLang}\n\n${noText}`
}

export async function getDramaDialogueLanguage(dramaId: number | null | undefined) {
  if (!dramaId) return DEFAULT_DIALOGUE_LANGUAGE
  const { eq } = await import('../db/query.js')
  const { db, schema } = await import('../db/index.js')
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  return normalizeDialogueLanguage(drama?.dialogueLanguage)
}
