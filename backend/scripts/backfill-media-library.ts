/**
 * Copy existing /ai-video shots and the latest completed merge of each episode
 * into the media library. Safe to run again: each shot and episode keeps one card.
 *
 * Usage: cd backend && npm run backfill-media-library
 */
import { backfillMediaLibraryVideos } from '../src/services/media-library-video.js'

const stats = await backfillMediaLibraryVideos()
console.log('[backfill-media-library]', stats)
process.exit(stats.failed > 0 ? 1 : 0)
