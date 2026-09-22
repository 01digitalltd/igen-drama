import { test } from 'node:test'
import assert from 'node:assert/strict'
import { characterNameAliases, scriptSnippetsForName } from '../src/services/script-excerpt-text.ts'
import { buildCharacterFinalPromptMessage } from '../src/services/character-prompt-message.ts'

test('characterNameAliases strips parenthetical role tags', () => {
  assert.deepEqual(characterNameAliases('林晚（主角）'), ['林晚（主角）', '林晚'])
})

test('scriptSnippetsForName keeps the named line plus neighbors', () => {
  const script = [
    '【开场】白天办公室',
    '林晚穿着皱褶白衬衫推开玻璃门。',
    '旁白：三十岁的律师终于迟到了。',
    '同事说：「文件在桌上。」',
  ].join('\n')
  const snippet = scriptSnippetsForName(script, '林晚')
  assert.match(snippet, /皱褶白衬衫/)
  assert.match(snippet, /三十岁的律师/)
  assert.doesNotMatch(snippet, /文件在桌上/)
})

test('buildCharacterFinalPromptMessage locks visual facts to the screenplay excerpt', () => {
  const message = buildCharacterFinalPromptMessage(
    {
      id: 8,
      name: '林晚',
      role: '主角',
      appearance: '三十岁律师，眼神疲惫',
      styling: '皱褶白衬衫',
    },
    '林晚穿着皱褶白衬衫推开玻璃门。',
    '【视觉风格｜必须遵守】本项目是3D Chibi。',
  )
  assert.match(message, /林晚/)
  assert.match(message, /皱褶白衬衫/)
  assert.match(message, /剧本原文摘录/)
  assert.match(message, /护士→护士服/)
  assert.match(message, /3D Chibi/)
  assert.match(message, /头大身小/)
  assert.doesNotMatch(message, /16:9 横版角色定妆照/)
  assert.doesNotMatch(message, /不要风格词/)
})
