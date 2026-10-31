import type { Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditRepo,
  classifyConstraintError,
  migrateToLatest,
  newId,
  rolesRepo,
  sessionsRepo,
  usersRepo,
  type ConstraintViolation,
  type Database,
} from '../src'
import { dialects, tempDir } from './helpers'

const dir = tempDir()

function newUser(overrides: { username: string; role_id?: string }) {
  return {
    id: newId(),
    full_name: 'موظف',
    password_hash: 'hash',
    pin_hash: null,
    role_id: 'cashier',
    locked_until: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

async function violationOf(run: () => Promise<unknown>): Promise<ConstraintViolation | null> {
  try {
    await run()
  } catch (error) {
    return classifyConstraintError(error)
  }
  throw new Error('Expected the statement to fail')
}

describe.each(dialects(dir))('identity tables on %s', (_name, create) => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = create()
    await migrateToLatest(db)
    await rolesRepo(db).insert({ id: 'cashier', name: 'Cashier', is_system: 1, created_at: 1 })
    await usersRepo(db).insert(newUser({ username: 'first' }))
  })

  afterAll(() => db.destroy())

  it('reports a duplicate username as a unique violation on that column', async () => {
    const violation = await violationOf(() => usersRepo(db).insert(newUser({ username: 'first' })))
    expect(violation).toEqual({ kind: 'unique', target: 'users.username' })
  })

  it('reports an unknown role as a foreign key violation', async () => {
    const violation = await violationOf(() =>
      usersRepo(db).insert(newUser({ username: 'orphan', role_id: 'missing' })),
    )
    expect(violation?.kind).toBe('foreign_key')
  })

  it('refuses to delete a role that still has users', async () => {
    const violation = await violationOf(() => rolesRepo(db).delete('cashier'))
    expect(violation?.kind).toBe('foreign_key')
  })

  it('enforces the boolean check at the database level', async () => {
    const violation = await violationOf(() =>
      usersRepo(db).insert({ ...newUser({ username: 'bad-flag' }), is_active: 2 }),
    )
    expect(violation?.kind).toBe('check')
  })

  it('returns timestamps as numbers on both dialects', async () => {
    await sessionsRepo(db).insert('hash-1', (await usersRepo(db).findByUsername('first'))!.id, 10, 2_000_000_000_000)
    expect(await sessionsRepo(db).find('hash-1')).toMatchObject({ expiresAt: 2_000_000_000_000 })
  })

  it('removes only expired sessions', async () => {
    const user = (await usersRepo(db).findByUsername('first'))!
    await sessionsRepo(db).insert('old', user.id, 1, 5)
    await sessionsRepo(db).insert('live', user.id, 1, 500)
    await sessionsRepo(db).deleteExpired(100)
    expect(await sessionsRepo(db).find('old')).toBeUndefined()
    expect(await sessionsRepo(db).find('live')).toBeDefined()
  })

  it('counts active users in a role', async () => {
    const before = await usersRepo(db).countActiveInRole('cashier')
    const user = newUser({ username: 'inactive-one' })
    await usersRepo(db).insert({ ...user, is_active: 0 })
    expect(await usersRepo(db).countActiveInRole('cashier')).toBe(before)
  })

  it('rolls back every write when a transaction fails', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await usersRepo(trx).insert(newUser({ username: 'in-transaction' }))
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
    expect(await usersRepo(db).findByUsername('in-transaction')).toBeUndefined()
  })

  it('pages audit entries newest first without gaps or repeats', async () => {
    const repo = auditRepo(db)
    for (let index = 1; index <= 5; index++) {
      // Three rows share a timestamp so the cursor must also break ties on id.
      await repo.record({ actorId: null, action: `a${index}`, occurredAt: index <= 3 ? 100 : index * 100 })
    }

    const first = await repo.page(2)
    const second = await repo.page(2, first.nextCursor!)
    const third = await repo.page(2, second.nextCursor!)
    const seen = [...first.items, ...second.items, ...third.items].map((item) => item.action)

    expect(seen.slice(0, 2)).toEqual(['a5', 'a4'])
    expect(new Set(seen).size).toBe(5)
    expect(third.nextCursor).toBeNull()
  })
})
