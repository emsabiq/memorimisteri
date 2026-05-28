<?php
declare(strict_types=1);

$maxUploadMb = 50;
$minTextChars = 250;
$allowed = ['mp3','wav','m4a','aac','ogg','opus','webm','mp4','txt','md','docx'];
$root = __DIR__;
$uploadDir = $root . DIRECTORY_SEPARATOR . 'submissions';
$stateDir = $root . DIRECTORY_SEPARATOR . 'state';
$stateFile = $stateDir . DIRECTORY_SEPARATOR . 'submissions.json';
$message = '';
$error = '';
$isPosted = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        if (($_POST['consent'] ?? '') !== 'yes') {
            throw new RuntimeException('Centang persetujuan dulu supaya cerita bisa direview.');
        }
        if (!isset($_FILES['storyFile']) || $_FILES['storyFile']['error'] !== UPLOAD_ERR_OK) {
            throw new RuntimeException('File cerita wajib diunggah.');
        }
        if ($_FILES['storyFile']['size'] > $maxUploadMb * 1024 * 1024) {
            throw new RuntimeException('Ukuran file maksimal ' . $maxUploadMb . ' MB.');
        }

        $original = basename((string) $_FILES['storyFile']['name']);
        $ext = strtolower(pathinfo($original, PATHINFO_EXTENSION));
        if (!in_array($ext, $allowed, true)) {
            throw new RuntimeException('File harus rekaman audio/video pendek, .txt, .md, atau .docx.');
        }

        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        if (!is_dir($stateDir)) mkdir($stateDir, 0755, true);

        $id = 'fan_' . bin2hex(random_bytes(6));
        $safeName = preg_replace('/[^a-zA-Z0-9._-]+/', '-', pathinfo($original, PATHINFO_FILENAME));
        $filename = time() . '-' . $id . '-' . trim($safeName, '-') . '.' . $ext;
        $target = $uploadDir . DIRECTORY_SEPARATOR . $filename;
        if (!move_uploaded_file($_FILES['storyFile']['tmp_name'], $target)) {
            throw new RuntimeException('Upload gagal disimpan.');
        }

        $manualText = normalize_text((string) ($_POST['storyText'] ?? ''));
        $fileText = in_array($ext, ['txt', 'md'], true) ? normalize_text((string) file_get_contents($target)) : '';
        $text = normalize_text(trim($manualText . "\n\n" . $fileText));
        if (in_array($ext, ['txt', 'md'], true) && mb_strlen($text) < $minTextChars) {
            @unlink($target);
            throw new RuntimeException('Teks cerita minimal ' . $minTextChars . ' karakter.');
        }
        if ($ext === 'docx' && $text !== '' && mb_strlen($text) < $minTextChars) {
            @unlink($target);
            throw new RuntimeException('Kalau menulis teks tambahan untuk Word, minimal ' . $minTextChars . ' karakter.');
        }

        $items = read_json_array($stateFile);
        $items[] = [
            'id' => $id,
            'status' => $text !== '' ? 'ready_for_review' : 'waiting_transcribe',
            'fanName' => normalize_text((string) ($_POST['fanName'] ?? 'Anonim')),
            'contact' => normalize_text((string) ($_POST['contact'] ?? '')),
            'title' => normalize_text((string) ($_POST['title'] ?? pathinfo($original, PATHINFO_FILENAME))),
            'note' => normalize_text((string) ($_POST['note'] ?? '')),
            'originalFilename' => $original,
            'file' => [
                'path' => '',
                'url' => '/submissions/' . $filename,
                'ext' => '.' . $ext,
                'size' => (int) $_FILES['storyFile']['size'],
                'durationSec' => 0
            ],
            'text' => $text,
            'transcript' => '',
            'storyId' => '',
            'createdAt' => gmdate('c'),
            'updatedAt' => gmdate('c')
        ];
        file_put_contents($stateFile, json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n", LOCK_EX);
        $message = 'Cerita sudah masuk antrian review. Terima kasih.';
        $isPosted = true;
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

function normalize_text(string $value): string {
    return trim(preg_replace('/\s+/u', ' ', $value) ?? '');
}

function read_json_array(string $file): array {
    if (!is_file($file)) return [];
    $data = json_decode((string) file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kirim Cerita - Memori Misteri</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body class="fan-page">
    <main class="fan-shell">
      <section class="fan-hero fan-hero-immersive">
        <div class="fan-hero-copy">
          <p class="eyebrow">Memori Misteri</p>
          <h1>Kirim cerita serammu</h1>
          <p>Rekaman atau teks masuk ke antrian dashboard dulu. Setelah disetujui, ceritamu bisa diolah menjadi episode serial Memori Misteri.</p>
        </div>
        <div class="fan-steps" aria-label="Alur kiriman">
          <span>1. Kirim</span>
          <span>2. Review</span>
          <span>3. Transcribe</span>
          <span>4. Jadi episode</span>
        </div>
      </section>
      <?php if ($message): ?><div class="panel fan-alert success"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
      <?php if ($error): ?><div class="panel fan-alert error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
      <?php if (!$isPosted): ?>
        <section class="fan-grid">
          <form id="fanForm" class="panel fan-form fan-form-featured" method="post" enctype="multipart/form-data">
            <div class="fan-form-head">
              <strong>Form kiriman</strong>
              <span>Audio minimal ±20 detik, teks minimal 250 karakter.</span>
            </div>
            <div class="field-grid">
              <label>
                <span>Nama panggilan</span>
                <input name="fanName" maxlength="80" placeholder="Boleh anonim">
              </label>
              <label>
                <span>Kontak opsional</span>
                <input name="contact" maxlength="120" placeholder="@instagram / email">
              </label>
            </div>
            <label>
              <span>Judul cerita</span>
              <input name="title" maxlength="120" placeholder="Contoh: Suara dari kamar kosong" required>
            </label>
            <label>
              <span>File rekaman / teks</span>
              <input name="storyFile" type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.opus,.webm,.mp4,.txt,.md,.docx" required>
            </label>
            <label>
              <span>Teks tambahan</span>
              <textarea name="storyText" rows="8" placeholder="Tulis kronologi singkat, nama samaran, lokasi umum, dan bagian paling seram. Kalau upload .docx, teks akan dibaca di dashboard saat review."></textarea>
            </label>
            <label>
              <span>Catatan privasi</span>
              <textarea name="note" rows="3" placeholder="Bagian yang harus disamarkan, nama yang tidak boleh disebut, atau izin kredit nama."></textarea>
            </label>
            <label class="consent-row">
              <input name="consent" type="checkbox" value="yes" required>
              <span>Saya setuju cerita ini direview dan boleh diadaptasi menjadi konten Memori Misteri dengan penyamaran seperlunya.</span>
            </label>
            <button class="primary fan-submit" type="submit">Kirim ke antrian</button>
          </form>

          <aside class="fan-side panel">
            <h2>Yang bisa dikirim</h2>
            <div class="fan-info-list">
              <div><strong>Rekaman</strong><span>MP3, WAV, M4A, AAC, OGG, OPUS, WEBM, atau MP4.</span></div>
              <div><strong>Teks</strong><span>TXT, MD, atau DOCX. Cerita pendek boleh, asal detailnya cukup.</span></div>
              <div><strong>Review dulu</strong><span>Semua kiriman masuk dashboard dan tidak langsung dipublikasikan.</span></div>
            </div>
          </aside>
        </section>
      <?php endif; ?>
    </main>
  </body>
</html>
