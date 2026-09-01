import { MongoClient, type Collection, type Db, type Document, type Filter } from 'mongodb'

const PREFIX = (process.env.DRAMA_MONGO_COLLECTION_PREFIX || 'drama_').replace(/_+$/, '') + '_'

let client: MongoClient | null = null
let database: Db | null = null

function mongoUri(): string {
  const uri = (process.env.MONGODB_AI_URI || process.env.MONGODB_URI || process.env.DATABASE_URL || '').trim()
  if (!uri || !/^mongodb(\+srv)?:\/\//i.test(uri)) {
    throw new Error(
      'Missing MongoDB URI. Set MONGODB_AI_URI (same cluster as mkt-ai, e.g. mongodb+srv://.../reform-ai).',
    )
  }
  return uri
}

export async function initMongo(retries = 10, delayMs = 3000) {
  const uri = mongoUri()
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const next = new MongoClient(uri, { maxPoolSize: 20 })
      await next.connect()
      client = next
      database = next.db()
      await database.command({ ping: 1 })
      return
    } catch (err) {
      lastError = err as Error
      console.warn(`[db] mongo connect failed (attempt ${attempt}/${retries}): ${lastError.message}`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError || new Error('MongoDB connection failed')
}

export function getMongoDb(): Db {
  if (!database) throw new Error('MongoDB is not initialized')
  return database
}

export function collectionName(table: string): string {
  return `${PREFIX}${table}`
}

export function getCollection(table: string): Collection<Document> {
  return getMongoDb().collection(collectionName(table))
}

export function mongoField(field: string): string {
  return field === 'id' ? '_id' : field
}

export function mapDoc<T = Record<string, unknown>>(doc: Document | null | undefined): T | undefined {
  if (!doc) return undefined
  const { _id, ...rest } = doc
  const row: Record<string, unknown> = { ...rest }
  if (typeof _id === 'number') row.id = _id
  return row as T
}

export function toInsertDoc(tableHasId: boolean, values: Record<string, unknown>, id?: number): Document {
  const doc: Document = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || key === 'id' || key === '_id') continue
    doc[key] = value
  }
  if (tableHasId) doc._id = id
  return doc
}

export function toSetDoc(values: Record<string, unknown>): Document {
  const doc: Document = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || key === 'id' || key === '_id') continue
    doc[key] = value
  }
  return doc
}

export function readSeq(result: unknown): number {
  if (!result || typeof result !== 'object') return 1
  const doc = result as { seq?: number; value?: { seq?: number } }
  return Number(doc.seq ?? doc.value?.seq ?? 1)
}

export async function nextId(table: string): Promise<number> {
  const counters = getMongoDb().collection(collectionName('counters'))
  const result = await counters.findOneAndUpdate(
    { _id: table } as Filter<Document>,
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  return readSeq(result)
}

export function toFilter(condition: unknown): Filter<Document> {
  if (!condition) return {}
  const cond = condition as Condition
  if (cond.type === 'eq') {
    return { [mongoField(cond.field)]: cond.value }
  }
  if (cond.type === 'isNull') {
    const field = mongoField(cond.field)
    return { $or: [{ [field]: null }, { [field]: { $exists: false } }] }
  }
  if (cond.type === 'and') {
    const parts = cond.parts.map((part) => toFilter(part)).filter((part) => Object.keys(part).length > 0)
    if (!parts.length) return {}
    if (parts.length === 1) return parts[0]
    return { $and: parts }
  }
  return {}
}

export type Condition =
  | { type: 'eq'; field: string; value: unknown }
  | { type: 'isNull'; field: string }
  | { type: 'and'; parts: Condition[] }
  | { type: 'desc'; field: string }
