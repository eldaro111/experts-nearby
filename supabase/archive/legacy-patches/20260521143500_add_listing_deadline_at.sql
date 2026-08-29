alter table public.listings
add column if not exists deadline_at timestamptz;
