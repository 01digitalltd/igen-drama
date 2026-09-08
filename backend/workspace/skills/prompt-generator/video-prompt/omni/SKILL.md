---
name: omni
description: Gemini Omni Flash 视频提示词规范 — 简单标记绑定参考图、按时间码分段、原生音画
---

# Gemini Omni 视频提示词（分镜段落 → video_prompt）

仅当 `read_storyboard_context.video_generation.prompt_skill` 为 `omni`（provider/model 含 gemini / omni）时遵守本技能。其他模型改用父技能 `video-prompt`（Seedance 格式）。

根据单个分镜段落的 description（含【镜头N】子镜头与台词/旁白）/ atmosphere / duration，以及该分镜的 `image_refs`，生成驱动 **Gemini Omni Flash** 的 `video_prompt`。Omni 同时处理文本、图像并自带音轨。

**一个分镜段落 = 一次视频生成任务，时长不得超过 `duration_max`（Omni 上限 10 秒）**。段内允许切镜，但**全程不跨场景**、不闪回。

## 格式

按 `video_generation.prompt_segment` 秒为一段（缺省 3 秒），每段单独一行。时间码用 `[起-止s]`。参考图用官方**简单标记**写在主体旁边（从 0 起）：

- `<IMAGE_REF_N>` — 角色 / 场景 / 道具参考图（本流水线默认）
- `<FIRST_FRAME>` / `<LAST_FRAME>` — 仅当该镜真的用首尾帧插值时
- `<VIDEO_REF_N>` — 仅当该镜绑定了参考视频

`image_refs` 里的 `tag` 与 `name` 必须原样使用，不要自己重编号，不要写 `[# Sources]` / `[# References]`。

```
[0-3s] <IMAGE_REF_0> 咖啡厅，近景固定镜头，<IMAGE_REF_1> 小明低头看手机，手指反复敲桌面。无对白。音效：雨打窗、钟滴答。暖黄台灯。
[3-6s] 切到门口全景，门铃响，<IMAGE_REF_2> 小红推门走入，带进一阵冷风。无对白。音效：门铃、冷风灌入。
[6-9s] 切回中景，<IMAGE_REF_2> 小红走向 <IMAGE_REF_1> 小明坐下。小明说：「你终于来了。」对白清晰可辨。音效：椅子轻响。
```

不要写成 Seedance 的 `0-3秒：` 或 `@角色名`。

## 与分镜描述的映射

`description` 是 video_prompt 的唯一内容来源：

- 每个 `【镜头N】` 映射为 **1-2 个连续分段**，顺序一致、不遗漏、不合并、不新增子镜头
- 台词/旁白从对应 `【镜头N】` 内的「角色名说：「…」」「旁白：…」提取；**不要创作 description 之外的新台词**
- 画面动作以 `description` 为准；`atmosphere` 只补光线、色调、氛围与环境声

## 段内结构

每一段按此顺序（可省略无内容的项，画面与音频必须有）：

**`[起-止s]` ＋ `<IMAGE_REF_N>` 场景 ＋ 景别/运镜 ＋ `<IMAGE_REF_N>` 角色＋主体动作·表情 ＋ 对白/旁白 ＋ 音频 ＋ 氛围光线**

- **第一段必须建立空间**：场景 + 机位 + 角色位置与状态
- **切镜**：在切镜段开头写「切到/切回」并重交代景别与主体；切镜点对齐 `【镜头N】`
- **单镜连续**：若该 `【镜头N】` 跨多段且不能切，写「同一连续镜头、不切镜、unbroken continuous shot」
- **景别/运镜**：每段一个镜头状态（近景/中景/全景/特写；固定/推/拉/摇/跟）
- **动作**：每段一个主动作，动词具体可见
- **情绪全部转为可见描写**：不要「他很伤心」，写成「他低下头、手指攥紧杯沿」
- **时机**：如「3 秒后她走进画面」。时间码里的 0s 是本段视频开头

## 音频（Omni 必写）

- **有对白**：写「角色名说：「台词」」，并加「对白清晰可辨」。台词改成项目对白语言口语；3 秒念不完拆到多段
- **无对白**：该段写「无对白」或「No dialogue」
- **旁白**：写「旁白：内容」
- **环境声 / 动作音**：与画面同步
- **配乐**：仅当 atmosphere 明确需要时写
- **不要的声音**写进正文：无对白、无旁白、无额外音效

## 引用规则

`image_refs` 顺序 = 场景图 → 角色图 → 道具图，只含已有图片的绑定资产。

- 角色出场的段必须写该角色的 `<IMAGE_REF_N>`；场景建立段写场景的 tag
- 标记后面跟名字，方便阅读：`<IMAGE_REF_1> 小明抬头`
- `<IMAGE_REF_N>` 是参考形象，不是视频第一帧；不要写「从这张静帧开始播」，也不要改用 `<FIRST_FRAME>` 套角色/场景定妆图
- 只引用该分镜 `image_refs` 里出现的 tag

## 画面与质量

- 写清机位、光线、情绪；背景可读文字必须写死内容
- 负向约束写在正文里（无 negative prompt）：不要字幕、不要水印、不要额外角色
- 画面/运镜/氛围跟写作语言，对白跟项目对白语言

## 时间轴规则

- 段数 = duration ÷ prompt_segment（向上取整），各段相加等于 min(duration, duration_max)，不得超过 duration_max（最长 10 秒）
- 节奏：第一段建立 → 中段推进 → 末段落到结果或情绪点

## 禁止事项

- 跨场景切换、闪回
- 引用 `image_refs` 之外的 tag，或 Seedance 的 `@名字` / `@图片N`
- `[# Sources]`、`[# References]` 这类前缀声明（角色简单时用简单标记即可）
- 抽象心理描写；把对白写成屏幕字幕
- 为 Omni 编写编辑/续写指令（「Make the violin invisible」「Extend this video」）

## 保存

调用 `update_storyboard` 仅更新该分镜段落的 `video_prompt` 字段，不要改动其他字段，不要重新拆分整集。
