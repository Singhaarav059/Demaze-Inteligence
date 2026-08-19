// Shared content-hashing utility (plan §42 G6: "content hashing"). One tiny
// stdlib wrapper, used by both page-cache.ts and evidence-cache.ts to detect
// whether cached content actually changed since it was last stored — no new
// dependency, node:crypto already covers this.
import { createHash } from 'node:crypto'

export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
