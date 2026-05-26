import { config } from "./config.js";
import { estimateStoryCost } from "./cost.js";
import { requestStoryJson } from "./openai.js";
import { clamp, cleanText, createId, nowIso } from "./util.js";

const transitions = ["fade gelap cepat", "zoom pelan", "flash putih singkat", "glitch halus", "cut hening"];

const themes = {
  kos: ["lorong kos sempit", "pintu kamar setengah terbuka", "lampu neon berkedip", "bayangan di ujung lorong"],
  jalan: ["jalan kampung sepi", "lampu jalan kuning", "gerimis tipis", "sosok jauh di tikungan"],
  rumah: ["rumah tua kosong", "jendela retak", "ruang tamu berdebu", "kursi bergeser sendiri"],
  pendaki: ["jalur hutan berkabut", "tenda kecil", "senter redup", "suara ranting patah"],
  mimpi: ["kamar gelap", "jam digital 03:12", "cermin buram", "bayangan berdiri di belakang"]
};

const fallbackTemplates = [
  {
    title: "Nyanyian dari Sumur Belakang",
    theme: "rumah",
    logline: "Rekaman suara dari sumur tua membuat satu keluarga sadar bahwa rumah kosong itu tidak pernah benar-benar kosong.",
    hook: "Malam Jumat itu, suara nyanyian datang dari tempat yang sudah ditutup semen.",
    ending: "Saat rekamannya diputar ulang, suara yang bernyanyi justru memakai suaraku.",
    screens: ["Sumur tua", "Lagu pelan", "HP merekam", "Jendela bergerak", "Nama dipanggil", "Suara sendiri", "Tutup sumur", "Masih bernyanyi"],
    beats: [
      "Aku cuma diminta menjaga rumah kosong dekat sawah sampai pembelinya datang besok pagi.",
      "Menjelang tengah malam, dari sumur belakang terdengar perempuan menyanyi pelan, seperti menenangkan anak kecil.",
      "Aku merekamnya dengan HP, tapi layar kamera menangkap bayangan berdiri di jendela ruang tamu.",
      "Saat aku mendekat, nyanyian itu berhenti dan diganti suara ketukan dari dasar sumur.",
      "Notifikasi rekaman muncul sendiri, padahal aku belum menekan tombol selesai.",
      "Di file itu, ada suaraku berbisik minta dibukakan dari bawah tanah.",
      "Aku lari ke pagar depan, tapi pintunya terkunci dari luar dengan rantai yang belum ada sebelumnya.",
      "Pagi harinya, tetangga bilang sumur itu ditutup setelah ada penjaga terakhir yang hilang tanpa jejak."
    ]
  },
  {
    title: "Penumpang Terakhir di Angkot Malam",
    theme: "jalan",
    logline: "Sopir angkot yang mengejar setoran terakhir menerima penumpang yang tujuannya tidak ada di peta.",
    hook: "Kalau naik angkot kosong lewat jam dua malam, jangan duduk di kursi paling belakang.",
    ending: "Di kaca spion, kursi belakang penuh orang basah yang menatapku tanpa berkedip.",
    screens: ["Angkot kosong", "Penumpang naik", "Alamat hilang", "Spion buram", "Uang basah", "Jalan memutar", "Kursi penuh", "Jangan berhenti"],
    beats: [
      "Malam itu aku mengambil satu putaran terakhir karena setoran masih kurang sedikit.",
      "Di halte sepi, seorang perempuan berkerudung naik tanpa suara dan duduk paling belakang.",
      "Dia menyebut alamat yang terasa familiar, tapi begitu kubuka peta, jalan itu tidak pernah ada.",
      "Kaca spion mendadak berembun dari dalam, membentuk tulisan pendek: jangan turunkan dia.",
      "Saat membayar, uangnya basah dan berbau tanah setelah hujan.",
      "Aku mencoba berbelok ke jalan besar, tapi angkot selalu kembali ke halte yang sama.",
      "Di kursi belakang, bukan cuma dia yang duduk. Ada lima bayangan lain menunduk menunggu giliran.",
      "Satu suara tepat di belakang telingaku berbisik, malam ini sopirnya ikut turun."
    ]
  },
  {
    title: "Kamar Nomor Tiga Belas",
    theme: "kos",
    logline: "Penghuni baru kos murah menemukan pintu kamar yang tidak pernah tercatat di denah bangunan.",
    hook: "Pemilik kos bilang tidak ada kamar nomor tiga belas. Tapi kuncinya ada di sakuku.",
    ending: "Di balik pintu itu, ada kasur rapi dengan namaku tertulis di papan penghuni lama.",
    screens: ["Kunci asing", "Nomor 13", "Lorong sepi", "Lampu mati", "Denah hilang", "Nama lama", "Pintu membuka", "Aku sudah tinggal"],
    beats: [
      "Aku pindah ke kos murah di ujung gang karena cuma tempat itu yang bisa dibayar mingguan.",
      "Di gantungan kunci, ada satu kunci kecil bertuliskan tiga belas, padahal kamarku nomor tujuh.",
      "Setiap malam, lorong sebelah dapur memanjang sendiri sampai muncul pintu yang tidak kulihat saat siang.",
      "Dari dalam pintu itu terdengar suara orang mengetik pesan dengan nada yang sama seperti HP-ku.",
      "Pemilik kos bersumpah bangunan itu cuma punya dua belas kamar sejak awal dibangun.",
      "Saat kubuka denah lama, nomor tiga belas dicoret tebal dan di sampingnya tertulis jangan disewakan lagi.",
      "Aku memberanikan diri membuka pintu, dan bau kamarku sendiri langsung keluar dari sana.",
      "Di meja kamar itu, ada buku catatan berisi semua hal yang akan kulakukan besok pagi."
    ]
  },
  {
    title: "Cermin Kontrakan Belakang Pasar",
    theme: "rumah",
    logline: "Cermin tua di kontrakan murah menampilkan ruangan yang sama, tetapi penghuninya bergerak lebih dulu.",
    hook: "Bayanganku di cermin selalu terlambat satu detik, sampai malam ketika dia bergerak duluan.",
    ending: "Besok paginya aku bangun di sisi dalam cermin, melihat tubuhku tersenyum di kamar.",
    screens: ["Cermin tua", "Gerak terlambat", "Lampu padam", "Bayangan senyum", "Pintu terkunci", "Tangan keluar", "Tukar tempat", "Sisi dalam"],
    beats: [
      "Kontrakan itu murah karena bekas gudang pasar, tapi aku tidak punya pilihan lain.",
      "Di kamar belakang ada cermin tinggi yang tidak bisa dilepas meski semua bautnya sudah karatan.",
      "Awalnya bayanganku cuma terlambat satu detik setiap kali aku bergerak.",
      "Malam ketiga, bayangan itu tersenyum lebih dulu sebelum aku merasa ingin tersenyum.",
      "Aku menutup cermin dengan kain, tapi dari balik kain terdengar ketukan pelan seperti kuku menyentuh kaca.",
      "Saat listrik padam, sebuah tangan menekan permukaan cermin dari sisi seberang.",
      "Aku mundur ke pintu, tapi kunci kamar sudah berada di tangan bayanganku.",
      "Terakhir yang kuingat, kaca itu terasa seperti air dingin menelan wajahku."
    ]
  },
  {
    title: "Pendaki yang Tidak Pernah Turun",
    theme: "pendaki",
    logline: "Rombongan pendaki mengikuti suara peluit dari hutan, lalu menemukan tenda yang berisi nama mereka sendiri.",
    hook: "Di gunung itu, peluit tiga kali artinya ada yang minta dituntun keluar. Atau ditukar.",
    ending: "Saat tim SAR menemukan tenda kami, jumlah sepatu di depan pintu bertambah satu pasang.",
    screens: ["Kabut turun", "Peluit tiga kali", "Jejak basah", "Tenda asing", "Nama kami", "Api mati", "Satu kurang", "Sepatu baru"],
    beats: [
      "Kabut turun lebih cepat dari perkiraan ketika kami hampir sampai pos tiga.",
      "Dari arah jurang, terdengar peluit tiga kali, jeda, lalu tiga kali lagi.",
      "Temanku bilang itu kode pendaki tersesat, jadi kami mengikuti suara itu dengan senter kecil.",
      "Jejak kaki di tanah basah mengarah ke tenda abu-abu yang tidak ada saat kami lewat sore tadi.",
      "Di dalam tenda, ada daftar nama rombongan kami lengkap dengan jam kematian masing-masing.",
      "Api kompor mendadak mati, dan peluit itu terdengar lagi dari dalam tas salah satu teman.",
      "Ketika kami berlari kembali ke jalur, jumlah suara langkah di belakangku berkurang satu.",
      "Pagi hari, tim SAR menemukan tenda kami kosong, kecuali satu pasang sepatu baru yang masih hangat."
    ]
  },
  {
    title: "Pesan Suara dari Nomor Ibu",
    theme: "mimpi",
    logline: "Pesan suara dari nomor almarhum ibu mengarahkan seorang anak ke kamar yang selama ini dilarang dibuka.",
    hook: "Nomor ibu masuk lagi setelah tujuh hari wafat, dan pesannya cuma satu: jangan tidur di rumah itu.",
    ending: "Di pesan terakhir, suara ibu berbisik bahwa yang sedang kupeluk sejak pemakaman bukan ayahku.",
    screens: ["Nomor ibu", "Pesan suara", "Kamar terkunci", "Foto jatuh", "Bau melati", "Sosok ayah", "Jangan tidur", "Bukan ayah"],
    beats: [
      "Aku pulang ke rumah setelah tujuh hari pemakaman ibu, berniat menemani ayah yang tinggal sendiri.",
      "Pukul satu malam, nomor ibu mengirim pesan suara baru, padahal HP-nya masih kusimpan di laci.",
      "Suaranya pelan dan pecah, menyuruhku jangan tidur di kamar depan.",
      "Saat pesan kedua masuk, foto keluarga di dinding jatuh tepat di depan pintu kamar yang selalu dikunci.",
      "Dari celah pintu, tercium bau melati bercampur tanah basah.",
      "Ayah berdiri di ujung lorong tanpa berkedip, lalu bertanya dengan suara datar kenapa aku belum tidur.",
      "Pesan ketiga masuk saat dia memegang bahuku, dan kali ini suara ibu terdengar panik.",
      "Ibu berbisik, jangan percaya wajahnya, ayahmu belum pulang dari kuburan."
    ]
  }
];

export async function createStoryDraft(input, context = {}) {
  const normalized = normalizeInput(input);
  const memory = normalizeMemory(context);
  const promptText = buildPrompt(normalized, memory);
  let plan;
  let source = "offline-template";
  let warning = "";

  if (config.openai.apiKey) {
    try {
      const ai = await requestStoryJson(promptText);
      plan = normalizePlan(ai, normalized, memory);
      source = "openai";
    } catch (error) {
      warning = `OpenAI gagal, pakai draft offline: ${error.message}`;
      plan = fallbackPlan(normalized, memory);
    }
  } else {
    plan = fallbackPlan(normalized, memory);
  }

  const narrationText = plan.scenes.map((scene) => scene.narration).join(" ");
  const outputText = JSON.stringify(plan);
  const cost = estimateStoryCost({
    promptText,
    outputText,
    sceneCount: plan.scenes.length,
    imageSize: normalized.imageSize,
    imageQuality: normalized.imageQuality,
    narrationChars: narrationText.length,
    pricing: config.pricing
  });

  return {
    id: createId("mistis"),
    title: plan.title,
    status: "draft",
    source,
    warning,
    input: normalized,
    plan,
    cost,
    assets: {
      images: [],
      audio: null,
      video: null
    },
    publishing: {
      youtube: "disabled",
      facebook: "disabled",
      instagram: "disabled"
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeInput(input) {
  const durationSec = clamp(Number(input.durationSec || 55), 50, 60);
  const sceneCount = clamp(Number(input.sceneCount || 8), 7, 10);
  return {
    idea: cleanText(input.idea || "Ada suara mengetuk pintu kos jam tiga pagi.", 1200),
    theme: cleanText(input.theme || "kos", 40),
    tone: cleanText(input.tone || "seram pelan dan realistis", 100),
    durationSec,
    sceneCount,
    imageSize: cleanText(input.imageSize || config.openai.imageSize, 20),
    imageQuality: cleanText(input.imageQuality || config.openai.imageQuality, 20),
    language: "id"
  };
}

function normalizeMemory(context) {
  const stories = Array.isArray(context.existingStories) ? context.existingStories : [];
  const recent = stories.slice(0, 30).map((story) => ({
    title: cleanText(story?.title || story?.plan?.title || "", 90),
    logline: cleanText(story?.plan?.logline || story?.input?.idea || "", 180)
  })).filter((story) => story.title || story.logline);
  return {
    recent,
    titles: new Set(recent.map((story) => normalizeKey(story.title)).filter(Boolean))
  };
}

function buildPrompt(input, memory) {
  const avoid = memory.recent.length
    ? [
        "Jangan ulangi judul, lokasi utama, twist, atau pola cerita berikut:",
        ...memory.recent.map((story) => `- ${story.title}: ${story.logline}`)
      ].join("\n")
    : "Belum ada riwayat cerita, tetap buat plot yang spesifik dan tidak generik.";
  return [
    "Buat rencana video cerita mistis vertikal bahasa Indonesia.",
    "Konten harus original, cinematic, tidak gore, tidak memakai figur publik nyata, dan cocok untuk YouTube Shorts, Facebook Reels, Instagram Reels.",
    "Kembalikan JSON valid saja dengan shape:",
    "{ title, logline, hook, ending, scenes:[{ index, durationSec, narration, screenText, imagePrompt, transition, effect, soundDesign }] }",
    "Durasi total harus 50 sampai 60 detik. Narasi harus cukup panjang untuk TTS, bukan hanya subtitle pendek.",
    "Setiap scene wajib punya momen visual berbeda, supaya gambar tidak kembar.",
    `Ide: ${input.idea}`,
    `Tema: ${input.theme}`,
    `Tone: ${input.tone}`,
    `Durasi total: ${input.durationSec} detik`,
    `Jumlah scene: ${input.sceneCount}`,
    avoid,
    "Setiap imagePrompt harus detail dan konsisten: vertical 9:16, Indonesian horror atmosphere, cinematic lighting, clear visible subject, not underexposed, no text in image, no real celebrity, no logo."
  ].join("\n");
}

function normalizePlan(plan, input, memory) {
  const fallback = fallbackPlan(input, memory);
  const scenes = Array.isArray(plan?.scenes) && plan.scenes.length ? plan.scenes : fallback.scenes;
  const title = makeUniqueTitle(cleanText(plan?.title || fallback.title, 80), memory, input);
  const durations = distributeDurations(input.durationSec, Math.min(input.sceneCount, scenes.length));
  return {
    title,
    logline: cleanText(plan?.logline || fallback.logline, 240),
    hook: cleanText(plan?.hook || fallback.hook, 240),
    ending: cleanText(plan?.ending || fallback.ending, 240),
    scenes: scenes.slice(0, input.sceneCount).map((scene, index) => normalizeScene({
      ...scene,
      durationSec: durations[index] || scene.durationSec
    }, index, input))
  };
}

function normalizeScene(scene, index, input) {
  const durationSec = clamp(Number(scene.durationSec || Math.round(input.durationSec / input.sceneCount)), 3, 15);
  return {
    index: index + 1,
    durationSec,
    narration: cleanText(scene.narration || `Malam itu, sesuatu terasa berbeda di ${input.theme}.`, 700),
    screenText: cleanText(scene.screenText || `Scene ${index + 1}`, 50),
    imagePrompt: enhancePrompt(scene.imagePrompt || "", input, index),
    transition: cleanText(scene.transition || transitions[index % transitions.length], 80),
    effect: cleanText(scene.effect || "slow zoom, subtle film grain, dark vignette", 120),
    soundDesign: cleanText(scene.soundDesign || "low drone, faint room tone", 120)
  };
}

function enhancePrompt(prompt, input, index) {
  const motif = themeMotif(input.theme, index);
  const base = prompt || `${motif}, tense quiet horror scene`;
  return [
    base,
    "vertical 9:16 cinematic Indonesian horror illustration",
    "realistic atmosphere, moody shadows, soft mist, high detail, clear visible subject, not underexposed",
    "no text, no logo, no celebrity, no gore, no distorted hands"
  ].join(", ");
}

function fallbackPlan(input, memory = { titles: new Set() }) {
  const template = pickFallbackTemplate(input, memory);
  const durations = distributeDurations(input.durationSec, input.sceneCount);
  const scenes = Array.from({ length: input.sceneCount }, (_, index) => {
    const motif = themeMotif(template.theme || input.theme, index);
    const beat = template.beats[index % template.beats.length];
    return normalizeScene({
      durationSec: durations[index],
      narration: beat,
      screenText: template.screens[index % template.screens.length],
      imagePrompt: `${motif}, ${beat}`,
      transition: transitions[index % transitions.length],
      effect: index % 2 ? "slow push in, shadow flicker, film grain" : "subtle handheld drift, dark vignette, cold haze",
      soundDesign: index % 2 ? "distant knock, low breath, short silence" : "room tone, faint wind, floor creak"
    }, index, input);
  });

  return {
    title: makeUniqueTitle(template.title, memory, input),
    logline: template.logline,
    hook: template.hook,
    ending: template.ending,
    scenes
  };
}

function pickFallbackTemplate(input, memory) {
  const byTheme = fallbackTemplates.filter((template) => template.theme === input.theme);
  const candidates = [...byTheme, ...fallbackTemplates].filter((template, index, list) => {
    return list.findIndex((item) => item.title === template.title) === index;
  });
  return candidates.find((template) => !memory.titles.has(normalizeKey(template.title))) || candidates[0] || fallbackTemplates[0];
}

function makeUniqueTitle(title, memory, input) {
  const base = cleanText(title || "Cerita Mistis Baru", 70);
  if (!memory.titles?.has(normalizeKey(base))) return base;
  const suffixes = [
    input.theme,
    "versi malam ini",
    `episode ${memory.titles.size + 1}`,
    String(Date.now()).slice(-4)
  ];
  for (const suffix of suffixes) {
    const next = cleanText(`${base} - ${suffix}`, 80);
    if (!memory.titles.has(normalizeKey(next))) return next;
  }
  return cleanText(`${base} - ${createId("baru").slice(-6)}`, 80);
}

function distributeDurations(totalSec, sceneCount) {
  const count = Math.max(1, Number(sceneCount || 1));
  const totalTenths = Math.round(Number(totalSec || 55) * 10);
  const base = Math.floor(totalTenths / count);
  let remainder = totalTenths - (base * count);
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return Number(((base + extra) / 10).toFixed(1));
  });
}

function themeMotif(theme, index) {
  const key = themes[theme] ? theme : "kos";
  const list = themes[key];
  return list[index % list.length];
}

function normalizeKey(value) {
  return cleanText(value || "", 120).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
