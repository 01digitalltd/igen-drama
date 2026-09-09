import { isAdPromoCategory } from '../utils/project-category.js'
import { adSkillDirsFor, allAdSkillDirs, normalizeAdTaxonomy } from '../utils/ad-taxonomy.js'

/** 每个 Agent 注册的 skill 目录（相对 workspace/skills/，含子规范目录；目录名需符合 Agent Skills 规范：小写+连字符） */
export const AGENT_SKILL_MAP: Record<string, string[]> = {
  script_rewriter: ['script-rewriter'],
  extractor: ['extractor'],
  storyboard_breaker: ['storyboard-breaker'],
  prompt_generator: [
    'prompt-generator/character-prompt',
    'prompt-generator/scene-prompt',
    'prompt-generator/prop-prompt',
    'prompt-generator/video-prompt',
  ],
}

/** Extra skills loaded only for 广告推广 projects. Workspace registers all; injection picks purpose+form. */
export const AD_SKILL_DIRS = allAdSkillDirs()

/** Ad brief skills belong on rewrite / extract / breakdown — not prompt_generator.
 *  Dumping them into video/image prompt instructions makes the model write a script
 *  instead of calling update_storyboard(video_prompt). */
export const AD_SKILL_AGENT_TYPES = ['script_rewriter', 'extractor', 'storyboard_breaker'] as const

export function agentUsesAdSkills(agentType: string): boolean {
  return (AD_SKILL_AGENT_TYPES as readonly string[]).includes(agentType)
}

export function skillDirsForAgent(
  agentType: string,
  genre?: string | null,
  spec?: { purpose?: string | null; form?: string | null; angle?: string | null } | null,
): string[] {
  const prefixes = [...(AGENT_SKILL_MAP[agentType] || [])]
  if (isAdPromoCategory(genre) && agentUsesAdSkills(agentType)) {
    prefixes.push(...adSkillDirsFor(normalizeAdTaxonomy(spec)))
  }
  return prefixes
}
