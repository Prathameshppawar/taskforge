import { PROJECT_DETAIL_LABELS, type DetailChange, type ProjectDetailField } from '@/core/domain/project-documents'
import { cn } from '@/lib/utils'

/**
 * The project details a proposal would change, each field with its current and
 * proposed value stacked, so it reads at phone width. Server-compatible.
 */
export function DetailsDiff({ changes, staleFields = [] }: { changes: DetailChange[]; staleFields?: string[] }) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No differences from the current details.</p>
  }

  return (
    <ul className="space-y-3">
      {changes.map((change) => (
        <li key={change.field} className="min-w-0 space-y-2 rounded-lg border p-3">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium">{PROJECT_DETAIL_LABELS[change.field]}</p>
            {staleFields.includes(change.field) && (
              <p className="text-xs text-amber-700 dark:text-amber-400">Changed since this was proposed</p>
            )}
          </div>
          <ValueBox label="Now" tone="bg-red-500/10" value={change.from} field={change.field} />
          <ValueBox label="Proposed" tone="bg-emerald-500/10" value={change.to} field={change.field} />
        </li>
      ))}
    </ul>
  )
}

function ValueBox({
  label,
  tone,
  value,
  field,
}: {
  label: string
  tone: string
  value: string | null
  field: ProjectDetailField
}) {
  return (
    <div className={cn('min-w-0 rounded-md px-3 py-2', tone)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      {value ? (
        <p className={cn('min-w-0 break-words text-sm', field === 'description' && 'whitespace-pre-wrap')}>{value}</p>
      ) : (
        <p className="text-sm italic text-muted-foreground">not set</p>
      )}
    </div>
  )
}
