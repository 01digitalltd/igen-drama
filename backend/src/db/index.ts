import 'dotenv/config'
import { initMongo } from './mongo.js'
import { seedMongo } from './seed.js'
import { db } from './query.js'
import * as schema from './schema.js'

await initMongo()
await seedMongo()

export function getInsertId(result: unknown) {
  const packet = Array.isArray(result) ? result[0] : result
  const insertId = (packet as { insertId?: number | string } | undefined)?.insertId
  if (insertId === undefined || insertId === null || insertId === '') {
    throw new Error('Insert did not return an insertId')
  }
  return Number(insertId)
}

export { db, schema }
export type DB = typeof db
