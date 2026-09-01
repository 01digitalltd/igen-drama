export type ContentLocale = 'zh-TW' | 'zh-CN' | 'en' | 'ja'

const LABELS: Record<ContentLocale, string> = {
  'zh-TW': 'Traditional Chinese (zh-TW / 繁體中文)',
  'zh-CN': 'Simplified Chinese (zh-CN / 简体中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
}

export function normalizeContentLocale(raw?: string | null): ContentLocale {
  const code = String(raw || '')
    .trim()
    .split(',')[0]
    .replace(/_/g, '-')
    .toLowerCase()
  if (!code) return 'zh-TW'
  if (code.startsWith('zh-tw') || code === 'zh-hant') return 'zh-TW'
  if (code.startsWith('zh-cn') || code === 'zh-hans' || code === 'zh') return 'zh-CN'
  if (code.startsWith('ja')) return 'ja'
  if (code.startsWith('en')) return 'en'
  return 'zh-TW'
}

export function contentLanguageLabel(locale?: string | null) {
  return LABELS[normalizeContentLocale(locale)]
}

/** Prepend to every agent user message so saved fields follow the product UI language. */
export function contentLanguageInstruction(locale?: string | null) {
  const code = normalizeContentLocale(locale)
  const label = LABELS[code]
  if (code === 'zh-TW') {
    return [
      `【輸出語言｜必須遵守】產品介面語言是 ${label}。`,
      '所有寫進資料庫、給使用者看的文字（劇本、角色名／定位／樣貌／妝造、場景地點／時間／描述／光影、道具名／類型／外貌、分鏡描述／氛圍）必須使用台灣／香港慣用繁體中文。',
      '禁止簡體字。格式標記可保留（如 ## S01），但用字改為繁體：內景／外景、影片、預設、設定。若原文是簡體，改寫時要轉成繁體，不要照抄。',
    ].join('')
  }
  if (code === 'zh-CN') {
    return `【输出语言｜必须遵守】产品界面语言是 ${label}。所有写入数据库、给用户看的文字必须使用简体中文。`
  }
  if (code === 'ja') {
    return `【出力言語｜必須】プロダクト UI 言語は ${label}。データベースに保存しユーザーに見せる文章はすべて日本語で書いてください。`
  }
  return `LANGUAGE REQUIREMENT (mandatory): the product UI language is ${label}. All user-visible text saved to the database must be written in English.`
}

export function withContentLanguage(message: string, locale?: string | null) {
  return `${contentLanguageInstruction(locale)}\n\n${message}`
}
