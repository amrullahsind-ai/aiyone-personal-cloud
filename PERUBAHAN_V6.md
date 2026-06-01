# Perubahan Aiyone v6

Versi ini menyempurnakan Aiyone agar lebih dekat dengan konsep psikologi pendidikan, bukan sekadar aplikasi rangkum PDF.

## Psychopedagogy Upgrade

1. **Memory Engine v2**
   - Memakai rating review: Lupa, Sulit, Paham, Mudah.
   - Menambahkan confidence 1–5 saat review.
   - Mencatat waktu jawab.
   - Menghitung stability dan memory difficulty.
   - Jadwal review berikutnya memakai target retensi.

2. **Pre-test dan Post-test**
   - Pre-test untuk diagnosis awal sebelum belajar.
   - Post-test untuk mengecek mastery setelah belajar.
   - Quiz latihan tetap tersedia.

3. **Mastery Learning**
   - Threshold mastery bisa diatur di Settings.
   - Default 70%.
   - Smart streak naik hanya jika skor mencapai threshold.

4. **Misconception-aware Learning**
   - Prompt AI diperkuat agar membuat pertanyaan diagnostik dan cek miskonsepsi.
   - Teaching Mode menilai miskonsepsi dan bagian yang belum lengkap.

5. **Adaptive Review**
   - Jika quiz salah, kartu terkait didorong muncul lebih cepat.
   - Analytics menampilkan konsep rawan lupa berdasarkan retensi dan lapses.

## Catatan

- Ini masih MVP, belum validasi akademik formal.
- Memory Engine v2 bersifat FSRS-inspired, bukan implementasi FSRS resmi penuh.
- Supabase schema sudah diperluas dan aman dijalankan ulang.
