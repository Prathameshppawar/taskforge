import { Bot } from 'lucide-react'

import { UserAvatar } from '@/components/shared/user-avatar'
import type { AgentRoster as Roster } from '../queries'

/** Workspace → AI → Agents: who the agents are, what they did, and how the Coder's pull requests fared. */
export function AgentRoster({ data }: { data: Roster }) {
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Agents are workspace members: they author comments and appear in history and in spend under their own names. None of
        them can sign in.
      </p>
      <ul className="divide-y rounded-xl border">
        {data.roster.map((agent) => (
          <li key={agent.kind} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <UserAvatar name={agent.name} color={agent.avatarColor} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{agent.name}</p>
              <p className="text-xs text-muted-foreground">{agent.jobTitle}</p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {agent.active ? `${agent.actions} actions · ${agent.comments} comments in 30 days` : 'not used yet'}
            </span>
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Bot className="size-4 text-muted-foreground" /> The Coder&rsquo;s pull requests
        </h3>
        {data.outcomes.length === 0 ? (
          <p className="text-xs text-muted-foreground">It has not opened any yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Repository</th>
                <th className="py-1 text-right font-normal">Merged</th>
                <th className="py-1 text-right font-normal">Closed unmerged</th>
                <th className="py-1 text-right font-normal">Open</th>
                <th className="py-1 text-right font-normal">Accepted</th>
              </tr>
            </thead>
            <tbody>
              {data.outcomes.map((row) => (
                <tr key={row.repo} className="border-t">
                  <td className="py-1.5 font-mono">{row.repo}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.merged}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.closed}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.open}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{row.acceptance === null ? '—' : `${row.acceptance}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-muted-foreground">
          Acceptance counts only decided pull requests. Watch it before switching on auto-merge anywhere.
        </p>
      </section>
    </div>
  )
}
