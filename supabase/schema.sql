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
  photo_url text check (photo_url is null or char_length(photo_url) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  with check ((auth.uid() = id and status = 'pending') or auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "Authenticated users can report" on public.reports;
create policy "Authenticated users can report"
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

revoke all on public.categories, public.profiles, public.reports from anon, authenticated;
grant select on public.categories to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant insert on public.reports to authenticated;

drop view if exists public.public_services;
create view public.public_services
  with (security_barrier = true)
as
select
  p.id, p.name, p.category_id, p.locality, p.description,
  case when p.show_phone then p.phone else null end as phone,
  case when p.show_whatsapp then p.whatsapp else null end as whatsapp,
  p.show_phone, p.show_whatsapp, p.website, p.photo_url, p.created_at
from public.profiles p
where p.status = 'approved';

grant select on public.public_services to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-photos', 'service-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Service photos are publicly readable" on storage.objects;
create policy "Service photos are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'service-photos');

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
