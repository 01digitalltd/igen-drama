/**
 * Keep each source clause's concrete wording in a rewrite or storyboard.
 * The check is the source text itself: nothing about a particular product or line is hardcoded.
 */

const SENTENCE_SPLIT = /[。！？!?；;\n]+/u
const CLAUSE_SPLIT = /[，,、]|並|并|且|然後|然后|接著|接着/u
const GLUE = /^(?:一開始|一开始|隨後|随后|然後|然后|接着|接著|最後|最后|以及|並且|并且|畫面|画面|切換至|切换至|切換到|切换到|展示|引導|引导|大家|向觀眾|向观众|女主角|男主角|她|他|的|在|與|与|和)+/u

function cjk(text: string) {
  return String(text || '').replace(/[^\u4e00-\u9fff]/g, '')
}

export function sourceFactClauses(text: string): string[] {
  const seen = new Set<string>()
  const clauses: string[] = []
  for (const sentence of String(text || '').split(SENTENCE_SPLIT)) {
    for (const part of sentence.split(CLAUSE_SPLIT)) {
      const clause = cjk(part)
      if (clause.length < 4 || seen.has(clause)) continue
      seen.add(clause)
      clauses.push(clause)
    }
  }
  return clauses
}

function longestMatchAt(clause: string, index: number, output: string) {
  for (let length = clause.length - index; length >= 2; length -= 1) {
    if (output.includes(clause.slice(index, index + length))) return length
  }
  return 0
}

/** Contiguous source spans of at least 4 characters that the output never says. */
export function missingSourceSpans(source: string, output: string): string[] {
  const haystack = String(output || '')
  const missing: string[] = []
  const seen = new Set<string>()
  for (const clause of sourceFactClauses(source)) {
    let index = 0
    while (index < clause.length) {
      const matched = longestMatchAt(clause, index, haystack)
      if (matched >= 2) {
        index += matched
        continue
      }
      let end = index + 1
      while (end < clause.length && longestMatchAt(clause, end, haystack) < 2) end += 1
      const gap = clause.slice(index, end).replace(GLUE, '')
      if (gap.length >= 4 && !seen.has(gap)) {
        seen.add(gap)
        missing.push(gap)
      }
      index = Math.max(end, index + 1)
    }
  }
  return missing
}

export function formatMissingSourceFacts(spans: string[], where: 'script' | 'storyboard') {
  const list = spans.slice(0, 8).map((span) => `「${span}」`).join('、')
  const target = where === 'script'
    ? '請把每一句寫進改寫劇本的動作或對白，然後重新調用 save_script。'
    : '請把每一句寫進某一鏡的畫面或「角色名說：「…」」，然後重新調用 save_storyboards，第一批 replace_existing: true。'
  return `少了原稿裡的這些事實：${list}。可以接在口語前後，但這些字要留下，不要改成另一句口號，也不要漏掉。${target}`
}
