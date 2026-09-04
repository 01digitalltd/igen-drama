/**
 * Table metadata for the Mongo query layer.
 * Documents use camelCase fields; integer primary keys are stored as numeric `_id`.
 */
export type ColumnRef = {
  __table: string
  __field: string
}

export type TableDef<T> = { [K in keyof T]: ColumnRef } & {
  __name: string
  $inferSelect: T
}

function defineTable<T extends Record<string, unknown>>(name: string, fields: (keyof T & string)[]): TableDef<T> {
  const table: Record<string, unknown> = { __name: name }
  for (const field of fields) {
    table[field] = { __table: name, __field: field }
  }
  return table as TableDef<T>
}

export type DramaRow = {
  id: number
  title: string
  description: string | null
  genre: string | null
  style: string | null
  aspectRatio: string | null
  dialogueLanguage: string | null
  totalEpisodes: number | null
  totalDuration: number | null
  status: string
  thumbnail: string | null
  tags: string | null
  metadata: string | null
  ownerUserId: string | null
  ownerTenantId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type EpisodeRow = {
  id: number
  dramaId: number
  episodeNumber: number
  title: string
  content: string | null
  scriptContent: string | null
  description: string | null
  duration: number | null
  status: string | null
  videoUrl: string | null
  thumbnail: string | null
  imageConfigId: number | null
  videoConfigId: number | null
  resolution: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type CharacterRow = {
  id: number
  dramaId: number
  name: string
  role: string | null
  description: string | null
  appearance: string | null
  styling: string | null
  finalPrompt: string | null
  personality: string | null
  imageUrl: string | null
  referenceImages: string | null
  seedValue: string | null
  sortOrder: number | null
  localPath: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type EpisodeCharacterRow = {
  id: number
  episodeId: number
  characterId: number
  createdAt: string
}

export type EpisodeSceneRow = {
  id: number
  episodeId: number
  sceneId: number
  createdAt: string
}

export type EpisodePropRow = {
  id: number
  episodeId: number
  propId: number
  createdAt: string
}

export type SceneRow = {
  id: number
  dramaId: number
  episodeId: number | null
  location: string
  time: string
  prompt: string
  lighting: string | null
  finalPrompt: string | null
  storyboardCount: number | null
  imageUrl: string | null
  status: string | null
  localPath: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type StoryboardRow = {
  id: number
  episodeId: number
  sceneId: number | null
  storyboardNumber: number
  title: string | null
  location: string | null
  time: string | null
  shotType: string | null
  angle: string | null
  movement: string | null
  result: string | null
  atmosphere: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  bgmPrompt: string | null
  soundEffect: string | null
  description: string | null
  duration: number | null
  composedImage: string | null
  firstFrameImage: string | null
  lastFrameImage: string | null
  referenceImages: string | null
  videoUrl: string | null
  subtitleUrl: string | null
  composedVideoUrl: string | null
  status: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type StoryboardCharacterRow = {
  storyboardId: number
  characterId: number
}

export type StoryboardPropRow = {
  storyboardId: number
  propId: number
}

export type AiServiceConfigRow = {
  id: number
  serviceType: string
  provider: string | null
  name: string
  baseUrl: string
  apiKey: string
  model: string | null
  endpoint: string | null
  queryEndpoint: string | null
  priority: number | null
  isDefault: boolean | null
  isActive: boolean | null
  settings: string | null
  createdAt: string
  updatedAt: string
}

export type AiServiceProviderRow = {
  id: number
  name: string
  displayName: string | null
  serviceType: string
  provider: string
  defaultUrl: string | null
  presetModels: string | null
  description: string | null
  isActive: boolean | null
  createdAt: string
  updatedAt: string
}

export type StylePresetRow = {
  id: number
  name: string
  value: string
  prompt: string
  description: string | null
  sortOrder: number | null
  isActive: boolean | null
  createdAt: string
  updatedAt: string
}

export type SysTaskRow = {
  id: number
  type: string
  storyboardId: number | null
  dramaId: number | null
  sceneId: number | null
  characterId: number | null
  propId: number | null
  provider: string | null
  prompt: string | null
  model: string | null
  params: string | null
  taskId: string | null
  resultUrl: string | null
  localPath: string | null
  status: string | null
  errorMsg: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type VideoMergeRow = {
  id: number
  episodeId: number | null
  dramaId: number | null
  title: string | null
  provider: string | null
  model: string | null
  status: string | null
  scenes: string | null
  mergedUrl: string | null
  duration: number | null
  taskId: string | null
  errorMsg: string | null
  createdAt: string
  completedAt: string | null
  deletedAt: string | null
}

export type PropRow = {
  id: number
  dramaId: number
  name: string
  type: string | null
  description: string | null
  prompt: string | null
  finalPrompt: string | null
  imageUrl: string | null
  referenceImages: string | null
  localPath: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type AssetRow = {
  id: number
  dramaId: number | null
  episodeId: number | null
  storyboardId: number | null
  storyboardNum: number | null
  name: string | null
  description: string | null
  type: string | null
  category: string | null
  url: string | null
  thumbnailUrl: string | null
  localPath: string | null
  fileSize: number | null
  mimeType: string | null
  width: number | null
  height: number | null
  duration: number | null
  format: string | null
  imageGenId: number | null
  videoGenId: number | null
  isFavorite: boolean | null
  viewCount: number | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export const dramas = defineTable<DramaRow>('dramas', [
  'id', 'title', 'description', 'genre', 'style', 'aspectRatio', 'dialogueLanguage', 'totalEpisodes', 'totalDuration',
  'status', 'thumbnail', 'tags', 'metadata', 'ownerUserId', 'ownerTenantId', 'createdAt', 'updatedAt', 'deletedAt',
])

export const episodes = defineTable<EpisodeRow>('episodes', [
  'id', 'dramaId', 'episodeNumber', 'title', 'content', 'scriptContent', 'description', 'duration',
  'status', 'videoUrl', 'thumbnail', 'imageConfigId', 'videoConfigId', 'resolution', 'createdAt', 'updatedAt', 'deletedAt',
])

export const characters = defineTable<CharacterRow>('characters', [
  'id', 'dramaId', 'name', 'role', 'description', 'appearance', 'styling', 'finalPrompt', 'personality',
  'imageUrl', 'referenceImages', 'seedValue', 'sortOrder', 'localPath', 'createdAt', 'updatedAt', 'deletedAt',
])

export const episodeCharacters = defineTable<EpisodeCharacterRow>('episode_characters', [
  'id', 'episodeId', 'characterId', 'createdAt',
])

export const episodeScenes = defineTable<EpisodeSceneRow>('episode_scenes', [
  'id', 'episodeId', 'sceneId', 'createdAt',
])

export const episodeProps = defineTable<EpisodePropRow>('episode_props', [
  'id', 'episodeId', 'propId', 'createdAt',
])

export const scenes = defineTable<SceneRow>('scenes', [
  'id', 'dramaId', 'episodeId', 'location', 'time', 'prompt', 'lighting', 'finalPrompt',
  'storyboardCount', 'imageUrl', 'status', 'localPath', 'createdAt', 'updatedAt', 'deletedAt',
])

export const storyboards = defineTable<StoryboardRow>('storyboards', [
  'id', 'episodeId', 'sceneId', 'storyboardNumber', 'title', 'location', 'time', 'shotType', 'angle',
  'movement', 'result', 'atmosphere', 'imagePrompt', 'videoPrompt', 'bgmPrompt', 'soundEffect', 'description',
  'duration', 'composedImage', 'firstFrameImage', 'lastFrameImage', 'referenceImages', 'videoUrl',
  'subtitleUrl', 'composedVideoUrl', 'status', 'createdAt', 'updatedAt', 'deletedAt',
])

export const storyboardCharacters = defineTable<StoryboardCharacterRow>('storyboard_characters', [
  'storyboardId', 'characterId',
])

export const storyboardProps = defineTable<StoryboardPropRow>('storyboard_props', [
  'storyboardId', 'propId',
])

export const aiServiceConfigs = defineTable<AiServiceConfigRow>('ai_service_configs', [
  'id', 'serviceType', 'provider', 'name', 'baseUrl', 'apiKey', 'model', 'endpoint', 'queryEndpoint',
  'priority', 'isDefault', 'isActive', 'settings', 'createdAt', 'updatedAt',
])

export const aiServiceProviders = defineTable<AiServiceProviderRow>('ai_service_providers', [
  'id', 'name', 'displayName', 'serviceType', 'provider', 'defaultUrl', 'presetModels',
  'description', 'isActive', 'createdAt', 'updatedAt',
])

export const stylePresets = defineTable<StylePresetRow>('style_presets', [
  'id', 'name', 'value', 'prompt', 'description', 'sortOrder', 'isActive', 'createdAt', 'updatedAt',
])

export const sysTask = defineTable<SysTaskRow>('sys_task', [
  'id', 'type', 'storyboardId', 'dramaId', 'sceneId', 'characterId', 'propId', 'provider', 'prompt',
  'model', 'params', 'taskId', 'resultUrl', 'localPath', 'status', 'errorMsg', 'createdAt', 'updatedAt', 'completedAt',
])

export const videoMerges = defineTable<VideoMergeRow>('video_merges', [
  'id', 'episodeId', 'dramaId', 'title', 'provider', 'model', 'status', 'scenes', 'mergedUrl',
  'duration', 'taskId', 'errorMsg', 'createdAt', 'completedAt', 'deletedAt',
])

export const props = defineTable<PropRow>('props', [
  'id', 'dramaId', 'name', 'type', 'description', 'prompt', 'finalPrompt', 'imageUrl',
  'referenceImages', 'localPath', 'createdAt', 'updatedAt', 'deletedAt',
])

export const assets = defineTable<AssetRow>('assets', [
  'id', 'dramaId', 'episodeId', 'storyboardId', 'storyboardNum', 'name', 'description', 'type', 'category',
  'url', 'thumbnailUrl', 'localPath', 'fileSize', 'mimeType', 'width', 'height', 'duration', 'format',
  'imageGenId', 'videoGenId', 'isFavorite', 'viewCount', 'createdAt', 'updatedAt', 'deletedAt',
])
