import { test } from 'node:test'
import assert from 'node:assert/strict'
import { charactersFromSourceScript, itemsFromGenerateResult, itemsFromPayload, scenesFromFormattedScript } from '../src/services/extract-payload.ts'

test('itemsFromPayload reads English and Chinese keys', () => {
  assert.equal(itemsFromPayload('scenes', { scenes: [{ location: '办公室', time: '白天' }] }).length, 1)
  assert.equal(itemsFromPayload('scenes', { 场景: [{ 地点: '办公室' }] })[0].location, '办公室')
  assert.equal(itemsFromPayload('characters', { characters: [{ name: '上班族A' }] })[0].name, '上班族A')
})

test('empty structured object does not hide JSON text from Gemini/APIMart', () => {
  const items = itemsFromGenerateResult('scenes', {
    object: { scenes: [] },
    finishReason: 'stop',
    text: '{"scenes":[{"location":"办公室","time":"白天","prompt":"凌乱隔间","lighting":"日光"}]}',
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].location, '办公室')
})

test('reads save tool arguments when the model ignores toolChoice none', () => {
  const items = itemsFromGenerateResult('scenes', {
    object: { scenes: [] },
    finishReason: 'tool-calls',
    toolCalls: [{
      payload: {
        toolName: 'save_dedup_scenes',
        args: { scenes: [{ location: '办公室', time: '白天' }] },
      },
    }],
  })
  assert.equal(items[0].location, '办公室')
})

test('returns empty when every candidate is empty', () => {
  assert.deepEqual(itemsFromGenerateResult('characters', {
    object: { characters: [] },
    text: '没有角色',
  }), [])
})

test('walks nested tool-call payloads', () => {
  const items = itemsFromGenerateResult('scenes', {
    finishReason: 'tool-calls',
    steps: [{
      toolCalls: [{
        toolName: 'save_dedup_scenes',
        args: { input: { scenes: [{ location: '办公室', time: '白天' }] } },
      }],
    }],
  })
  assert.equal(items[0].location, '办公室')
})

test('does not treat extractor tool names as characters', () => {
  const items = itemsFromGenerateResult('characters', {
    tools: [
      { name: 'read_script_for_extraction' },
      { name: 'read_existing_characters' },
      { name: 'save_dedup_characters' },
    ],
    text: '{"characters":[{"name":"read_existing_scenes"},{"name":"save_dedup_scenes"},{"name":"mastra_workspace_read_file"},{"name":"skill_search"}]}',
  })
  assert.deepEqual(items, [])
})

test('keeps real characters when mixed with tool-id garbage', () => {
  const items = itemsFromPayload('characters', [
    { name: 'read_script_for_extraction' },
    { name: '上班族A', role: '主角' },
    { name: 'mastra_workspace_list_files' },
    { name: 'skill' },
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].name, '上班族A')
})

test('charactersFromSourceScript reads 人物 lines and skips VO labels', () => {
  const rows = charactersFromSourceScript(`分鏡1:
   人物： 上班族A
   動作：在電腦前滑鼠。
   對白：唉...
   旁白：（沉穩）尋找方案。
上班族A：（無奈）這些關鍵詞大海撈針。`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '上班族A')
})

test('charactersFromSourceScript stays empty for VO-only rewrite', () => {
  assert.deepEqual(charactersFromSourceScript(`## S01 | 内景 · 办公室 | 白昼\n\n旁白：（沉稳）寻找高效行销方案。`), [])
})

test('scenesFromFormattedScript reads rewrite headers', () => {
  const rows = scenesFromFormattedScript(`## S01 | 内景 · 办公室 | 白天\n\n凌乱的桌面。\n\n## S02 | 内景 · 办公室 | 白天\n\n手触键盘。`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].location, '办公室')
  assert.equal(rows[0].time, '白天')
})
