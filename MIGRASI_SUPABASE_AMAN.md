# Migrasi Supabase Aman untuk Aiyone v7

Kalau kamu sudah punya database lama, JANGAN hapus tabel. Jalankan SQL pendek ini di Supabase SQL Editor:

```sql
alter table public.materials
add column if not exists study_sections jsonb default '[]'::jsonb;

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
```

Ini tidak menghapus data lama.
