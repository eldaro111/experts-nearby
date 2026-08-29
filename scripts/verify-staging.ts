import { createClient } from '@supabase/supabase-js'

import { FIXTURE_IDS, TEST_USERS } from './staging-fixtures'
import { getStagingConfig } from './staging-env'

const config = getStagingConfig({ requireAnonKey: true })
const anonKeyCandidate = config.anonKey
if (!anonKeyCandidate) throw new Error('SUPABASE_ANON_KEY is required.')
const anonKey: string = anonKeyCandidate

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function authenticatedClient(email: string) {
  const client = createClient(config.supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email,
    password: config.testPassword,
  })
  if (error) throw new Error(`Unable to sign in ${email}: ${error.message}`)
  return client
}

async function assertAdminFixtures() {
  const checks = [
    ['listings', 'id', [FIXTURE_IDS.project], 1],
    ['tasks', 'id', [FIXTURE_IDS.taskTodo, FIXTURE_IDS.taskDone], 2],
    ['project_messages', 'id', [FIXTURE_IDS.messageRoot, FIXTURE_IDS.messageReply], 2],
    ['auctions', 'id', [FIXTURE_IDS.requestAuction, FIXTURE_IDS.offerAuction], 2],
  ] as const

  for (const [table, column, values, expected] of checks) {
    const { data, error } = await admin.from(table).select(column).in(column, [...values])
    if (error) throw new Error(`Admin fixture check failed for ${table}: ${error.message}`)
    const actual = (data ?? []).length
    assert(actual === expected, `${table}: expected ${expected} fixture rows, got ${actual}.`)
  }

  const { data: buckets, error: bucketError } = await admin.storage.listBuckets()
  if (bucketError) throw new Error(`Unable to inspect Storage buckets: ${bucketError.message}`)
  const bucket = (buckets ?? []).find((candidate) => candidate.id === 'project-files')
  assert(bucket, 'Storage bucket project-files is missing.')
  assert(bucket.public === false, 'Storage bucket project-files must be private.')
}

async function assertProjectAccess() {
  const owner = await authenticatedClient(TEST_USERS.find((user) => user.key === 'owner')!.email)
  const expert = await authenticatedClient(TEST_USERS.find((user) => user.key === 'expert')!.email)
  const applicant = await authenticatedClient(
    TEST_USERS.find((user) => user.key === 'applicant')!.email,
  )
  const outsider = await authenticatedClient(TEST_USERS.find((user) => user.key === 'outsider')!.email)

  for (const [label, client] of [
    ['owner', owner],
    ['accepted expert', expert],
  ] as const) {
    const { data, error } = await client
      .from('tasks')
      .select('id')
      .eq('project_id', FIXTURE_IDS.project)
    if (error) throw new Error(`${label} task read failed: ${error.message}`)
    assert((data ?? []).length >= 2, `${label} should see project tasks.`)
  }

  const outsiderPrivateChecks = [
    outsider.from('tasks').select('id').eq('project_id', FIXTURE_IDS.project),
    outsider.from('project_messages').select('id').eq('project_id', FIXTURE_IDS.project),
    outsider.from('project_documents').select('id').eq('project_id', FIXTURE_IDS.project),
    outsider.from('contributions').select('id').eq('project_id', FIXTURE_IDS.project),
  ]

  for (const query of outsiderPrivateChecks) {
    const { data, error } = await query
    if (error) throw new Error(`Outsider RLS check returned an API error: ${error.message}`)
    assert((data ?? []).length === 0, 'Outsider unexpectedly received private project data.')
  }

  const outsiderProtected = await outsider
    .from('auction_protected')
    .select('auction_id')
    .eq('auction_id', FIXTURE_IDS.offerAuction)
  if (outsiderProtected.error) {
    throw new Error(`Outsider protected-auction check failed: ${outsiderProtected.error.message}`)
  }
  assert((outsiderProtected.data ?? []).length === 0, 'Outsider unexpectedly received protected offer data.')

  const applicantProtected = await applicant
    .from('auction_protected')
    .select('auction_id')
    .eq('auction_id', FIXTURE_IDS.offerAuction)
  if (applicantProtected.error) {
    throw new Error(`Approved-access check failed: ${applicantProtected.error.message}`)
  }
  assert((applicantProtected.data ?? []).length === 1, 'Approved requester cannot read protected offer data.')

  const publicAuctionCheck = await outsider
    .from('auctions')
    .select('id')
    .in('id', [FIXTURE_IDS.requestAuction, FIXTURE_IDS.offerAuction])
  if (publicAuctionCheck.error) {
    throw new Error(`Public auction check failed: ${publicAuctionCheck.error.message}`)
  }
  assert((publicAuctionCheck.data ?? []).length === 2, 'Open auctions are not visible to a regular user.')
}

async function main() {
  console.log(`Verifying staging project: ${config.projectRef}`)
  await assertAdminFixtures()
  await assertProjectAccess()
  console.log('Staging verification passed: fixtures, Storage and core RLS smoke checks are healthy.')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Staging verification failed: ${message}`)
  process.exitCode = 1
})
