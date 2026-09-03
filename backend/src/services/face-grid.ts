/**
 * Strip leftover live-action face-grid instructions from stored prompts.
 * Character stills used to overlay a 6x6 white grid; video prompts asked to
 * remove it. Generation no longer injects either — this only cleans old text.
 */

function tidyPrompt(text: string) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[，,]{2,}/g, ',')
    .replace(/^[，,\s]+|[，,\s]+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function applyPatterns(prompt: string, patterns: RegExp[]) {
  let next = String(prompt || '')
  for (let i = 0; i < 4; i++) {
    const before = next
    for (const pattern of patterns) {
      next = next.replace(pattern, '')
    }
    if (next === before) break
  }
  return tidyPrompt(next)
}

const IMAGE_GRID_PATTERNS = [
  /(?:,\s*)?on every visible human face only, overlay (?:an ultra-fine orange mesh grid|a 6x6 white grid)[\s\S]*?(?:the orange grid must stay clearly visible|clearly visibl(?:e))(?:\.|$)/gi,
  /(?:,\s*)?overlay a [69]x[69] white grid across the entire image[\s\S]*?(?:the white grid must stay fully opaque and clearly visible|split every facial feature[\s\S]*?clearly visible)(?:\.|$)/gi,
  /若本剧是写实真人风格：整张图必须覆盖白色\s*[69]\s*[×x]\s*[69]\s*网格[\s\S]*?网格必须完全不透明、清晰可见[。.]?/g,
  /写实真人时整张图覆盖白色\s*[69]\s*[×x]\s*[69]\s*网格[\s\S]*?不得让完整五官落在同一格[。.]?/g,
  /整张图必须覆盖白色\s*[69]\s*[×x]\s*[69]\s*网格[\s\S]*?不得让完整五官落在同一格[。.;；]*/g,
  /白色\s*[69]\s*[×x]\s*[69]\s*网格（[^）]*）[^。\n]*把五官分拆到不同格子[^。\n]*[。.]?/g,
]

const VIDEO_GRID_PATTERNS = [
  /写实真人项目必须在提示词中写明去掉参考图整张画面上的白色\s*[69]\s*[×x]\s*[69]网格[\s\S]*?还原无网格的自然画面(?:，不得残留网格)?[。.]?/g,
  /去掉参考图整张画面上的白色\s*[69]\s*[×x]\s*[69]网格[\s\S]*?(?:不得残留格子或白色线|不得残留网格)[。.]?/g,
  /Remove the white [69]x[69] grid covering the entire reference image[\s\S]*?(?:restore the natural scene with no lattice overlay\.?|no lattice overlay\.?)/gi,
]

export function stripCharacterFaceGridPrompt(prompt: string) {
  return applyPatterns(prompt, IMAGE_GRID_PATTERNS)
}

export function stripVideoFaceGridPrompt(prompt: string) {
  return applyPatterns(prompt, VIDEO_GRID_PATTERNS)
}
