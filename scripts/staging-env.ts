import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(path = '.env.staging.local') {
  const absolutePath = resolve(process.cwd(), path)
  if (!existsSync(absolutePath)) return

  for (const rawLine of readFileSync(absolutePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export type StagingConfig = {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string | null
  projectRef: string
  testPassword: string
}

export function getStagingConfig(options?: { requireAnonKey?: boolean }): StagingConfig {
  loadEnvFile()

  const supabaseUrl = requireEnv('SUPABASE_URL')
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const projectRef = requireEnv('SUPABASE_PROJECT_REF')
  const testPassword = requireEnv('SEED_TEST_PASSWORD')
  const seedConfirm = requireEnv('SEED_CONFIRM')
  const allowedRefs = requireEnv('SEED_ALLOWED_REFS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (seedConfirm !== 'yes-staging') {
    throw new Error('Seed guard blocked execution: SEED_CONFIRM must be exactly yes-staging.')
  }

  const hostname = new URL(supabaseUrl).hostname
  const refMatch = /^([a-z0-9]{20})\.supabase\.co$/i.exec(hostname)
  if (!refMatch) {
    throw new Error('SUPABASE_URL must point to a hosted Supabase project (*.supabase.co).')
  }

  const urlProjectRef = refMatch[1].toLowerCase()
  if (projectRef.toLowerCase() !== urlProjectRef) {
    throw new Error('Seed guard blocked execution: SUPABASE_PROJECT_REF does not match SUPABASE_URL.')
  }

  if (!allowedRefs.map((value) => value.toLowerCase()).includes(urlProjectRef)) {
    throw new Error('Seed guard blocked execution: project ref is not present in SEED_ALLOWED_REFS.')
  }

  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || null
  if (options?.requireAnonKey && !anonKey) {
    throw new Error('Missing required environment variable: SUPABASE_ANON_KEY')
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    anonKey,
    projectRef: urlProjectRef,
    testPassword,
  }
}
