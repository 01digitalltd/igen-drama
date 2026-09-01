import type { Sort } from 'mongodb'
import type { ColumnRef, TableDef } from './schema.js'
import {
  getCollection,
  mapDoc,
  mongoField,
  nextId,
  toFilter,
  toInsertDoc,
  toSetDoc,
  type Condition,
} from './mongo.js'

function isColumn(value: unknown): value is ColumnRef {
  return Boolean(value && typeof value === 'object' && '__field' in (value as object))
}

function tableHasId(table: { id?: unknown }): boolean {
  return isColumn(table.id)
}

export function eq(column: ColumnRef, value: unknown): Condition {
  return { type: 'eq', field: column.__field, value }
}

export function isNull(column: ColumnRef): Condition {
  return { type: 'isNull', field: column.__field }
}

export function and(...parts: Array<Condition | undefined | null | false>): Condition {
  return { type: 'and', parts: parts.filter((part): part is Condition => Boolean(part)) }
}

export function desc(column: ColumnRef): Condition {
  return { type: 'desc', field: column.__field }
}

function orderFrom(expr: unknown): Sort | undefined {
  if (!expr) return undefined
  if (isColumn(expr)) return { [mongoField(expr.__field)]: 1 }
  const cond = expr as Condition
  if (cond.type === 'desc') return { [mongoField(cond.field)]: -1 }
  return undefined
}

function projectRow(row: Record<string, unknown>, projection?: Record<string, ColumnRef>) {
  if (!projection) return row
  const out: Record<string, unknown> = {}
  for (const [alias, column] of Object.entries(projection)) {
    out[alias] = row[column.__field]
  }
  return out
}

class SelectBuilder<T = Record<string, unknown>> implements PromiseLike<T[]> {
  private table: TableDef<T> | null = null
  private condition: unknown = undefined
  private order: unknown = undefined

  constructor(private projection?: Record<string, ColumnRef>) {}

  from(table: { __name: string }) {
    this.table = table as TableDef<T>
    return this
  }

  where(condition: unknown) {
    this.condition = condition
    return this
  }

  orderBy(expr: unknown) {
    this.order = expr
    return this
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.exec().then(onfulfilled, onrejected)
  }

  private async exec(): Promise<T[]> {
    if (!this.table) throw new Error('select().from() is required')
    const col = getCollection(this.table.__name)
    let cursor = col.find(toFilter(this.condition))
    const sort = orderFrom(this.order)
    if (sort) cursor = cursor.sort(sort)
    const docs = await cursor.toArray()
    return docs.map((doc) => projectRow(mapDoc(doc) as Record<string, unknown>, this.projection) as T)
  }
}

class InsertBuilder implements PromiseLike<{ insertId: number | string; affectedRows: number }> {
  private data: Record<string, unknown> | null = null

  constructor(private table: TableDef<Record<string, unknown>>) {}

  values(data: Record<string, unknown>) {
    this.data = data
    return this
  }

  then<TResult1 = { insertId: number | string; affectedRows: number }, TResult2 = never>(
    onfulfilled?: ((value: { insertId: number | string; affectedRows: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.exec().then(onfulfilled, onrejected)
  }

  private async exec() {
    if (!this.data) throw new Error('insert().values() is required')
    const col = getCollection(this.table.__name)
    const hasId = tableHasId(this.table)
    const id = hasId ? (typeof this.data.id === 'number' ? this.data.id : await nextId(this.table.__name)) : undefined
    await col.insertOne(toInsertDoc(hasId, this.data, id))
    return { insertId: id ?? '', affectedRows: 1 }
  }
}

class UpdateBuilder implements PromiseLike<{ affectedRows: number }> {
  private patch: Record<string, unknown> | null = null
  private condition: unknown = undefined

  constructor(private table: TableDef<Record<string, unknown>>) {}

  set(patch: Record<string, unknown>) {
    this.patch = patch
    return this
  }

  where(condition: unknown) {
    this.condition = condition
    return this
  }

  then<TResult1 = { affectedRows: number }, TResult2 = never>(
    onfulfilled?: ((value: { affectedRows: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.exec().then(onfulfilled, onrejected)
  }

  private async exec() {
    if (!this.patch) throw new Error('update().set() is required')
    const col = getCollection(this.table.__name)
    const result = await col.updateMany(toFilter(this.condition), { $set: toSetDoc(this.patch) })
    return { affectedRows: result.modifiedCount || result.matchedCount }
  }
}

class DeleteBuilder implements PromiseLike<{ affectedRows: number }> {
  private condition: unknown = undefined

  constructor(private table: TableDef<Record<string, unknown>>) {}

  where(condition: unknown) {
    this.condition = condition
    return this
  }

  then<TResult1 = { affectedRows: number }, TResult2 = never>(
    onfulfilled?: ((value: { affectedRows: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.exec().then(onfulfilled, onrejected)
  }

  private async exec() {
    const col = getCollection(this.table.__name)
    const result = await col.deleteMany(toFilter(this.condition))
    return { affectedRows: result.deletedCount }
  }
}

export const db = {
  select<T = Record<string, unknown>>(projection?: Record<string, ColumnRef>) {
    return new SelectBuilder<T>(projection)
  },
  insert(table: TableDef<any>) {
    return new InsertBuilder(table)
  },
  update(table: TableDef<any>) {
    return new UpdateBuilder(table)
  },
  delete(table: TableDef<any>) {
    return new DeleteBuilder(table)
  },
}

export type { Condition }
