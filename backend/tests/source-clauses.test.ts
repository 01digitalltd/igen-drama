import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMissingSourceFacts, missingSourceSpans, sourceFactClauses } from '../src/services/source-clauses.ts'

const SOURCE = [
  '一開始她手持鏡頭對著街景興奮介紹自己從小吃到大的老字號餐廳，並慶幸今天不用排隊；',
  '隨後畫面切換至大牌檔廚房，展示師傅在大火猛烈翻炒下熱氣騰騰、鑊氣十足的乾炒牛河裝盤過程；',
  '接著女主角在露天座位大口品嚐，大讚味道依然維持極高水準且完全沒有出水；',
  '最後她手拿冰檸檬茶向觀眾表達極大的滿足感，並引導大家看底下地址與轉發影片。',
].join('')

const DROPPED = [
  '【鏡頭1】女主角單手手持鏡頭自拍，興奮地對著鏡頭介紹香港街頭的景象，身後是老字號餐廳門面。女主角說：「哈囉！今天帶大家來老字號餐廳！」',
  '【鏡頭3】切換到大牌檔廚房，師傅熟練地在大火上猛烈翻炒著乾炒牛河，熱氣騰騰，鑊氣十足。',
  '【鏡頭1】女主角坐在露天座位上大口品嚐。女主角說：「哇！這個味道！太好吃了！」',
  '【鏡頭2】女主角手裡拿著一杯冰檸檬茶，臉上洋溢著極大的滿足感。女主角說：「地址在下面喔！」',
].join('\n')

test('source clauses split on punctuation and joining words', () => {
  const clauses = sourceFactClauses(SOURCE)
  assert.ok(clauses.some((clause) => clause.includes('不用排隊')))
  assert.ok(clauses.some((clause) => clause.includes('沒有出水')))
  assert.ok(clauses.some((clause) => clause.includes('裝盤')))
})

test('a storyboard that drops a source clause is rejected with that clause', () => {
  const missing = missingSourceSpans(SOURCE, DROPPED)
  assert.ok(missing.some((span) => span.includes('不用排隊')))
  assert.ok(missing.some((span) => span.includes('裝盤')))
  assert.ok(missing.some((span) => span.includes('沒有出水')))
  assert.ok(missing.some((span) => span.includes('轉發')))
  assert.match(formatMissingSourceFacts(missing, 'storyboard'), /不用排隊/)
  assert.match(formatMissingSourceFacts(missing, 'storyboard'), /save_storyboards/)
})

test('the same facts pass once the source wording is present', () => {
  const kept = [
    DROPPED,
    '她對着街景說自己從小吃到大，並慶幸今天不用排隊。',
    '師傅翻炒後把乾炒牛河裝盤。',
    '味道依然維持極高水準，完全沒有出水。',
    '看底下地址，並轉發影片。',
  ].join('\n')
  const missing = missingSourceSpans(SOURCE, kept)
  assert.deepEqual(missing.filter((span) => /不用排隊|裝盤|沒有出水|轉發|從小吃到大|極高水準/.test(span)), [])
})
