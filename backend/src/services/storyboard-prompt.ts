/**
 * Video generation prefers a dedicated video_prompt. Storyboard breakdown
 * writes description (and atmosphere) instead, so empty video_prompt must
 * fall back to that shot text — MiniMax H3 requires text, and Gemini Omni
 * otherwise image-to-videos with no shot action.
 */
export function resolveStoryboardVideoPrompt(shot: {
  videoPrompt?: string | null
  video_prompt?: string | null
  description?: string | null
  atmosphere?: string | null
}): string {
  const dedicated = String(shot.videoPrompt || shot.video_prompt || '').trim()
  if (dedicated) return dedicated
  const description = String(shot.description || '').trim()
  const atmosphere = String(shot.atmosphere || '').trim()
  if (description && atmosphere) return `${description}\n\n${atmosphere}`
  return description || atmosphere
}
