-- ===========================================================================
-- Aiyone v13 — Zettelkasten dan Pomodoro
--
-- Menambah tiga tabel: notes, note_links, focus_sessions.
-- Aman dijalankan berulang. Tidak menyentuh tabel yang sudah ada.
--
-- Prasyarat: migrasi-v12.sql sudah dijalankan (fungsi set_updated_at yang
-- search_path-nya sudah dikunci dipakai ulang oleh trigger di sini).
-- ===========================================================================

-- Catatan atomik. Satu catatan = satu gagasan.
--
-- material_id sengaja ON DELETE SET NULL, bukan CASCADE: materi adalah sumber
-- yang bisa dibuang, sedangkan catatan adalah pemikiranmu sendiri dan harus
-- bertahan walaupun materi asalnya dihapus. Ini prinsip inti Zettelkasten.
create table if not exists public.notes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text default '',
  tags jsonb default '[]'::jsonb,
  material_id text references public.materials(id) on delete set null,
  concept_name text,
  source_ref text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tautan antar catatan.
--
-- Kolom `reason` yang membuat fitur ini bernilai belajar, bukan sekadar graph:
-- pengguna menuliskan KENAPA dua gagasan terhubung. Itu elaborative encoding,
-- prinsip yang sama yang sudah dipakai Teaching Mode.
create table if not exists public.note_links (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_note_id text not null references public.notes(id) on delete cascade,
  to_note_id text not null references public.notes(id) on delete cascade,
  relation text default 'terkait',
  reason text,
  created_at timestamptz default now(),
  constraint note_links_no_self check (from_note_id <> to_note_id),
  constraint note_links_unique_pair unique (from_note_id, to_note_id)
);

-- Sesi fokus Pomodoro.
--
-- material_id dicatat supaya waktu fokus terkait ke apa yang dipelajari,
-- sehingga grafik "Waktu belajar" memakai menit sungguhan, bukan perkiraan
-- kasar dari waktu jawab review seperti versi sebelumnya.
create table if not exists public.focus_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id text references public.materials(id) on delete set null,
  note_id text references public.notes(id) on delete set null,
  mode text default 'focus',
  planned_minutes numeric default 25,
  actual_seconds numeric default 0,
  completed boolean default false,
  started_at timestamptz default now(),
  ended_at timestamptz,
  created_at timestamptz default now()
);

drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at before update on public.notes
for each row execute function public.set_updated_at();

alter table public.notes enable row level security;
alter table public.note_links enable row level security;
alter table public.focus_sessions enable row level security;

drop policy if exists "notes own rows" on public.notes;
create policy "notes own rows" on public.notes
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "note_links own rows" on public.note_links;
create policy "note_links own rows" on public.note_links
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "focus_sessions own rows" on public.focus_sessions;
create policy "focus_sessions own rows" on public.focus_sessions
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists notes_user_created_idx
  on public.notes (user_id, created_at desc, id);
create index if not exists note_links_user_created_idx
  on public.note_links (user_id, created_at desc, id);
create index if not exists focus_sessions_user_created_idx
  on public.focus_sessions (user_id, created_at desc, id);

create index if not exists notes_material_idx on public.notes (material_id);
create index if not exists note_links_from_idx on public.note_links (from_note_id);
create index if not exists note_links_to_idx on public.note_links (to_note_id);
create index if not exists focus_sessions_material_idx on public.focus_sessions (material_id);
create index if not exists focus_sessions_note_idx on public.focus_sessions (note_id);

notify pgrst, 'reload schema';
