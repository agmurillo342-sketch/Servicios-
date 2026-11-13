create extension if not exists pgcrypto;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.categories (name) values
  ('Alimentos'), ('Arte y diseño'), ('Belleza y bienestar'), ('Hogar y mantenimiento'),
  ('Clases y asesorías'), ('Mascotas'), ('Salud'), ('Otros')
on conflict (name) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  category_id uuid not null references public.categories (id),
  locality text not null check (char_length(locality) between 2 and 80),
  description text not null check (char_length(description) between 20 and 600),
  phone text check (phone is null or char_length(phone) <= 25),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 25),
  show_phone boolean not null default false,
  show_whatsapp boolean not null default false,
  website text check (website is null or (char_length(website) <= 200 and website ~ '^https?://')),
  photo_path text check (photo_path is null or char_length(photo_path) <= 500),
  photo_url text check (photo_url is null or char_length(photo_url) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists photo_path text;

do $migration$
declare
  invalid_photo_count integer;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'photo_url'
  ) then
    select count(*) into invalid_photo_count
    from public.profiles p
    cross join lateral (
      select (regexp_match(
        p.photo_url,
        '^https://gbxcjdygnyydgvdtdsma\.supabase\.co/storage/v1/object/public/service-photos/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp))$'
      ))[1] as path
    ) photo
    where p.photo_url is not null
      and p.photo_path is null
      and (
        photo.path is null
        or split_part(photo.path, '/', 1) is distinct from p.id::text
        or not exists (
          select 1
          from storage.objects o
          where o.bucket_id = 'service-photos'
            and o.name = photo.path
        )
      );

    if invalid_photo_count > 0 then
      raise exception
        'Cannot migrate % profile photo URL(s); verify each URL and matching Storage object before rerunning this schema.',
        invalid_photo_count;
    end if;

    update public.profiles p
    set photo_path = (regexp_match(
      p.photo_url,
      '^https://gbxcjdygnyydgvdtdsma\.supabase\.co/storage/v1/object/public/service-photos/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp))$'
    ))[1]
    where p.photo_url is not null
      and p.photo_path is null;
  end if;
end
$migration$;

create or replace function public.sync_legacy_profile_photo_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  legacy_photo_path text[];
begin
  if new.photo_path is null and new.photo_url is not null then
    legacy_photo_path := regexp_match(
      new.photo_url,
      '^https://gbxcjdygnyydgvdtdsma\.supabase\.co/storage/v1/object/public/service-photos/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp))$'
    );
    if split_part(legacy_photo_path[1], '/', 1) = new.id::text then
      new.photo_path := legacy_photo_path[1];
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_legacy_profile_photo_path() from public, anon, authenticated;
drop trigger if exists sync_legacy_profile_photo_path on public.profiles;
create trigger sync_legacy_profile_photo_path
  before insert or update on public.profiles
  for each row
  execute function public.sync_legacy_profile_photo_path();

create index if not exists profiles_status_recent_idx on public.profiles (status, created_at desc);
create index if not exists profiles_category_idx on public.profiles (category_id);
create index if not exists profiles_locality_idx on public.profiles (lower(locality));

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 500),
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.profiles enable row level security;
alter table public.reports enable row level security;

drop policy if exists "Categories are readable by everyone" on public.categories;
create policy "Categories are readable by everyone"
  on public.categories for select to anon, authenticated using (active or auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "Owners and admins can read profiles" on public.profiles;
create policy "Owners and admins can read profiles"
  on public.profiles for select to authenticated
  using (auth.uid() = id or auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "Owners create pending profiles" on public.profiles;
create policy "Owners create pending profiles"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id and status = 'pending');

drop policy if exists "Owners update own profile" on public.profiles;
create policy "Owners update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id or auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  with check (
    (auth.uid() = id and status in ('pending', 'approved'))
    or auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

create or replace function public.prevent_profile_self_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if old.status is distinct from new.status then
      if auth.uid() = old.id or auth.uid() = new.id then
        raise exception 'Profile owners cannot change their own status.'
          using errcode = '42501';
      elsif not coalesce(
        auth.jwt() -> 'app_metadata' ->> 'role' = 'admin',
        false
      ) then
        raise exception 'Only administrators can change profile status.'
          using errcode = '42501';
      end if;
    end if;

    if old.status = 'approved'
      and (auth.uid() = old.id or auth.uid() = new.id)
      and row(
        new.id,
        new.name,
        new.category_id,
        new.locality,
        new.description,
        new.phone,
        new.whatsapp,
        new.show_phone,
        new.show_whatsapp,
        new.website,
        new.photo_path,
        new.photo_url,
        new.created_at
      ) is distinct from row(
        old.id,
        old.name,
        old.category_id,
        old.locality,
        old.description,
        old.phone,
        old.whatsapp,
        old.show_phone,
        old.show_whatsapp,
        old.website,
        old.photo_path,
        old.photo_url,
        old.created_at
      ) then
      new.status := 'pending';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_profile_self_approval() from public, anon, authenticated;
drop trigger if exists prevent_profile_self_approval on public.profiles;
drop trigger if exists zz_prevent_profile_self_approval on public.profiles;
create trigger zz_prevent_profile_self_approval
  before update on public.profiles
  for each row
  execute function public.prevent_profile_self_approval();

drop policy if exists "Authenticated users can report" on public.reports;
create policy "Authenticated users can report"
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

revoke all on public.categories, public.profiles, public.reports from anon, authenticated;
grant select on public.categories to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant insert on public.reports to authenticated;

create or replace view public.public_services
  with (security_barrier = true)
as
select
  p.id, p.name, p.category_id, p.locality, p.description,
  case when p.show_phone then p.phone else null end as phone,
  case when p.show_whatsapp then p.whatsapp else null end as whatsapp,
  p.show_phone, p.show_whatsapp, p.website, null::text as photo_url,
  p.created_at, p.photo_path
from public.profiles p
where p.status = 'approved';

grant select on public.public_services to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-photos', 'service-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Service photos are publicly readable" on storage.objects;
drop policy if exists "Restrict service photo reads to owner" on storage.objects;
create policy "Restrict service photo reads to owner"
  on storage.objects as restrictive for select to anon, authenticated
  using (
    bucket_id <> 'service-photos'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  );

drop policy if exists "Users can read own service photos" on storage.objects;
create policy "Users can read own service photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'service-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload photos to their own folder" on storage.objects;
create policy "Users upload photos to their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'service-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update photos in their own folder" on storage.objects;
create policy "Users update photos in their own folder"
  on storage.objects for update to authenticated
  using (bucket_id = 'service-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'service-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete photos in their own folder" on storage.objects;
create policy "Users delete photos in their own folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'service-photos' and (storage.foldername(name))[1] = auth.uid()::text);
