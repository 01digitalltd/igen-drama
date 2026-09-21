export function characterNameAliases(name: string): string[] {
  const raw = String(name || '').trim()
  if (!raw) return []
  const aliases = new Set<string>([raw])
  const stripped = raw.replace(/[（(][^）)]*[）)]/g, '').trim()
  if (stripped) aliases.add(stripped)
  return [...aliases].filter((alias) => alias.length >= 2)
}

export function scriptSnippetsForName(script: string, name: string, limit = 2800): string {
  const aliases = characterNameAliases(name)
  if (!aliases.length) return ''
  const lines = String(script || '').split(/\r?\n/)
  const hits: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trim()
    if (!line || !aliases.some((alias) => line.includes(alias))) continue
    const chunk = [lines[i - 1], lines[i], lines[i + 1]]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join('\n')
    if (!chunk || seen.has(chunk)) continue
    seen.add(chunk)
    hits.push(chunk)
  }
  const text = hits.join('\n\n')
  if (!text) return ''
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`
}
