import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('content language helper maps UI locale and prefixes agent messages', () => {
  const src = read('src/utils/content-language.ts')
  assert.match(src, /normalizeContentLocale/)
  assert.match(src, /withContentLanguage/)
  assert.match(src, /zh-TW/)
  assert.match(src, /繁體/)
})

test('agent jobs and extraction inject UI locale into the user message', () => {
  const jobs = read('src/services/agent-jobs.ts')
  const extract = read('src/services/extraction.ts')
  const agentRoute = read('src/routes/agent.ts')
  const epRoute = read('src/routes/episodes.ts')
  assert.match(jobs, /from '\.\.\/utils\/task-logger\.js'/)
  assert.match(jobs, /logTaskStart/)
  assert.match(jobs, /withContentLanguage\(message, params\.locale\)/)
  assert.match(extract, /contentLanguageInstruction\(locale\)/)
  assert.match(agentRoute, /locale: getRequestLocale\(c, body\.locale\)/)
  assert.match(epRoute, /locale: getRequestLocale\(c, body\.locale\)/)
})
