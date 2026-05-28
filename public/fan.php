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

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
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
      <section class="fan-hero">
        <p class="eyebrow">Memori Misteri</p>
        <h1>Kirim cerita serammu</h1>
        <p>Rekaman atau teks akan masuk antrian review dulu sebelum dijadikan episode.</p>
      </section>
      <?php if ($message): ?><div class="panel fan-alert success"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
      <?php if ($error): ?><div class="panel fan-alert error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
      <form id="fanForm" class="panel fan-form" method="post" enctype="multipart/form-data">
        <label>
          <span>Nama panggilan</span>
          <input name="fanName" maxlength="80" placeholder="Boleh anonim">
        </label>
        <label>
          <span>Kontak opsional</span>
          <input name="contact" maxlength="120" placeholder="Instagram, email, atau WhatsApp">
        </label>
        <label>
          <span>Judul cerita</span>
          <input name="title" maxlength="120" required>
        </label>
        <label>
          <span>File rekaman / teks</span>
          <input name="storyFile" type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.opus,.webm,.mp4,.txt,.md,.docx" required>
        </label>
        <label>
          <span>Teks tambahan</span>
          <textarea name="storyText" rows="7" placeholder="Kalau ceritamu sudah berupa teks, tulis juga di sini atau upload .txt/.docx."></textarea>
        </label>
        <label>
          <span>Catatan</span>
          <textarea name="note" rows="3" placeholder="Nama samaran, lokasi disamarkan, atau bagian yang tidak boleh disebut."></textarea>
        </label>
        <button class="primary" type="submit">Kirim ke antrian</button>
      </form>
    </main>
  </body>
</html>
