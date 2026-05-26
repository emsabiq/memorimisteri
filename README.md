# Mistis Story Video Studio

Studio lokal untuk membuat konten cerita mistis vertikal. Fase awal ini belum mengaktifkan automation upload. Fokusnya adalah membuat alur yang bisa diperiksa satu per satu:

1. Membuat naskah cerita mistis.
2. Membagi cerita menjadi scene.
3. Menghitung estimasi token/biaya sebelum API berbayar.
4. Membuat prompt gambar berkualitas untuk tiap scene.
5. Membuat TTS dan efek suara seram jika API key tersedia.
6. Merender video draft lokal dengan FFmpeg.

## Menjalankan

```bash
npm install
copy .env.example .env
npm run dev
```

Dashboard lokal:

```txt
http://localhost:3035
```

Tanpa `OPENAI_API_KEY`, app tetap berjalan dalam mode draft offline. Story dibuat dari template lokal, image/TTS tidak otomatis dipanggil.

## Struktur

```txt
src/
  config.js        konfigurasi dan safety default
  cost.js          estimasi token dan biaya
  openai.js        pemanggilan API opsional
  render.js        renderer FFmpeg lokal
  story-engine.js  generator cerita dan scene
  storage.js       penyimpanan JSON lokal
  server.js        dashboard API
public/
  index.html
  styles.css
  app.js
generated/
  images/
  audio/
  videos/
  storyboards/
```

## Catatan Produksi

Publishing YouTube, Facebook, dan Instagram masih disiapkan sebagai status nonaktif. Nanti upload bisa ditambahkan setelah alur story, visual, audio, dan render sudah stabil.
