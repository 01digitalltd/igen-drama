const APIMART_ASPECTS = new Set([
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16',
  '2:1', '1:2', '21:9', '9:21', '3:1', '1:3',
])

/** APIMart size is the script aspect ratio itself, not a pixel size derived from it. */
export function apimartSizeForAspectRatio(aspectRatio?: string | null): string {
  const ratio = String(aspectRatio || '').trim()
  if (ratio === '1.91:1') return '16:9'
  if (APIMART_ASPECTS.has(ratio)) return ratio
  return '16:9'
}

/** Map drama aspect_ratio to pixel size for storyboard still generation. */
export function imageSizeForAspectRatio(aspectRatio?: string | null): string {
  const ratio = String(aspectRatio || '').trim()
  switch (ratio) {
    case '9:16':
      return '1080x1920'
    case '1:1':
      return '1080x1080'
    case '4:3':
      return '1440x1080'
    case '3:4':
      return '1080x1440'
    case '21:9':
      return '1890x810'
    case '16:9':
    case 'adaptive':
    default:
      return '1920x1080'
  }
}
