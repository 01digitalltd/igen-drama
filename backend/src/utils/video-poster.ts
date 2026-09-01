/**
 * 视频海报帧提取 — 供 <video poster> 使用，避免列表页为显示首帧而缓冲整个视频
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import {
  ensureScratchDir,
  getAbsolutePath,
  materializeLocalFile,
  persistDerivedFile,
} from './storage.js'
import { isS3Enabled, parseMediaUrlToKey } from './s3-media.js'
import { ffmpeg, checkFfmpegSuite } from './ffmpeg.js'

/** 由视频相对路径推导海报帧路径：static/videos/x.mp4 → static/videos/x_poster.jpg */
export function posterPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./?#]+(?=($|\?|#))/, '_poster.jpg')
}

/**
 * 抽取视频 0.5s 处画面作为海报帧（宽 640，等比缩放，与原视频同目录）。
 * 失败返回 null，不阻断主流程。
 */
export async function extractVideoPoster(relativePath: string): Promise<string | null> {
  let local: { filePath: string; cleanup: () => void } | null = null
  try {
    const { ffmpeg: ffmpegOk } = await checkFfmpegSuite()
    if (!ffmpegOk) return null

    local = await materializeLocalFile(relativePath)
    const scratch = ensureScratchDir()
    const posterAbs = path.join(scratch, `${uuid()}_poster.jpg`)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(local!.filePath)
        .screenshots({
          timestamps: ['0.5'],
          filename: path.basename(posterAbs),
          folder: path.dirname(posterAbs),
          size: '640x?',
        })
        .on('end', () => resolve())
        .on('error', reject)
    })

    if (isS3Enabled() && parseMediaUrlToKey(relativePath)) {
      const stored = await persistDerivedFile(relativePath, posterAbs, posterPathFor, 'image/jpeg')
      try { fs.unlinkSync(posterAbs) } catch {}
      return stored
    }

    const posterRel = posterPathFor(relativePath)
    const dest = getAbsolutePath(posterRel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(posterAbs, dest)
    try { fs.unlinkSync(posterAbs) } catch {}
    return posterRel
  } catch (err) {
    console.warn(`[video-poster] 海报帧提取失败 ${relativePath}:`, (err as Error).message)
    return null
  } finally {
    local?.cleanup()
  }
}
