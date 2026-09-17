function extractGenerateText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const row = result as Record<string, unknown>
  if (typeof row.text === 'string' && row.text.trim()) return row.text.trim()
  if (typeof row.content === 'string' && row.content.trim()) return row.content.trim()
  if (Array.isArray(row.steps)) {
    for (let i = row.steps.length - 1; i >= 0; i--) {
      const step = row.steps[i]
      if (!step || typeof step !== 'object') continue
      const text = (step as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim()) return text.trim()
    }
  }
  return ''
}

const EXTRACT_TOOL_IDS = new Set([
  'read_script_for_extraction',
  'read_existing_characters',
  'read_existing_scenes',
  'read_existing_props',
  'save_dedup_characters',
  'save_dedup_scenes',
  'save_dedup_props',
])

export function isInternalToolAssetName(name: string) {
  const value = String(name || '').trim()
  if (!value) return false
  if (EXTRACT_TOOL_IDS.has(value)) return true
  if (/^(skill|skill_search|skill_read)$/.test(value)) return true
  return /^(read|save|update|write|list|get|mastra)(_[a-z0-9]+)+$/.test(value)
}

export function tryParseJson(text: string): unknown {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] || trimmed).trim()
  try {
    return JSON.parse(raw)
  } catch {
    const startObj = raw.indexOf('{')
    const startArr = raw.indexOf('[')
    const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr)
    if (start < 0) return null
    const endObj = raw.lastIndexOf('}')
    const endArr = raw.lastIndexOf(']')
    const end = Math.max(endObj, endArr)
    if (end <= start) return null
    try {
      return JSON.parse(raw.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeItems(target: ExtractAssetTarget, items: any[]): any[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item
    const record = item as Record<string, unknown>
    if (target === 'characters') {
      return {
        name: firstString(record, ['name', '姓名', '角色名', 'character']),
        role: firstString(record, ['role', '身份', '定位', '角色定位']),
        appearance: firstString(record, ['appearance', '外貌', '样貌', '樣貌']),
        styling: firstString(record, ['styling', '妆造', '妝造', '造型']),
        description: firstString(record, ['description', '描述']),
      }
    }
    if (target === 'scenes') {
      return {
        location: firstString(record, ['location', '地点', '地點', '场景', '場景']),
        time: firstString(record, ['time', '时间', '時間', '时间段', '時間段']),
        prompt: firstString(record, ['prompt', '描述', '场景描述', '場景描述']),
        lighting: firstString(record, ['lighting', '光影', '灯光', '燈光']),
        description: firstString(record, ['description', '描述']),
      }
    }
    return {
      name: firstString(record, ['name', '名称', '名稱', '道具名']),
      type: firstString(record, ['type', '类型', '類型']),
      description: firstString(record, ['description', '描述', '外貌']),
    }
  }).filter((item) => (target === 'scenes' ? Boolean(item.location) : Boolean(item.name)))
}

export function itemsFromPayload(target: ExtractAssetTarget, payload: unknown): any[] {
  if (!payload) return []
  let raw: unknown[] = []
  if (Array.isArray(payload)) {
    raw = looksLikeAssetArray(target, payload) ? payload : []
  } else if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const aliases = target === 'characters'
      ? ['characters', '角色']
      : target === 'scenes'
        ? ['scenes', '场景', '場景']
        : ['props', '道具']
    for (const key of aliases) {
      const nested = record[key]
      if (Array.isArray(nested)) {
        raw = nested
        break
      }
    }
  }
  return normalizeItems(target, raw).filter((item) => {
    const label = target === 'scenes' ? item.location : item.name
    return !isInternalToolAssetName(label)
  })
}

function looksLikeAssetArray(target: ExtractAssetTarget, raw: unknown[]) {
  if (!raw.length) return false
  return raw.some((item) => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    if (target === 'scenes') {
      const location = firstString(record, ['location', '地点', '地點', '场景', '場景'])
      return Boolean(location) && !isInternalToolAssetName(location)
    }
    const name = firstString(record, ['name', '姓名', '角色名', 'character', '名称', '名稱', '道具名'])
    return Boolean(name) && !isInternalToolAssetName(name)
  })
}

function collectRecords(entry: unknown): unknown[] {
  if (!entry || typeof entry !== 'object') return []
  const item = entry as Record<string, unknown>
  const payload = item.payload && typeof item.payload === 'object'
    ? item.payload as Record<string, unknown>
    : null
  let args = payload?.args ?? payload?.input ?? payload?.result ?? item.args ?? item.input ?? item.result
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const record = args as Record<string, unknown>
    if (record.input && typeof record.input === 'object') args = record.input
  }
  return args == null ? [] : [args]
}

function collectToolPayloads(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return []
  const row = result as Record<string, unknown>
  const bags: unknown[] = [row.toolCalls, row.toolResults]
  if (Array.isArray(row.steps)) {
    for (const step of row.steps) {
      if (!step || typeof step !== 'object') continue
      const record = step as Record<string, unknown>
      bags.push(record.toolCalls, record.toolResults)
    }
  }
  const out: unknown[] = []
  for (const bag of bags) {
    if (!Array.isArray(bag)) continue
    for (const entry of bag) out.push(...collectRecords(entry))
  }
  return out
}

function candidatePayloads(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return []
  const row = result as Record<string, unknown>
  const candidates: unknown[] = []
  if (row.object != null) candidates.push(row.object)
  if (Array.isArray(row.steps)) {
    for (let i = row.steps.length - 1; i >= 0; i--) {
      const step = row.steps[i]
      if (!step || typeof step !== 'object') continue
      const stepObject = (step as Record<string, unknown>).object
      if (stepObject != null) candidates.push(stepObject)
    }
  }
  candidates.push(...collectToolPayloads(result))
  const text = extractGenerateText(result)
  if (text) candidates.push(tryParseJson(text))
  return candidates
}

export function itemsFromGenerateResult(target: ExtractAssetTarget, result: unknown): any[] {
  for (const candidate of candidatePayloads(result)) {
    const items = itemsFromPayload(target, candidate)
    if (items.length) return items
  }
  return []
}

const SKIP_CHARACTER_NAMES = /^(旁白|画外音|畫外音|解说|解說|配音|vo|os|bgm|n|narrator|voiceover)$/i
const SKIP_SOURCE_LINE = /^(动作|動作|场景|場景|对白|對白|运镜|運鏡|分镜|分鏡|bgm|vo|os|镜头|鏡頭)\s*[：:]/i

export function charactersFromSourceScript(script: string): any[] {
  const items: { name: string; role: string; appearance: string; styling: string }[] = []
  const seen = new Set<string>()

  const add = (rawName: string) => {
    const name = String(rawName || '').replace(/[（(].*$/, '').trim()
    if (!name || name.length > 24) return
    if (SKIP_CHARACTER_NAMES.test(name) || isInternalToolAssetName(name)) return
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    items.push({ name, role: '', appearance: '', styling: '' })
  }

  for (const rawLine of String(script || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || SKIP_SOURCE_LINE.test(line)) continue

    const labeled = line.match(/^(?:人物|角色|出演|出镜|出鏡)\s*[：:]\s*(.+)$/)
    if (labeled) {
      for (const part of labeled[1].split(/[、,，/／|]+/)) {
        const cleaned = part.replace(/^(无|無|没有|沒有)\s*/, '').trim()
        if (cleaned && !/^(无|無|无人物|無人物|无角色|无人|無人)$/.test(cleaned)) add(cleaned)
      }
      continue
    }

    const dialogue = line.match(/^(.{1,24}?)[：:][（(]/)
    if (dialogue) add(dialogue[1])
  }
  return items
}

export function scenesFromFormattedScript(script: string): any[] {
  const items: { location: string; time: string; prompt: string; lighting: string }[] = []
  const seen = new Set<string>()
  for (const rawLine of String(script || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    const matched = line.match(/^##\s*(?:S?\d+\s*)?\|\s*(.+)$/i)
    if (!matched) continue
    const parts = matched[1].split('|').map((part) => part.trim()).filter(Boolean)
    if (!parts.length) continue
    const location = parts[0].replace(/^(内景|外景|內景|外景)\s*[·•.\-]\s*/, '').trim() || parts[0]
    const time = parts[1] || ''
    const key = `${location}|${time}`
    if (!location || seen.has(key)) continue
    seen.add(key)
    items.push({ location, time, prompt: '', lighting: '' })
  }
  return items
}

export function summarizeExtractResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { empty: true }
  const row = result as Record<string, unknown>
  return {
    finishReason: row.finishReason ?? row.finish_reason ?? null,
    textLen: extractGenerateText(result).length,
    hasObject: row.object != null,
    reply: extractGenerateText(result).slice(0, 300) || undefined,
  }
}
