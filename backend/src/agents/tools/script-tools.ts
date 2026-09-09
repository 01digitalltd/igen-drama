/**
 * 剧本改写 Agent 工具
 * 模块级单例 — episodeId 通过 RequestContext 按请求注入
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from '../../db/query.js'
import { now } from '../../utils/response.js'
import { getEpisodeId, getAgentLocale } from '../context.js'
import { withContentLanguage } from '../../utils/content-language.js'
import { dramaAdFields, loadDramaAdContext } from '../../services/brand-logo.js'
import { isAdPromoCategory } from '../../utils/project-category.js'

async function episodeProjectMeta(episodeId: number) {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) return { error: `Episode not found (id=${episodeId})` as const }
  const ad = await loadDramaAdContext(ep.dramaId)
  return { ep, ad }
}

const AD_REWRITE_INSTRUCTION = `请将以下内容改写为广告分场剧本（广告推广项目）。

结构、出场人物、产品戏份以已注入的 ad_purpose / ad_form / ad_angle 技能为准。
格式规范：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言；品牌露出写成包装、店招或片尾板，不要写成屏幕大字幕
- 对白：角色名：（状态/表情）台词内容；口播可用「旁白：（状态）文案」
- 片尾场必须写到品牌Logo可见
- 不要发明品牌名、口号或 Logo 图形；用户没给的信息不要编
- 每个场景服务一个广告节拍，不要写成可连载短剧（短剧宣传形式除外：可写微型冲突，但仍必须在本支片子收束）`

const DRAMA_REWRITE_INSTRUCTION = `请将以下内容改写为格式化剧本。

格式规范：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言
- 对白：角色名：（状态/表情）台词内容
- 每个场景 30-60 秒内容`

const readEpisodeScript = createTool({
  id: 'read_episode_script',
  description: 'Read the script content of the current episode.',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const episodeId = getEpisodeId(context?.requestContext)
    if (!episodeId) return { error: 'Missing episodeId in request context' }
    const meta = await episodeProjectMeta(episodeId)
    if ('error' in meta) return meta
    const content = meta.ep.content || meta.ep.scriptContent
    if (!content) return { error: `Episode has no content (id=${episodeId})` }
    return {
      content,
      word_count: content.length,
      episode_id: episodeId,
      ...dramaAdFields(meta.ad),
    }
  },
})

const rewriteToScreenplay = createTool({
  id: 'rewrite_to_screenplay',
  description: 'Read the original content for AI rewriting. Returns the source text with formatting instructions.',
  inputSchema: z.object({
    instructions: z.string().optional().describe('Additional rewrite instructions'),
  }),
  execute: async ({ instructions }, context) => {
    const episodeId = getEpisodeId(context?.requestContext)
    if (!episodeId) return { error: 'Missing episodeId in request context' }
    const meta = await episodeProjectMeta(episodeId)
    if ('error' in meta) return meta
    const source = meta.ep.content || meta.ep.scriptContent
    if (!source) return { error: `Episode has no content to rewrite` }
    const locale = getAgentLocale(context?.requestContext)
    const base = isAdPromoCategory(meta.ad.genre) ? AD_REWRITE_INSTRUCTION : DRAMA_REWRITE_INSTRUCTION

    return {
      source_content: source,
      ...dramaAdFields(meta.ad),
      instruction: withContentLanguage(`${base}

${instructions || ''}

【原始内容】
${source}`, locale),
    }
  },
})

const saveScript = createTool({
  id: 'save_script',
  description: 'Save the rewritten screenplay content to the current episode.',
  inputSchema: z.object({
    content: z.string().describe('The formatted screenplay content to save'),
  }),
  execute: async ({ content }, context) => {
    const episodeId = getEpisodeId(context?.requestContext)
    if (!episodeId) return { error: 'Missing episodeId in request context' }
    await db.update(schema.episodes)
      .set({ scriptContent: content, updatedAt: now() })
      .where(eq(schema.episodes.id, episodeId))

    return { message: `Script saved`, word_count: content.length }
  },
})

export const scriptTools = {
  read_episode_script: readEpisodeScript,
  rewrite_to_screenplay: rewriteToScreenplay,
  save_script: saveScript,
}
