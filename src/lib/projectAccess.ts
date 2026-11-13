// Access check for a destination after sign-in. Kept apart from authReturn.ts, which has no
// Supabase dependency and is unit-tested without a client.
import { supabase } from '@/lib/supabaseClient'

/**
 * A saved link may point to a project workspace the person cannot open (another account, removed from
 * the team). Such a destination becomes the public project page; a missing project — the work centre.
 * Rights are still enforced by RLS on every page; this only avoids landing on an access error.
 */
export async function resolveAccessibleDestination(path: string, userId: string): Promise<string> {
  const match = /^\/projects\/([^/?#]+)/.exec(path)
  if (!match) return path
  let projectId: string
  try {
    projectId = decodeURIComponent(match[1])
  } catch {
    return '/dashboard'
  }
  const { data: listing, error } = await supabase
    .from('listings')
    .select('id, created_by')
    .eq('id', projectId)
    .maybeSingle()
  // On a loading error the project page shows its own state; nothing is guessed here.
  if (error) return path
  if (!listing) return '/dashboard'
  if ((listing as { created_by?: string }).created_by === userId) return path
  const { data: membership, error: membershipError } = await supabase
    .from('applications')
    .select('id')
    .eq('listing_id', projectId)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .limit(1)
  if (membershipError) return path
  return Array.isArray(membership) && membership.length > 0 ? path : `/listings/${encodeURIComponent(projectId)}`
}
