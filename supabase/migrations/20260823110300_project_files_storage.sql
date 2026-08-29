-- TZ-05: project-files bucket and current secure Storage policies.
-- The storage schema itself is Supabase-managed; this migration adds only app-owned configuration.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, null, null)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Uploaders and project owners can delete storage files" on storage.objects;
create policy "Uploaders and project owners can delete storage files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and public.can_delete_project_file_object(name, owner_id));

drop policy if exists "Reserved project files can be uploaded" on storage.objects;
create policy "Reserved project files can be uploaded"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.has_valid_project_file_upload_reservation(name));

drop policy if exists "Project members can read registered storage files" on storage.objects;
create policy "Project members can read registered storage files"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and public.can_read_project_file_object(name, owner_id));
