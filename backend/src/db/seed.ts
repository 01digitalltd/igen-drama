import { getCollection, getMongoDb, collectionName, readSeq } from './mongo.js'
import * as schema from './schema.js'
import { now } from '../utils/response.js'

const stylePresetSeeds = [
  { name: '3D 漫剧', value: '3d', sortOrder: 1, prompt: '3D CG animation style, game-engine quality render, semi-realistic stylized characters, refined facial features, detailed materials and textures, cinematic lighting, high detail', description: '游戏引擎级 3D 渲染，半写实角色，当前短剧主流的 3D 漫剧质感' },
  { name: '日漫赛璐璐', value: 'anime', sortOrder: 2, prompt: 'Japanese anime style, cel shading, clean crisp line art, vivid saturated colors, expressive character designs, detailed painted backgrounds', description: '日式赛璐璐动画风格' },
  { name: '吉卜力手绘', value: 'ghibli', sortOrder: 3, prompt: 'Studio Ghibli style, hand-drawn animation, soft watercolor painted backgrounds, warm nostalgic lighting, gentle natural palette, whimsical cozy atmosphere', description: '吉卜力手绘治愈风' },
  { name: '水彩绘本', value: 'watercolor', sortOrder: 4, prompt: 'watercolor illustration style, soft translucent washes, visible paper texture, delicate fluid brushwork, light airy atmosphere, hand-painted storybook feel', description: '水彩插画质感' },
  { name: '美式漫画', value: 'comic', sortOrder: 5, prompt: 'Western comic book style, bold black ink outlines, halftone dot shading, dynamic saturated colors, dramatic contrast lighting, flat graphic novel look', description: '美式漫画粗线条风格' },
  { name: '写实真人', value: 'realistic', sortOrder: 6, prompt: 'photorealistic live-action cinematic still, real human actors with natural skin texture pores and imperfections, real-world photography not illustration, 35mm film look, natural lighting, shallow depth of field, no anime, no cel shading, no 3D render, no CGI character, no cartoon', description: '真人实拍电影质感，自然皮肤与光影，非动画非 3D' },
]

export async function seedMongo() {
  const db = getMongoDb()
  await getCollection(schema.dramas.__name).createIndex({ ownerUserId: 1 })
  await getCollection(schema.episodes.__name).createIndex({ dramaId: 1 })
  await getCollection(schema.characters.__name).createIndex({ dramaId: 1 })
  await getCollection(schema.scenes.__name).createIndex({ dramaId: 1 })
  await getCollection(schema.props.__name).createIndex({ dramaId: 1 })
  await getCollection(schema.storyboards.__name).createIndex({ episodeId: 1 })
  await getCollection(schema.sysTask.__name).createIndex({ dramaId: 1 })
  await getCollection(schema.sysTask.__name).createIndex({ storyboardId: 1 })
  await getCollection(schema.sysTask.__name).createIndex({ type: 1 })
  await getCollection(schema.stylePresets.__name).createIndex({ value: 1 }, { unique: true })
  await db.collection(collectionName('counters')).createIndex({ _id: 1 })

  const presets = getCollection(schema.stylePresets.__name)
  const counters = db.collection(collectionName('counters'))
  const ts = now()
  for (const seed of stylePresetSeeds) {
    const exists = await presets.findOne({ value: seed.value })
    if (exists) continue
    const next = await counters.findOneAndUpdate(
      { _id: schema.stylePresets.__name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    )
    const id = readSeq(next)
    await presets.insertOne({
      _id: id,
      name: seed.name,
      value: seed.value,
      prompt: seed.prompt,
      description: seed.description,
      sortOrder: seed.sortOrder,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    })
  }
}
