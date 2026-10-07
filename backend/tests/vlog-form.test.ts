import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostVlogTaxonomy, looksLikeHostVlog } from '../src/services/vlog-form-detect.ts'
import { normalizeAdTaxonomy } from '../src/utils/ad-taxonomy.ts'

const FOOD_VLOG = `這部短影片講述女主角在香港街頭展開的美食 Vlog 體驗。一開始她手持鏡頭對著街景興奮介紹自己從小吃到大的老字號餐廳，並慶幸今天不用排隊；隨後畫面切換至大牌檔廚房，展示師傅在大火猛烈翻炒下熱氣騰騰、鑊氣十足的乾炒牛河裝盤過程；接著女主角在露天座位大口品嚐，大讚味道依然維持極高水準且完全沒有出水；最後她手拿冰檸檬茶向觀眾表達極大的滿足感，並引導大家看底下地址與轉發影片。`

test('a pasted food vlog is recognized and switches off product showcase', () => {
  assert.equal(looksLikeHostVlog(FOOD_VLOG), true)
  assert.equal(looksLikeHostVlog('包裝特寫，無人出鏡，展示瓶身。'), false)
  const spec = normalizeAdTaxonomy({ purpose: 'product_sell', form: 'product_showcase', angle: 'pack_hero' })
  const next = hostVlogTaxonomy(spec, FOOD_VLOG)
  assert.deepEqual(next, { purpose: 'product_sell', form: 'vlog', angle: 'street_find' })
  assert.equal(hostVlogTaxonomy(next!, FOOD_VLOG), null)
})
