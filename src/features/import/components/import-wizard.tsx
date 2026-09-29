'use client'

import * as React from 'react'
import Link from 'next/link'
import type { StatusCategory } from '@prisma/client'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CSV_FIELD_LABELS,
  detectSource,
  distinctValues,
  guessMapping,
  itemsFromCsv,
  itemsFromTrello,
  matchValue,
  parseCsv,
  type CsvField,
  type ImportItem,
  type ImportSource,
} from '@/core/domain/import'
import { importBatchAction, linkImportedParentsAction } from '../actions'

interface Option {
  id: string
  name: string
  category?: StatusCategory
}

interface Member {
  id: string
  name: string
  email: string
  username: string
}

const BATCH = 100
const MAX_ITEMS = 5000
const NONE = '__none__'

/**
 * Import from Jira, Trello or any CSV: pick the file, check what each column
 * means, map the values that do not match by name, and go. Parsing happens
 * here in the browser; the server receives tidy batches.
 */
export function ImportWizard({
  projectId,
  statuses,
  types,
  priorities,
  members,
}: {
  projectId: string
  statuses: Option[]
  types: Option[]
  priorities: Option[]
  members: Member[]
}) {
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null)
  const [source, setSource] = React.useState<ImportSource>('csv')
  const [rows, setRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<CsvField[]>([])
  const [trelloItems, setTrelloItems] = React.useState<ImportItem[]>([])
  const [maps, setMaps] = React.useState<Record<'status' | 'type' | 'priority' | 'person', Record<string, string>>>({ status: {}, type: {}, priority: {}, person: {} })
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = React.useState<{ created: number; skipped: number; linked: number; refused: string[] } | null>(null)

  const items = React.useMemo<ImportItem[]>(() => {
    if (!file) return []
    if (source === 'trello') return trelloItems
    return itemsFromCsv(rows, mapping, source).slice(0, MAX_ITEMS)
  }, [file, source, rows, mapping, trelloItems])

  const distinct = React.useMemo(
    () => ({
      status: distinctValues(items, 'status'),
      type: distinctValues(items, 'type'),
      priority: distinctValues(items, 'priority'),
      person: [...new Map([...distinctValues(items, 'assignee'), ...distinctValues(items, 'reporter')].map((entry) => [entry.value, entry])).values()],
    }),
    [items],
  )

  // Whatever matches by name (or, for statuses, by meaning) is pre-filled; a
  // person only has to decide what does not.
  React.useEffect(() => {
    const pick = <T extends Option>(values: Array<{ value: string }>, ours: T[], byCategory = false) =>
      Object.fromEntries(values.map(({ value }) => [value, matchValue(value, ours, byCategory)?.id ?? '']))
    const people = Object.fromEntries(
      distinct.person.map(({ value }) => {
        const wanted = value.toLowerCase()
        const member = members.find((entry) => entry.email.toLowerCase() === wanted || entry.username.toLowerCase() === wanted || entry.name.toLowerCase() === wanted)
        return [value, member?.id ?? '']
      }),
    )
    setMaps({ status: pick(distinct.status, statuses, true), type: pick(distinct.type, types), priority: pick(distinct.priority, priorities), person: people })
  }, [distinct, statuses, types, priorities, members])

  async function choose(chosen: File) {
    if (chosen.size > 20 * 1024 * 1024) return toast.error('That file is over 20 MB — export fewer tickets at a time.')
    const text = await chosen.text()
    const detected = detectSource(chosen.name, text)
    setSummary(null)
    try {
      if (detected === 'trello') {
        setTrelloItems(itemsFromTrello(text).slice(0, MAX_ITEMS))
        setRows([])
        setMapping([])
      } else {
        const parsed = parseCsv(text)
        if (parsed.length < 2) return toast.error('That file has no rows under its header.')
        setRows(parsed)
        setMapping(guessMapping(parsed[0]))
      }
      setSource(detected)
      setFile({ name: chosen.name, text })
    } catch {
      toast.error('That file could not be read. Export it again as CSV (or Trello JSON).')
    }
  }

  async function run() {
    if (!items.length) return
    setProgress({ done: 0, total: items.length })
    let created = 0
    let skipped = 0
    for (let start = 0; start < items.length; start += BATCH) {
      const batch = items.slice(start, start + BATCH).map((entry) => ({ ...entry, title: entry.title.slice(0, 500) }))
      const result = await importBatchAction({
        projectId,
        source,
        items: batch,
        statusMap: maps.status,
        typeMap: maps.type,
        priorityMap: maps.priority,
        personMap: maps.person,
      })
      if (!result.success) {
        toast.error(`Stopped after ${created} tickets: ${result.error}`)
        setProgress(null)
        return
      }
      created += result.data.created
      skipped += result.data.skipped
      setProgress({ done: Math.min(items.length, start + BATCH), total: items.length })
    }
    const pairs = items.filter((entry) => entry.parentRef).map((entry) => ({ ref: entry.ref, parentRef: entry.parentRef! }))
    const links = pairs.length ? await linkImportedParentsAction({ projectId, source, pairs }) : null
    setSummary({ created, skipped, linked: links?.success ? links.data.linked : 0, refused: links?.success ? links.data.refused : [] })
    setProgress(null)
  }

  const header = rows[0] ?? []
  const unmapped = (['status', 'type', 'priority'] as const).reduce((sum, key) => sum + Object.values(maps[key]).filter((value) => !value).length, 0)

  return (
    <div className="space-y-6">
      <label
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center hover:bg-accent/30',
          progress && 'pointer-events-none opacity-60',
        )}
      >
        <FileUp className="size-6 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{file ? file.name : 'Choose an export'}</span>
        <span className="text-xs text-muted-foreground">
          Jira: <em>Filters → Export → CSV (all fields)</em>. Trello: <em>Menu → Print, export and share → Export as JSON</em>. Or any CSV with a header row.
        </span>
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            // Cleared, so choosing the same file again (a second run) still fires.
            event.target.value = ''
            if (chosen) void choose(chosen)
          }}
        />
      </label>

      {file && (
        <p className="text-sm">
          <strong>{items.length}</strong> tickets found in a {source === 'jira' ? 'Jira export' : source === 'trello' ? 'Trello board' : 'CSV'}.
          {items.length >= MAX_ITEMS && ` Only the first ${MAX_ITEMS} are imported at a time.`}
        </p>
      )}

      {source !== 'trello' && header.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Columns</h2>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Column</th>
                  <th className="px-3 py-2 text-left font-medium">Example</th>
                  <th className="w-48 px-3 py-2 text-left font-medium">Is</th>
                </tr>
              </thead>
              <tbody>
                {header.map((name, column) => (
                  <tr key={column} className="border-t">
                    <td className="px-3 py-1.5">{name}</td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-muted-foreground">{rows.slice(1).find((row) => row[column])?.[column] ?? ''}</td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={mapping[column] ?? 'ignore'}
                        onValueChange={(value) => setMapping((current) => current.map((entry, index) => (index === column ? (value as CsvField) : entry)))}
                      >
                        <SelectTrigger className="h-8" aria-label={`What ${name} is`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(CSV_FIELD_LABELS) as CsvField[]).map((field) => (
                            <SelectItem key={field} value={field}>
                              {CSV_FIELD_LABELS[field]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!mapping.includes('title') && <p className="text-xs text-destructive">Choose which column is the Title.</p>}
        </section>
      )}

      {items.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <ValueMap title="Statuses" values={distinct.status} options={statuses} map={maps.status} onChange={(next) => setMaps((current) => ({ ...current, status: next }))} fallback="The initial status" />
          <ValueMap title="Types" values={distinct.type} options={types} map={maps.type} onChange={(next) => setMaps((current) => ({ ...current, type: next }))} fallback="The default type" />
          <ValueMap title="Priorities" values={distinct.priority} options={priorities} map={maps.priority} onChange={(next) => setMaps((current) => ({ ...current, priority: next }))} fallback="The default priority" />
          <ValueMap
            title="People"
            values={distinct.person}
            options={members.map((member) => ({ id: member.id, name: member.name }))}
            map={maps.person}
            onChange={(next) => setMaps((current) => ({ ...current, person: next }))}
            fallback="Nobody (unassigned)"
            hint="Matched by email, username or name. Only project members can be chosen."
          />
        </section>
      )}

      {items.length > 0 && !summary && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={Boolean(progress) || (source !== 'trello' && !mapping.includes('title'))}>
            {progress && <Loader2 className="size-4 animate-spin" />}
            Import {items.length} tickets
          </Button>
          {unmapped > 0 && <span className="text-xs text-muted-foreground">{unmapped} values will use the project’s defaults.</span>}
          <span className="text-xs text-muted-foreground">Nobody is notified. Running it again skips what was already imported.</span>
        </div>
      )}

      {progress && (
        <div className="space-y-1">
          <Progress value={(progress.done / progress.total) * 100} className="h-2" aria-label="Import progress" />
          <p className="text-xs text-muted-foreground tabular-nums">
            {progress.done} of {progress.total}
          </p>
        </div>
      )}

      {summary && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">
          <p>
            Imported <strong>{summary.created}</strong> tickets
            {summary.skipped ? `, skipped ${summary.skipped} already here` : ''}
            {summary.linked ? `, linked ${summary.linked} to their parents` : ''}.
          </p>
          {summary.refused.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Not linked (TaskForge keeps two levels of hierarchy): {summary.refused.slice(0, 20).join(', ')}
              {summary.refused.length > 20 ? '…' : ''}
            </p>
          )}
          <Link href={`/projects/${projectId}/table`} className="mt-2 inline-block text-primary hover:underline">
            See them in the table →
          </Link>
        </div>
      )}
    </div>
  )
}

function ValueMap({
  title,
  values,
  options,
  map,
  onChange,
  fallback,
  hint,
}: {
  title: string
  values: Array<{ value: string; count: number }>
  options: Option[]
  map: Record<string, string>
  onChange: (next: Record<string, string>) => void
  fallback: string
  hint?: string
}) {
  if (values.length === 0) return null
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <ul className="space-y-1.5">
        {values.slice(0, 40).map(({ value, count }) => (
          <li key={value} className="grid grid-cols-[1fr_12rem] items-center gap-2 text-sm">
            <span className="truncate" title={value}>
              {value} <span className="text-xs text-muted-foreground">×{count}</span>
            </span>
            <Select value={map[value] || NONE} onValueChange={(next) => onChange({ ...map, [value]: next === NONE ? '' : next })}>
              <SelectTrigger className="h-8" aria-label={`${title}: ${value}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{fallback}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>
    </div>
  )
}
