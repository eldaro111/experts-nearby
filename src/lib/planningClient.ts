// Browser transport of the planning client (src/lib/planning.ts): Supabase PostgREST with the signed-in
// user's session. Named RPC arguments are passed unchanged; nothing here adds rights or retries.
import { supabase } from '@/lib/supabaseClient'
import type { DbResult, PlanningDb, PlanningRpc, PlanningTable, SelectQuery } from '@/lib/planning'

// The generated-types builder is too strict for column lists chosen at run time; the subset used here is
// the documented PostgREST filter API, and every answer is parsed by planning.ts before use.
type Builder = {
  eq(column: string, value: string): Builder
  in(column: string, values: string[]): Builder
  is(column: string, value: null): Builder
  order(column: string, options: { ascending: boolean }): Builder
  limit(count: number): Builder
  abortSignal(signal: AbortSignal): PromiseLike<DbResult>
}

export const planningDb: PlanningDb = {
  async rpc(fn: PlanningRpc, args: Record<string, unknown>, signal: AbortSignal): Promise<DbResult> {
    const { data, error } = await supabase.rpc(fn, args).abortSignal(signal)
    return { data, error }
  },
  async select(table: PlanningTable, query: SelectQuery, signal: AbortSignal): Promise<DbResult> {
    let request = supabase.from(table).select(query.columns) as unknown as Builder
    for (const [column, value] of Object.entries(query.eq ?? {})) request = request.eq(column, value)
    if (query.in) request = request.in(query.in.column, query.in.values)
    for (const column of query.isNull ?? []) request = request.is(column, null)
    for (const order of query.order ?? []) request = request.order(order.column, { ascending: order.ascending })
    if (query.limit) request = request.limit(query.limit)
    const { data, error } = await request.abortSignal(signal)
    return { data, error }
  },
}
