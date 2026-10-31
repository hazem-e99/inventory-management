import { ERROR_CODES, PERMISSIONS, SYSTEM_ROLES } from '@inv/contracts'
import { describe, expect, it } from 'vitest'
import { ar, en } from '../src'

/** Leaves as `[path, text]`, keeping dotted keys such as `users.view` in one piece. */
function leavesOf(value: object, prefix = ''): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]): Array<[string, string]> => {
    const path = prefix ? `${prefix}/${key}` : key
    return typeof child === 'object' && child !== null ? leavesOf(child, path) : [[path, child as string]]
  })
}

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/{{(\w+)}}/g)].map((match) => match[1]!).sort()
}

describe('translations', () => {
  it('have exactly the same keys in both languages', () => {
    const keys = (root: object) => leavesOf(root).map(([key]) => key).sort()
    expect(keys(ar)).toEqual(keys(en))
  })

  it('translate every error code in both languages', () => {
    for (const code of ERROR_CODES) {
      expect(ar.errors[code], `ar ${code}`).toBeTruthy()
      expect(en.errors[code], `en ${code}`).toBeTruthy()
    }
  })

  it('have no error text for a code that does not exist', () => {
    expect(Object.keys(ar.errors).sort()).toEqual([...ERROR_CODES].sort())
  })

  it('name every permission and system role', () => {
    for (const permission of PERMISSIONS) {
      expect(ar.permissions[permission], permission).toBeTruthy()
      expect(en.permissions[permission], permission).toBeTruthy()
    }
    for (const role of SYSTEM_ROLES) {
      expect(ar.roles.names[role], role).toBeTruthy()
      expect(en.roles.names[role], role).toBeTruthy()
    }
  })

  it('use the same placeholders in both languages', () => {
    const english = new Map(leavesOf(en))
    for (const [key, text] of leavesOf(ar)) {
      expect(placeholdersOf(text), key).toEqual(placeholdersOf(english.get(key)!))
    }
  })
})
