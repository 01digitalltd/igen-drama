export function buildCharacterFinalPromptMessage(char: {
  id: number
  name?: string | null
  role?: string | null
  appearance?: string | null
  description?: string | null
  styling?: string | null
}, excerpt = '', styleInstruction = '') {
  const appearance = String(char.appearance || char.description || '').trim()
  const excerptBlock = String(excerpt || '').trim()
    ? `剧本原文摘录（外貌必须跟这些句子一致，禁止另造一张更漂亮但不像这个人的脸）：\n${excerpt}`
    : '剧本未点名五官细节时，只按身份、年龄感与场合补全服装，不要换成另一个人种或年龄段。'
  return [
    `为角色「${char.name}」(character_id=${char.id}) 写一张角色设定参考图的最终提示词。`,
    '构图：左侧正脸特写，右侧并列正面、90 度侧面、背面三张等高全身视图；同一张脸、同一发型、同一服装；纯白背景。3D Chibi 时用均匀三维棚灯，不要写实棚拍光。',
    '这是定妆参考图，不是剧情场面。视觉必须跟剧本一致。',
    '剧本写了的年龄、职业、制服、发型、服装、配饰必须写进提示词；职业/场合转化为服装（护士→护士服，律师→西装）。',
    '只输出纯中文单段。若有【视觉风格】，必须把该画风写进提示词：3D Chibi 必须写头身比约 1:2、头大身小、盲盒风三维、光滑树脂无毛孔，禁止电影质感、真人皮肤、棚拍写实光。',
    String(styleInstruction || '').trim(),
    `身份：${char.role || ''}；外貌：${appearance}；妆造：${char.styling || ''}`,
    excerptBlock,
    'Return JSON {"prompt":"..."} only.',
  ].filter(Boolean).join('\n')
}
