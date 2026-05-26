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

const visualPromptSuffix = [
  "vertical 9:16 cinematic Indonesian horror illustration",
  "moody blue-green night lighting, soft mist, visible main subject, readable silhouette",
  "high detail, phone-screen composition, dark but not underexposed",
  "no text, no logo, no celebrity, no gore, no distorted hands"
].join(", ");

const defaultCharacter = "Andi, pria Indonesia 28 tahun, rambut hitam pendek sedikit berantakan, wajah lelah dan penasaran, jaket denim gelap di atas kaos hitam polos, celana cargo hitam, sneakers gelap usang, selalu membawa smartphone dan senter kecil";

const shotDirections = [
  "wide atmospheric establishing shot, no visible person, focus on the location, mist, light, and negative space",
  "protagonist continuity shot, show the main character clearly with the same outfit and props",
  "object detail shot, no full person, focus on the clue, phone screen, door, window, well surface, key, or moving object",
  "POV flashlight shot from the protagonist, only hand, phone, or small flashlight may appear",
  "distant silhouette or shadow shot, person optional and small in frame, atmosphere is the main subject",
  "protagonist reaction shot, show the main character only if it serves the narration",
  "environment threat shot, no visible face, focus on movement in the room, corridor, field, or reflection",
  "final unsettling atmosphere shot, protagonist optional as a tiny silhouette, do not make it a portrait"
];

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
  const durationSec = clamp(Number(input.durationSec || 60), 45, 60);
  const sceneCount = clamp(Number(input.sceneCount || 8), 6, 10);
  const totalParts = clamp(Number(input.totalParts || 10), 6, 20);
  const partNumber = clamp(Number(input.partNumber || 1), 1, totalParts);
  return {
    idea: cleanText(input.idea || "Di rumah kosong dekat sawah, ada suara perempuan menyanyi dari sumur tua setiap malam Jumat.", 1200),
    episodeTitle: cleanText(input.episodeTitle || "", 100),
    protagonistName: cleanText(input.protagonistName || "Andi", 40),
    protagonistProfile: cleanText(input.protagonistProfile || defaultCharacter, 360),
    theme: cleanText(input.theme || "kos", 40),
    tone: cleanText(input.tone || "seram pelan dan realistis", 100),
    durationSec,
    sceneCount,
    totalParts,
    partNumber,
    imageSize: cleanText(input.imageSize || config.openai.imageSize, 20),
    imageQuality: cleanText(input.imageQuality || config.openai.imageQuality, 20),
    language: "id"
  };
}

function normalizeMemory(context) {
  const stories = Array.isArray(context.existingStories) ? context.existingStories : [];
  const recent = stories.slice(0, 30).map((story) => ({
    title: cleanText(story?.title || story?.plan?.title || "", 90),
    episodeTitle: cleanText(story?.plan?.episode?.title || story?.input?.episodeTitle || "", 100),
    partTitle: cleanText(story?.plan?.episode?.partTitle || "", 100),
    partNumber: Number(story?.plan?.episode?.currentPart || story?.input?.partNumber || 0),
    outline: story?.plan?.episode?.partOutline,
    logline: cleanText(story?.plan?.logline || story?.input?.idea || "", 180)
  })).filter((story) => story.title || story.logline);
  return {
    recent,
    titles: new Set(recent.map((story) => normalizeKey(story.title)).filter(Boolean))
  };
}

function buildPrompt(input, memory) {
  const matchingEpisode = memory.recent.find((story) => normalizeKey(story.episodeTitle) === normalizeKey(input.episodeTitle));
  const existingOutline = Array.isArray(matchingEpisode?.outline)
    ? [
        "Outline episode yang sudah ada, pakai ini sebagai kontinuitas:",
        ...matchingEpisode.outline.map((part) => `Part ${part.part}: ${part.title} - ${part.summary || part.cliffhanger || ""}`)
      ].join("\n")
    : "";
  const avoid = memory.recent.length
    ? [
        "Jangan ulangi judul, lokasi utama, twist, atau pola cerita berikut:",
        ...memory.recent.map((story) => `- ${story.title}: ${story.logline}`)
      ].join("\n")
    : "Belum ada riwayat cerita, tetap buat plot yang spesifik dan tidak generik.";
  return [
    "Buat rencana 1 video short sebagai bagian dari 1 episode cerita mistis vertikal bahasa Indonesia.",
    "Konten harus original, cinematic, tidak gore, tidak memakai figur publik nyata, dan cocok untuk YouTube Shorts, Facebook Reels, Instagram Reels.",
    "Kembalikan JSON valid saja dengan shape:",
    "{ title, logline, hook, ending, episode:{ title, totalParts, currentPart, partTitle, arcSummary, partOutline:[{ part, title, summary, cliffhanger }] }, scenes:[{ index, durationSec, narration, screenText, imagePrompt, transition, effect, soundDesign }] }",
    "Episode besar harus punya outline 10 part atau sesuai Total part. Script scenes hanya untuk Current part.",
    "Durasi video current part harus sekitar 1 menit dan tidak boleh lewat 60 detik.",
    "Jangan tulis kalimat seperti: bersambung, akan berlanjut, lanjut di part berikutnya, tunggu part berikutnya, atau summary penutup. Akhiri part dengan beat cerita natural.",
    "Setiap scene wajib punya momen visual berbeda, supaya gambar tidak kembar.",
    `Tokoh utama menjadi anchor kontinuitas cerita: ${input.protagonistProfile}.`,
    "Jangan tampilkan tokoh utama di semua gambar. Campurkan character shot dengan establishing shot, object detail, POV senter/HP, bayangan, lorong, sawah, pintu, sumur, atau benda petunjuk.",
    "Untuk video 8 scene, scene 2, 4, dan 6 wajib menjadi insert shot tanpa orang/tokoh: fokus lokasi, objek, cahaya, refleksi, pintu, sumur, HP, atau petunjuk visual.",
    "Idealnya 40-60% scene menampilkan tokoh utama, sisanya visual suasana atau objek. Kalau tokoh utama muncul, imagePrompt wajib menyebut nama, umur, outfit, smartphone, dan senter kecil yang sama.",
    "Untuk adegan sumur: tampilkan sosok di samping/dekat sumur atau refleksi aman di air; jangan tampilkan orang jatuh, tubuh terjebak, tenggelam, atau berada di dalam sumur.",
    `Ide: ${input.idea}`,
    `Judul episode opsional: ${input.episodeTitle || "buatkan judul episode yang kuat"}`,
    `Tema: ${input.theme}`,
    `Tone: ${input.tone}`,
    `Durasi current part: ${input.durationSec} detik`,
    `Jumlah scene: ${input.sceneCount}`,
    `Current part: ${input.partNumber}`,
    `Total part episode: ${input.totalParts}`,
    matchingEpisode ? `Episode ini sudah punya part sebelumnya. Pertahankan kontinuitas dunia, tokoh, dan misteri, tapi tulis hanya part ${input.partNumber}.` : "",
    existingOutline,
    avoid,
    "Setiap imagePrompt harus detail dan konsisten dengan visual style ini:",
    visualPromptSuffix
  ].join("\n");
}

function normalizePlan(plan, input, memory) {
  const fallback = fallbackPlan(input, memory);
  const scenes = Array.isArray(plan?.scenes) && plan.scenes.length ? [...plan.scenes] : [...fallback.scenes];
  while (scenes.length < input.sceneCount) {
    const fallbackScene = fallback.scenes[scenes.length % fallback.scenes.length];
    scenes.push({
      ...fallbackScene,
      screenText: `${fallbackScene.screenText} ${Math.floor(scenes.length / fallback.scenes.length) + 2}`,
      imagePrompt: `${fallbackScene.imagePrompt}, continuation beat ${scenes.length + 1}`
    });
  }
  const title = makeUniqueTitle(cleanText(plan?.title || fallback.title, 80), memory, input);
  const durations = distributeDurations(input.durationSec, Math.min(input.sceneCount, scenes.length));
  const episode = normalizeEpisode(plan?.episode, fallback.episode, title, input);
  return {
    title,
    logline: stripContinuationLanguage(cleanText(plan?.logline || fallback.logline, 240)),
    hook: stripContinuationLanguage(cleanText(plan?.hook || fallback.hook, 240)),
    ending: stripContinuationLanguage(cleanText(plan?.ending || fallback.ending, 240)),
    episode,
    scenes: scenes.slice(0, input.sceneCount).map((scene, index) => normalizeScene({
      ...scene,
      durationSec: durations[index] || scene.durationSec
    }, index, input))
  };
}

function normalizeScene(scene, index, input) {
  const durationSec = clamp(Number(scene.durationSec || Math.round(input.durationSec / input.sceneCount)), 3, 15);
  const screenText = stripContinuationLanguage(cleanText(scene.screenText || `Scene ${index + 1}`, 64));
  return {
    index: index + 1,
    durationSec,
    narration: stripContinuationLanguage(cleanText(scene.narration || fallbackNarration(scene, input, index), 700)),
    screenText,
    imagePrompt: enhancePrompt(scene.imagePrompt || "", input, index),
    transition: cleanText(scene.transition || transitions[index % transitions.length], 80),
    effect: cleanText(scene.effect || "slow zoom, subtle film grain, dark vignette", 120),
    soundDesign: cleanText(scene.soundDesign || "low drone, faint room tone", 120)
  };
}

function enhancePrompt(prompt, input, index) {
  const motif = themeMotif(input.theme, index);
  const requestedBase = prompt || `${motif}, tense quiet horror scene`;
  const forceAtmospheric = shouldForceAtmosphericInsert(index) || avoidsVisibleCharacter(requestedBase);
  const base = forceAtmospheric
    ? `${motif}, atmospheric insert shot inspired by the scene mood, focus on location, object clue, light, shadow, reflection, phone glow, door, window, or well surface`
    : requestedBase;
  const direction = forceAtmospheric
    ? "atmospheric or object-focused insert shot, no visible person, no face, no full body"
    : chooseShotDirection(base, input, index);
  const characterRule = forceAtmospheric
    ? "no visible protagonist; imply the character only through flashlight beam, phone glow, footprints, open door, shadow, or object clue"
    : `character continuity: if ${input.protagonistName} appears, use this exact profile: ${input.protagonistProfile}; otherwise keep the frame atmospheric or object-focused and do not force a person into the frame`;
  return [
    base,
    `composition direction: ${direction}`,
    characterRule,
    "if a well appears, keep any human silhouette beside the well or reflected safely on water, never inside the well",
    visualPromptSuffix
  ].join(", ");
}

function chooseShotDirection(base, input, index) {
  const text = cleanText(base || "", 900).toLowerCase();
  const name = cleanText(input.protagonistName || "Andi", 40).toLowerCase();
  if (avoidsVisibleCharacter(text)) {
    return "atmospheric or object-focused shot, no visible full person, focus on location, clue, light, shadow, or texture";
  }
  if (text.includes(name) || text.includes("tokoh utama") || text.includes("protagonist")) {
    return "contextual character shot, keep the protagonist consistent but let the location and horror atmosphere dominate the frame";
  }
  return shotDirections[index % shotDirections.length];
}

function shouldForceAtmosphericInsert(index) {
  return [2, 4, 6].includes(index + 1);
}

function avoidsVisibleCharacter(value) {
  return /\b(tanpa tokoh|tanpa orang|tanpa manusia|no visible person|no person|no human|without person|without people)\b/i.test(String(value || ""));
}

function fallbackNarration(scene, input, index) {
  const focus = cleanText(scene.screenText || themeMotif(input.theme, index), 80).toLowerCase();
  const lines = [
    `Cahaya senter menyapu ${focus}, dan suasana rumah terasa makin dingin.`,
    `Di titik itu, ${focus} terlihat seperti menyimpan sesuatu yang sengaja ditinggalkan.`,
    `Andi menahan napas saat ${focus} muncul dalam gelap, lebih jelas dari sebelumnya.`
  ];
  return lines[index % lines.length];
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
    episode: buildFallbackEpisode(template, input),
    scenes
  };
}

function normalizeEpisode(raw, fallback, title, input) {
  const source = raw || {};
  const partOutline = normalizePartOutline(source.partOutline || fallback?.partOutline, input);
  return {
    title: cleanText(input.episodeTitle || source.title || fallback?.title || title, 100),
    totalParts: input.totalParts,
    currentPart: input.partNumber,
    partTitle: cleanText(source.partTitle || fallback?.partTitle || title, 100),
    arcSummary: cleanText(source.arcSummary || fallback?.arcSummary || "Satu episode mistis panjang yang dibagi menjadi beberapa part short.", 420),
    partOutline
  };
}

function normalizePartOutline(outline, input) {
  const list = Array.isArray(outline) ? outline : [];
  const items = Array.from({ length: input.totalParts }, (_, index) => {
    const item = list[index] || {};
    const part = index + 1;
    return {
      part,
      title: cleanText(item.title || `Part ${part}`, 80),
      summary: cleanText(item.summary || `Peristiwa mistis meningkat di part ${part}.`, 220),
      cliffhanger: stripContinuationLanguage(cleanText(item.cliffhanger || `Beat tegang untuk part ${part}.`, 180))
    };
  });
  return items;
}

function buildFallbackEpisode(template, input) {
  const title = input.episodeTitle || template.title;
  const partOutline = Array.from({ length: input.totalParts }, (_, index) => {
    const part = index + 1;
    const isFinal = part === input.totalParts;
    return {
      part,
      title: part === 1 ? `${template.title}: Awal Gangguan` : `${template.title}: Part ${part}`,
      summary: isFinal
        ? "Rahasia utama terbuka dan semua tanda dari part sebelumnya kembali dalam satu konfrontasi terakhir."
        : `Gangguan dari objek utama semakin dekat, membuka petunjuk baru dan risiko yang lebih personal di part ${part}.`,
      cliffhanger: isFinal ? "Akhir episode mengunci nasib tokoh utama." : `Beat tegang untuk part ${part}.`
    };
  });
  return {
    title,
    totalParts: input.totalParts,
    currentPart: input.partNumber,
    partTitle: partOutline[input.partNumber - 1]?.title || template.title,
    arcSummary: `${template.logline} Episode ini dibagi menjadi ${input.totalParts} part short dengan fokus misteri bertahap.`,
    partOutline
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

function stripContinuationLanguage(value) {
  return cleanText(value || "", 900)
    .replace(/\b(bersambung|akan berlanjut|lanjut di part berikutnya|tunggu part berikutnya|part berikutnya)\b[.!…]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function themeMotif(theme, index) {
  const key = themes[theme] ? theme : "kos";
  const list = themes[key];
  return list[index % list.length];
}

function normalizeKey(value) {
  return cleanText(value || "", 120).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
