import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireUser, requireProjectViewPage, can } from '@/features/auth/guards'
import { currentMonth, getClientReport } from '@/features/client-report/queries'
import { PrintButton } from '@/features/client-report/print-button'
import { decimalHours, formatMinutes } from '@/core/domain/time'

export const metadata: Metadata = { title: 'Monthly report' }
export const dynamic = 'force-dynamic'

/**
 * A project's monthly report, printable to PDF from the browser. Clients see
 * delivery, releases, incidents and uptime; staff who manage AI also see what
 * the AI work cost, which is what an agency bills against.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ project?: string; month?: string }> }) {
  const { project: projectId, month: requested } = await searchParams
  if (!projectId) notFound()
  const actor = await requireUser()
  await requireProjectViewPage(projectId)

  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : currentMonth()
  const report = await getClientReport(projectId, month, can(actor, 'ai:manage'))
  const [y, m] = month.split('-').map(Number)
  const previous = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`

  return (
    <article className="space-y-8 print:text-black">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b pb-4">
        <div>
          <p className="text-xs text-muted-foreground">Monthly report</p>
          <h1 className="text-2xl font-semibold">{report.project.name} · {report.label}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs print:hidden">
          <a href={`/portal/report?project=${projectId}&month=${previous}`} className="text-primary hover:underline">← Previous month</a>
          <PrintButton />
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ['Delivered', String(report.deliveredCount), 'tickets finished'],
          ['Releases', String(report.deployments), 'production deployments'],
          ['Incidents', String(report.incidents.length), 'production issues opened'],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">What was delivered</h2>
        {report.sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing was finished this month.</p>
        ) : (
          report.sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-medium">{section.title}</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {section.items.map((item) => (
                  <li key={item.key}>{item.title} <span className="text-xs text-muted-foreground">({item.key})</span></li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {report.time.total > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Time</h2>
          <p className="text-sm">
            <strong>{decimalHours(report.time.billable)} billable hours</strong>
            {report.time.amount !== null && (
              <>
                {' '}· {new Intl.NumberFormat('en', { style: 'currency', currency: report.time.currency }).format(report.time.amount)} at{' '}
                {new Intl.NumberFormat('en', { style: 'currency', currency: report.time.currency }).format(report.time.rate!)}/h
              </>
            )}
          </p>
          {actor.roleKey !== 'CLIENT' && (
            <div className="rounded-xl border border-dashed p-3 text-sm print:hidden">
              <p className="text-xs text-muted-foreground">Staff only · {formatMinutes(report.time.total - report.time.billable)} not billable</p>
              <ul className="mt-1 space-y-0.5">
                {report.time.people.map((person) => (
                  <li key={person.id} className="flex justify-between gap-2">
                    <span>{person.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatMinutes(person.minutes)}
                      {person.billable !== person.minutes ? ` (${formatMinutes(person.billable)} billable)` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Reliability</h2>
        {report.uptime.length === 0 && report.incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No monitors, and no production issues this month.</p>
        ) : (
          <>
            {report.uptime.length > 0 && (
              <ul className="text-sm">
                {report.uptime.map((monitor) => (
                  <li key={monitor.name}>{monitor.name}: <strong>{monitor.percent ?? '—'}%</strong> uptime <span className="text-xs text-muted-foreground">({monitor.checks} checks)</span></li>
                ))}
              </ul>
            )}
            {report.incidents.length > 0 && (
              <ul className="list-disc pl-5 text-sm">
                {report.incidents.map((incident) => (
                  <li key={incident.key}>
                    {/* Titles filed from error reports can carry customer ids or
                        internal detail, so a client sees the fact, not the text. */}
                    {actor.roleKey === 'CLIENT' ? `Production issue (${incident.key})` : incident.title} —{' '}
                    {incident.hoursToFix === null ? 'still open' : `fixed in ${incident.hoursToFix} h`}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {report.spend && (
        <section className="space-y-1 rounded-xl border border-dashed p-4 print:hidden">
          <h2 className="font-semibold">AI usage <span className="text-xs font-normal text-muted-foreground">· staff only, not shown to clients</span></h2>
          <p className="text-sm">
            <strong>${report.spend.usd.toFixed(2)}</strong> across {report.spend.calls} model calls ({(report.spend.tokens / 1000).toFixed(1)}k tokens).
          </p>
        </section>
      )}
    </article>
  )
}
