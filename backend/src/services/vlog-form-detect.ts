/**
 * Pure detection for host-to-camera Vlogs. Kept off the database module
 * so tests can import it without opening Mongo.
 */
import { anglesFor, type AdTaxonomy } from '../utils/ad-taxonomy.js'

const VLOG_CUES = [
  /手持(?:鏡頭|镜头|自拍)/,
  /對(?:著|着)?鏡頭|对(?:着|著)?镜头/,
  /向觀眾|向观众/,
  /轉發(?:這|这)?(?:支|條|条)?(?:影片|视频)|转发(?:这)?(?:支|条)?(?:影片|视频)/,
  /自拍口播/,
]

export function looksLikeHostVlog(text: string | null | undefined): boolean {
  const raw = String(text || '')
  if (/\bvlogs?\b/i.test(raw)) return true
  return VLOG_CUES.some((cue) => cue.test(raw))
}

/** Returns the vlog taxonomy when the source is a host Vlog and the form is not already vlog. */
export function hostVlogTaxonomy(spec: AdTaxonomy, text: string | null | undefined): AdTaxonomy | null {
  if (spec.form === 'vlog' || !looksLikeHostVlog(text)) return null
  const allowed = anglesFor(spec.purpose, 'vlog')
  return { purpose: spec.purpose, form: 'vlog', angle: allowed[0] }
}
