import type { CustomFieldType } from '@prisma/client'

/**
 * Custom field values: what each type accepts, how it is stored, and how it
 * reads. Pure, so every write path — the sidebar, the create dialog, email,
 * the Copilot — normalises the same way.
 */

export interface FieldDefinition {
  id: string
  name: string
  type: CustomFieldType
  options: string[]
}

export type Normalised = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * A raw value as stored text, or null to clear it. Empty input clears; a value
 * the type cannot hold is refused with a reason a person can act on.
 */
export function normaliseFieldValue(field: FieldDefinition, raw: unknown): Normalised {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null }
  if (Array.isArray(raw) && raw.length === 0) return { ok: true, value: null }

  switch (field.type) {
    case 'TEXT': {
      const text = String(raw).trim()
      return text.length > 2000 ? { ok: false, error: `${field.name} is limited to 2000 characters.` } : { ok: true, value: text }
    }
    case 'NUMBER': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/,/g, ''))
      return Number.isFinite(value) ? { ok: true, value: String(value) } : { ok: false, error: `${field.name} must be a number.` }
    }
    case 'SELECT': {
      const choice = matchOption(field.options, String(raw))
      return choice ? { ok: true, value: choice } : { ok: false, error: `${field.name} must be one of: ${field.options.join(', ')}.` }
    }
    case 'MULTI_SELECT': {
      const items = (Array.isArray(raw) ? raw : String(raw).split(',')).map((item) => String(item).trim()).filter(Boolean)
      const chosen: string[] = []
      for (const item of items) {
        const choice = matchOption(field.options, item)
        if (!choice) return { ok: false, error: `“${item}” is not an option for ${field.name}.` }
        if (!chosen.includes(choice)) chosen.push(choice)
      }
      // Stored in the options' own order, so equal selections compare equal.
      chosen.sort((a, b) => field.options.indexOf(a) - field.options.indexOf(b))
      return { ok: true, value: chosen.length ? JSON.stringify(chosen) : null }
    }
    case 'DATE': {
      const text = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        return { ok: false, error: `${field.name} must be a date (YYYY-MM-DD).` }
      }
      return { ok: true, value: text }
    }
    case 'CHECKBOX': {
      const text = String(raw).trim().toLowerCase()
      if (['true', 'yes', '1', 'on'].includes(text) || raw === true) return { ok: true, value: 'true' }
      if (['false', 'no', '0', 'off'].includes(text) || raw === false) return { ok: true, value: null }
      return { ok: false, error: `${field.name} is yes or no.` }
    }
    case 'URL': {
      const text = String(raw).trim()
      return /^https?:\/\/[^\s]+$/i.test(text) ? { ok: true, value: text } : { ok: false, error: `${field.name} must be a link starting with https://.` }
    }
    case 'USER':
      // A user id; the caller checks it is a member of the project.
      return { ok: true, value: String(raw).trim() }
  }
}

/** An option, matched case-insensitively, in its canonical spelling. */
function matchOption(options: string[], raw: string): string | null {
  const wanted = raw.trim().toLowerCase()
  return options.find((option) => option.toLowerCase() === wanted) ?? null
}

/** A stored value as a person reads it. */
export function displayFieldValue(field: FieldDefinition, value: string | null, userName?: (id: string) => string | undefined): string {
  if (value === null) return '—'
  switch (field.type) {
    case 'MULTI_SELECT':
      try {
        return (JSON.parse(value) as string[]).join(', ')
      } catch {
        return value
      }
    case 'CHECKBOX':
      return value === 'true' ? 'Yes' : 'No'
    case 'USER':
      return userName?.(value) ?? 'Unknown person'
    default:
      return value
  }
}

/** Options as a person types them: one per line or comma separated, de-duplicated. */
export function parseOptions(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const option of text.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean)) {
    const key = option.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(option.slice(0, 80))
  }
  return out.slice(0, 50)
}
