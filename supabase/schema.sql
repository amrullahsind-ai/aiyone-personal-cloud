-- Aiyone Personal Cloud Edition schema
-- Jalankan di Supabase SQL Editor.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
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

create policy "materials own rows" on public.materials
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "flashcards own rows" on public.flashcards
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "quizzes own rows" on public.quizzes
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "review_logs own rows" on public.review_logs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "teaching_sessions own rows" on public.teaching_sessions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

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


notify pgrst, 'reload schema';
