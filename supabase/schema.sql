-- Aiyone Personal Cloud Edition schema
-- Jalankan di Supabase SQL Editor.

-- search_path dikunci: tanpa ini, resolusi nama di dalam fungsi mengikuti
-- search_path pemanggil, sehingga objek bernama sama di schema lain bisa
-- didahulukan. Nama dikualifikasi penuh agar aman dengan search_path kosong.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create table if not exists public.materials (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text default 'Umum',
  source_text text,
  summary_short text,
  summary_long text,
  key_takeaways jsonb default '[]'::jsonb,
  concepts jsonb default '[]'::jsonb,
  mastery_score numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.flashcards (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id text not null references public.materials(id) on delete cascade,
  concept text,
  front text not null,
  back text not null,
  difficulty text default 'medium',
  ease numeric default 2.5,
  interval_days numeric default 1,
  repetitions integer default 0,
  lapses integer default 0,
  due_at timestamptz default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.quizzes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id text not null references public.materials(id) on delete cascade,
  concept text,
  level text default 'understanding',
  question text not null,
  options jsonb default '[]'::jsonb,
  answer_index integer default 0,
  explanation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.review_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text references public.flashcards(id) on delete cascade,
  material_id text references public.materials(id) on delete cascade,
  rating text,
  correct boolean default false,
  previous_due_at timestamptz,
  next_due_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.teaching_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id text references public.materials(id) on delete cascade,
  answer_text text,
  result jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

drop trigger if exists materials_updated_at on public.materials;
drop trigger if exists flashcards_updated_at on public.flashcards;
drop trigger if exists quizzes_updated_at on public.quizzes;

create trigger materials_updated_at before update on public.materials
for each row execute function public.set_updated_at();
create trigger flashcards_updated_at before update on public.flashcards
for each row execute function public.set_updated_at();
create trigger quizzes_updated_at before update on public.quizzes
for each row execute function public.set_updated_at();

alter table public.materials enable row level security;
alter table public.flashcards enable row level security;
alter table public.quizzes enable row level security;
alter table public.review_logs enable row level security;
alter table public.teaching_sessions enable row level security;

-- Hapus policy lama jika kamu re-run file ini.
drop policy if exists "materials own rows" on public.materials;
drop policy if exists "flashcards own rows" on public.flashcards;
drop policy if exists "quizzes own rows" on public.quizzes;
drop policy if exists "review_logs own rows" on public.review_logs;
drop policy if exists "teaching_sessions own rows" on public.teaching_sessions;

-- auth.uid() dibungkus (select ...) supaya dievaluasi sekali per query, bukan
-- sekali per baris. Tanpa itu planner tidak memanfaatkan index di bawah.
create policy "materials own rows" on public.materials
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "flashcards own rows" on public.flashcards
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "quizzes own rows" on public.quizzes
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "review_logs own rows" on public.review_logs
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "teaching_sessions own rows" on public.teaching_sessions
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- v3: ringkasan belajar bertahap. Aman dirun ulang.
alter table public.materials
add column if not exists study_sections jsonb default '[]'::jsonb;

-- v6: psychopedagogy memory engine fields. Aman dirun ulang.
alter table public.flashcards
add column if not exists stability numeric default 1,
add column if not exists memory_difficulty numeric default 5,
add column if not exists last_confidence numeric,
add column if not exists last_response_seconds numeric;

alter table public.review_logs
add column if not exists response_seconds numeric,
add column if not exists confidence numeric,
add column if not exists retention_before numeric,
add column if not exists score numeric,
add column if not exists quiz_mode text;


-- v12: index. Aman dirun ulang. Tidak ada kolom baru di v12.
-- Tanpa index, setiap query dan setiap pemeriksaan Row Level Security memindai
-- seluruh tabel. Postgres juga tidak mengindeks kolom foreign key secara
-- otomatis, padahal penghapusan materi mengandalkan ON DELETE CASCADE.
create index if not exists materials_user_created_idx
  on public.materials (user_id, created_at desc, id);
create index if not exists flashcards_user_created_idx
  on public.flashcards (user_id, created_at desc, id);
create index if not exists quizzes_user_created_idx
  on public.quizzes (user_id, created_at desc, id);
create index if not exists review_logs_user_created_idx
  on public.review_logs (user_id, created_at desc, id);
create index if not exists teaching_sessions_user_created_idx
  on public.teaching_sessions (user_id, created_at desc, id);

create index if not exists flashcards_material_idx on public.flashcards (material_id);
create index if not exists quizzes_material_idx on public.quizzes (material_id);
create index if not exists review_logs_material_idx on public.review_logs (material_id);
create index if not exists review_logs_card_idx on public.review_logs (card_id);
create index if not exists teaching_sessions_material_idx on public.teaching_sessions (material_id);


-- v13: Zettelkasten (notes, note_links) dan Pomodoro (focus_sessions).

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
