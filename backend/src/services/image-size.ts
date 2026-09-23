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
