-- ===========================================================================
-- Aiyone v12 — index database
--
-- TIDAK ADA kolom baru di v12. Semua kolom yang ditulis aplikasi sudah ada
-- sejak migrasi v6. File ini murni menambahkan index.
--
-- Kenapa perlu:
--   1. Setiap query memfilter `user_id`, dan setiap kebijakan Row Level
--      Security mengevaluasi `auth.uid() = user_id`. Tanpa index, Postgres
--      memindai seluruh tabel untuk setiap permintaan.
--   2. v12 memuat data dengan pagination: `.eq(user_id).order(created_at desc)
--      .order(id).range(...)`. Tanpa index gabungan, setiap halaman memaksa
--      pemindaian dan pengurutan ulang seluruh tabel.
--   3. Postgres TIDAK membuat index otomatis untuk kolom foreign key. Karena
--      v12 mengandalkan ON DELETE CASCADE saat menghapus materi, tanpa index
--      ini setiap penghapusan memindai keempat tabel anak.
--
-- `review_logs` yang paling terasa: satu baris ditulis untuk SETIAP jawaban
-- quiz, jadi tabel ini tumbuh paling cepat.
--
-- Aman dijalankan berulang kali. Tidak menghapus atau mengubah data apa pun.
-- ===========================================================================

-- Pola query utama aplikasi: filter user_id, urut created_at desc lalu id.
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

-- Kolom foreign key, dipakai saat ON DELETE CASCADE menghapus baris anak.
create index if not exists flashcards_material_idx
  on public.flashcards (material_id);

create index if not exists quizzes_material_idx
  on public.quizzes (material_id);

create index if not exists review_logs_material_idx
  on public.review_logs (material_id);

create index if not exists review_logs_card_idx
  on public.review_logs (card_id);

create index if not exists teaching_sessions_material_idx
  on public.teaching_sessions (material_id);

-- ---------------------------------------------------------------------------
-- Bagian 2: pengerasan yang ditemukan oleh Supabase advisor.
-- Ditemukan dan diterapkan saat migrasi ini dijalankan ke database sungguhan.
-- ---------------------------------------------------------------------------

-- search_path fungsi trigger dikunci. Tanpa ini, resolusi nama di dalam fungsi
-- mengikuti search_path pemanggil, sehingga objek bernama sama di schema lain
-- bisa didahulukan. Advisor: function_search_path_mutable.
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

-- auth.uid() dibungkus (select ...) supaya Postgres mengevaluasinya SEKALI per
-- query, bukan sekali per baris. Ini yang membuat index di atas benar-benar
-- terpakai. Semantik kebijakan tidak berubah: tetap hanya baris milik sendiri.
-- Advisor: auth_rls_initplan.
drop policy if exists "materials own rows" on public.materials;
create policy "materials own rows" on public.materials
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "flashcards own rows" on public.flashcards;
create policy "flashcards own rows" on public.flashcards
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "quizzes own rows" on public.quizzes;
create policy "quizzes own rows" on public.quizzes
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "review_logs own rows" on public.review_logs;
create policy "review_logs own rows" on public.review_logs
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "teaching_sessions own rows" on public.teaching_sessions;
create policy "teaching_sessions own rows" on public.teaching_sessions
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Beri tahu PostgREST supaya cache skemanya dimuat ulang.
notify pgrst, 'reload schema';

-- ===========================================================================
-- Verifikasi. Jalankan terpisah setelah SQL di atas selesai.
--
-- Hasil yang benar, satu baris: 10 | 5 | 4 | 1
--   index_v12               = 10  index dari file ini
--   kolom_review_logs_v6    = 5   response_seconds, confidence,
--                                 retention_before, score, quiz_mode
--   kolom_flashcards_v6     = 4   stability, memory_difficulty,
--                                 last_confidence, last_response_seconds
--   kolom_study_sections    = 1   materials.study_sections
--
-- Kalau angka v6 kurang, jalankan juga SQL di MIGRASI_SUPABASE_AMAN.md.
-- Perhitungan mastery per konsep bergantung pada score dan quiz_mode.
-- ===========================================================================
-- select
--   (select count(*) from pg_indexes
--      where schemaname = 'public'
--        and indexname like any (array['%_user_created_idx', '%_material_idx', '%_card_idx'])
--   ) as index_v12,
--   (select count(*) from information_schema.columns
--      where table_schema = 'public' and table_name = 'review_logs'
--        and column_name in ('response_seconds', 'confidence', 'retention_before', 'score', 'quiz_mode')
--   ) as kolom_review_logs_v6,
--   (select count(*) from information_schema.columns
--      where table_schema = 'public' and table_name = 'flashcards'
--        and column_name in ('stability', 'memory_difficulty', 'last_confidence', 'last_response_seconds')
--   ) as kolom_flashcards_v6,
--   (select count(*) from information_schema.columns
--      where table_schema = 'public' and table_name = 'materials'
--        and column_name = 'study_sections'
--   ) as kolom_study_sections;
