import { config } from "./config.js";
import { estimateStoryCost } from "./cost.js";
import { requestStoryJson } from "./openai.js";
import { clamp, cleanText, createId, nowIso } from "./util.js";

const transitions = ["fade gelap cepat", "zoom pelan", "flash putih singkat", "glitch halus", "cut hening"];
const narrationStyleRules = [
  "Narasi harus terasa seperti orang Indonesia sedang live story telling atau mengirim voice note tengah malam, bukan bahasa laporan.",
  "Default pakai sudut pandang aku kalau ide cocok. Narator boleh terdengar ragu, menahan napas, mencoba menenangkan diri, lalu makin takut.",
  "Gunakan kalimat pendek, tegang, dan visual. Sisipkan jeda natural lewat koma, titik, atau elipsis secukupnya.",
  "Walaupun output dibagi per scene, tulis narration sebagai satu monolog sambung. Scene berikutnya harus terasa melanjutkan kalimat atau rasa dari scene sebelumnya, bukan mulai cerita baru.",
  "Pakai bahasa sehari-hari yang tetap rapi: 'waktu itu', 'aku kira', 'jujur', 'anehnya', 'di situ aku mulai ngerasa'. Jangan terlalu gaul.",
  "Jangan mengawali semua scene dengan 'aku'. Variasikan dengan 'waktu itu', 'setelah beberapa detik', 'yang bikin aku diam', 'anehnya', atau langsung lanjut ke kejadian.",
  "Jangan terlalu sering menyebut nama tokoh. Kalau sudah pakai aku, lanjutkan sebagai aku sampai selesai.",
  "Hindari kata-kata kaku seperti 'terdapat', 'melakukan observasi', 'memasuki area', 'terlihat jelas'. Pakai bahasa sehari-hari yang tetap sinematik.",
  "Hindari kalimat sinopsis seperti 'Andi mulai menyelidiki' atau 'misteri semakin dalam'. Ubah menjadi kejadian langsung yang sedang dialami.",
  "Jangan pernah membacakan biodata, umur, ciri fisik, atau outfit tokoh di narration. Cukup sebut aksi dan tempat, misalnya: 'Andi berdiri di depan sumur tua.'",
  "Bangun rasa takut dari hal kecil yang manusiawi: suara sandal di tanah, layar HP yang meredup, bau tanah basah, jendela bergerak, napas yang tiba-tiba terdengar bukan milik narator.",
  "Setiap scene narration idealnya 1-2 kalimat saja, mudah dibaca TTS, dan langsung membawa penonton ke momen berikutnya."
];

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
  "no text, no logo, no celebrity, no gore, no distorted hands, no extra human figures"
].join(", ");

const defaultCharacter = "Andi, pria Indonesia 28 tahun, rambut hitam pendek sedikit berantakan, wajah lelah dan penasaran, jaket denim gelap di atas kaos hitam polos, celana cargo hitam, sneakers gelap usang, selalu membawa smartphone dan senter kecil";

const shotDirections = [
  "wide atmospheric establishing shot, no visible person, focus on the location, mist, light, and negative space",
  "object detail shot, no full person, focus on the clue, phone screen, door, window, well surface, key, or moving object",
  "POV flashlight shot, only a hand, phone, or small flashlight may appear",
  "distant silhouette or shadow shot, person optional and small in frame, atmosphere is the main subject",
  "environment threat shot, no visible face, focus on movement in the room, corridor, field, or reflection",
  "final unsettling atmosphere shot, do not make it a portrait"
];

const visualVarietyRules = [
  "Jangan membuat semua scene berpusat pada satu objek atau satu lokasi kecil saja. Maksimal 2 scene boleh memakai objek utama yang sama.",
  "Current part harus punya minimal 5 anchor visual berbeda: establishing lokasi, benda petunjuk close-up, POV/layar HP, ruang atau jalan berbeda, pantulan/bayangan, dan cliffhanger akhir.",
  "ImagePrompt tiap scene wajib menyebut aksi visual, lokasi spesifik, dan komposisi kamera yang berbeda. Jangan hanya mengganti caption di gambar yang sama.",
  "Kalau ide tidak menyebut sumur, jangan menambahkan sumur. Pilih objek horor yang sesuai ide: angkot, kaca spion, pintu kos, HP, tenda, jendela, cermin, sandal basah, atau lampu jalan."
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
  const durationSec = clamp(Number(input.durationSec || 85), 60, 115);
  const sceneCount = clamp(Number(input.sceneCount || 9), 7, 11);
  const totalParts = clamp(Number(input.totalParts || 10), 7, 13);
  const partNumber = clamp(Number(input.partNumber || 1), 1, totalParts);
  return {
    idea: cleanText(input.idea || "Di rumah kosong dekat sawah, ada suara perempuan menyanyi dari sumur tua setiap malam Jumat.", 1200),
    episodeTitle: cleanText(input.episodeTitle || "", 100),
    protagonistName: cleanText(input.protagonistName || "Andi", 40),
    protagonistProfile: cleanText(input.protagonistProfile || defaultCharacter, 360),
    theme: cleanText(input.theme || "kos", 40),
    tone: cleanText(input.tone || "seram pelan, natural, seperti cerita pengalaman pribadi yang makin lama makin tidak beres", 140),
    durationSec,
    sceneCount,
    totalParts,
    partNumber,
    imageSize: cleanText(input.imageSize || config.openai.imageSize, 20),
    imageQuality: cleanText(input.imageQuality || config.openai.imageQuality, 20),
    ttsProvider: cleanText(input.ttsProvider || "", 40),
    ttsStyle: cleanText(input.ttsStyle || "", 140),
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
    logline: cleanText(story?.plan?.logline || story?.input?.idea || "", 180),
    hook: cleanText(story?.plan?.hook || "", 180),
    ending: cleanText(story?.plan?.ending || "", 220),
    narration: cleanText((story?.plan?.scenes || []).map((scene) => scene.narration).join(" "), 900),
    protagonistName: cleanText(story?.input?.protagonistName || "", 60),
    protagonistProfile: cleanText(story?.input?.protagonistProfile || "", 260),
    theme: cleanText(story?.input?.theme || "", 40),
    tone: cleanText(story?.input?.tone || "", 160)
  })).filter((story) => story.title || story.logline);
  return {
    recent,
    titles: new Set(recent.map((story) => normalizeKey(story.title)).filter(Boolean))
  };
}

function buildPrompt(input, memory) {
  const words = narrationWordTarget(input.durationSec);
  const episodeMatches = memory.recent
    .filter((story) => normalizeKey(story.episodeTitle) === normalizeKey(input.episodeTitle))
    .sort((a, b) => Number(a.partNumber || 0) - Number(b.partNumber || 0));
  const previousParts = episodeMatches.filter((story) => Number(story.partNumber || 0) > 0 && Number(story.partNumber || 0) < input.partNumber);
  const matchingEpisode = episodeMatches.at(-1);
  const latestPrevious = previousParts.at(-1);
  const existingOutline = Array.isArray(matchingEpisode?.outline)
    ? [
        "Outline episode yang sudah ada, pakai ini sebagai kontinuitas:",
        ...matchingEpisode.outline.map((part) => `Part ${part.part}: ${part.title} - ${part.summary || part.cliffhanger || ""}`)
      ].join("\n")
    : "";
  const continuity = previousParts.length
    ? [
        "KONTINUITAS EPISODE WAJIB, JANGAN DILANGGAR:",
        `Ini adalah part ${input.partNumber} dari episode yang sama. Jangan membuat kasus baru, saksi baru, lokasi utama baru, atau narator baru.`,
        `Narator/protagonis tetap: ${latestPrevious?.protagonistName || input.protagonistName}.`,
        latestPrevious?.protagonistProfile ? `Kontinuitas visual protagonis tetap: ${latestPrevious.protagonistProfile}.` : "",
        "Part saat ini harus mulai setelah cliffhanger/fakta terakhir part sebelumnya, bukan mengulang dari awal.",
        "Pertahankan relasi sebab-akibat, objek teror utama, tempat utama, dan misteri yang sudah muncul.",
        ...previousParts.map((story) => [
          `Part ${story.partNumber} yang sudah tayang: ${story.title}`,
          `Logline: ${story.logline}`,
          `Ending/cliffhanger: ${story.ending}`,
          `Ringkasan narasi: ${story.narration}`
        ].filter(Boolean).join("\n"))
      ].filter(Boolean).join("\n")
    : [
        "KONTINUITAS EPISODE WAJIB:",
        "Karena ini part 1, buat fondasi episode yang stabil untuk semua part berikutnya: narator/protagonis, lokasi utama, objek teror, aturan gangguan, dan cliffhanger yang bisa dilanjutkan.",
        "Jangan membuat part 1 terasa seperti cerita selesai. Simpan misteri utama agar part 2 sampai tamat tetap bisa menyambung dari kejadian yang sama."
      ].join("\n");
  const avoid = memory.recent.length
    ? [
        "Jangan ulangi judul, lokasi utama, twist, atau pola cerita berikut:",
        ...memory.recent.map((story) => `- ${story.title}: ${story.logline}`)
      ].join("\n")
    : "Belum ada riwayat cerita, tetap buat plot yang spesifik dan tidak generik.";
  return [
    "Buat rencana 1 video short sebagai bagian dari 1 episode cerita mistis vertikal bahasa Indonesia.",
    "Konten harus original, cinematic, tidak gore, tidak memakai figur publik nyata, dan cocok untuk YouTube Shorts, Facebook Reels, Instagram Reels.",
    "Tulis sebagai storyteller horror yang sedang menceritakan pengalaman pribadi secara live. Jangan terdengar seperti sinopsis, berita, atau instruksi produksi.",
    "Bayangkan naratornya manusia biasa yang takut tapi mencoba tetap bicara pelan ke penonton. Narasi harus punya rasa hadir di lokasi.",
    "Cerita harus membuat penonton merasa ada sesuatu yang salah sejak awal, lalu rasa takutnya naik pelan sampai ujung part.",
    ...narrationStyleRules,
    "Kembalikan JSON valid saja dengan shape:",
    "{ title, logline, hook, ending, episode:{ title, totalParts, currentPart, partTitle, arcSummary, partOutline:[{ part, title, summary, cliffhanger }] }, scenes:[{ index, durationSec, narration, screenText, imagePrompt, transition, effect, soundDesign }] }",
    "Episode besar harus punya outline sesuai Total part, minimal 7 part dan maksimal 13 part. Script scenes hanya untuk Current part.",
    "Durasi video current part harus 1 sampai 2 menit, dan jangan melewati durasi yang diminta.",
    `Total narasi current part sekitar ${words.min}-${words.max} kata agar TTS terdengar santai, punya jeda, dan tidak dipaksa dipercepat.`,
    "Hook harus langsung memancing rasa penasaran, tetapi narration scene 1 tetap mulai dari kejadian, bukan promosi.",
    "Setiap narration harus terasa seperti ucapan yang bisa direkam langsung: ada rasa spontan, tapi tetap jelas dan tidak bertele-tele.",
    "Bayangkan semua narration akan digabung menjadi satu audio TTS. Karena itu alurnya harus nyambung, tanpa lompatan bahasa yang terasa ditempel.",
    "Jangan tulis kalimat seperti: bersambung, akan berlanjut, lanjut di part berikutnya, tunggu part berikutnya, atau summary penutup. Akhiri part dengan beat cerita natural.",
    "Setiap scene wajib punya momen visual berbeda, supaya gambar tidak kembar.",
    ...visualVarietyRules,
    "ScreenText harus pendek, seperti judul beat visual, bukan kalimat panjang.",
    `Detail tokoh utama hanya untuk kontinuitas visual di imagePrompt saat skrip benar-benar butuh orang: ${input.protagonistProfile}.`,
    "Detail tokoh seperti umur, rambut, wajah, jaket, kaos, celana, sepatu, HP, dan senter tidak boleh muncul di narration, hook, logline, ending, screenText, atau part outline.",
    `Kalau narration menyebut tokoh, pakai gaya natural seperti: '${input.protagonistName} berada di depan sumur tua' atau '${input.protagonistName} menahan napas di lorong gelap'.`,
    "Visual harus mengikuti skrip, bukan memaksa tokoh muncul. Kalau adegan berupa suara, benda, lorong, sumur, pintu, HP, sawah, refleksi, atau bayangan, imagePrompt harus berupa POV/objek/suasana tanpa wajah dan tanpa badan penuh.",
    "Jangan menambahkan sosok manusia, hantu berbentuk manusia, atau figur orang tambahan kecuali skrip eksplisit menyebut ada sosok terlihat. Kalau ada orang terlihat, gunakan hanya karakter yang disebut dalam skrip.",
    "Untuk video 8 scene, maksimal 2 scene boleh menampilkan tokoh utama secara jelas. Sisanya harus insert shot/POV/establishing shot. Kalau tokoh utama muncul, imagePrompt wajib menyebut nama, umur, outfit, smartphone, dan senter kecil yang sama.",
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
    continuity,
    existingOutline,
    avoid,
    "Setiap imagePrompt harus detail dan konsisten dengan visual style ini:",
    visualPromptSuffix
  ].join("\n");
}

function narrationWordTarget(durationSec) {
  const seconds = clamp(Number(durationSec || 60), 45, 115);
  return {
    min: Math.max(70, Math.round(seconds * 1.45)),
    max: Math.max(95, Math.round(seconds * 2.0))
  };
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
  const selectedScenes = scenes.slice(0, input.sceneCount);
  const characterSceneIndexes = selectCharacterSceneIndexes(selectedScenes, input);
  return {
    title,
    logline: sanitizeNarrationForSpeech(stripContinuationLanguage(cleanText(plan?.logline || fallback.logline, 240)), input),
    hook: sanitizeNarrationForSpeech(stripContinuationLanguage(cleanText(plan?.hook || fallback.hook, 240)), input),
    ending: sanitizeNarrationForSpeech(stripContinuationLanguage(cleanText(plan?.ending || fallback.ending, 240)), input),
    episode,
    scenes: selectedScenes.map((scene, index) => normalizeScene({
      ...scene,
      durationSec: durations[index] || scene.durationSec
    }, index, input, {
      characterShotAllowed: characterSceneIndexes.has(index)
    }))
  };
}

function normalizeScene(scene, index, input, options = {}) {
  const durationSec = clamp(Number(scene.durationSec || Math.round(input.durationSec / input.sceneCount)), 3, 15);
  const screenText = normalizeScreenText(scene.screenText, scene, input, index);
  return {
    index: index + 1,
    durationSec,
    narration: sanitizeNarrationForSpeech(stripContinuationLanguage(cleanText(scene.narration || fallbackNarration(scene, input, index), 700)), input),
    screenText,
    imagePrompt: enhancePrompt([screenText, scene.narration, scene.imagePrompt].filter(Boolean).join(" "), input, index, options),
    transition: cleanText(scene.transition || transitions[index % transitions.length], 80),
    effect: cleanText(scene.effect || "slow zoom, subtle film grain, dark vignette", 120),
    soundDesign: cleanText(scene.soundDesign || "low drone, faint room tone", 120)
  };
}

function sanitizeNarrationForSpeech(value, input) {
  const name = cleanText(input.protagonistName || "Andi", 40) || "Andi";
  const descriptiveFragment = /\b(pria|wanita|laki-laki|perempuan|indonesia|berusia|usia|umur|\d{1,2}\s*tahun|rambut|wajah|muka|ekspresi|jaket|denim|kaos|baju|celana|cargo|sneakers|sepatu|outfit|berjaket|berkaos|berbaju|bercelana|memakai|mengenakan|membawa\s+(?:smartphone|ponsel|hp|senter)|smartphone|ponsel|hp|senter kecil)\b/i;
  let text = cleanText(value || "", 900)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      if (!new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(sentence)) return sentence;
      const parts = sentence.split(/,\s*/);
      if (parts.length <= 1) return sentence;
      const kept = [parts[0], ...parts.slice(1).filter((part) => !descriptiveFragment.test(part))];
      return kept.join(", ");
    })
    .join(" ");

  const namePattern = escapeRegExp(name);
  text = text
    .replace(new RegExp(`\\b${namePattern}\\s*,\\s*(?:pria|wanita|laki-laki|perempuan)(?:\\s+Indonesia)?\\s*(?:\\d{1,2}\\s*tahun)?\\s*,?\\s*`, "gi"), `${name} `)
    .replace(/\b(?:pria|wanita|laki-laki|perempuan)\s+(?:Indonesia\s+)?\d{1,2}\s*tahun\b/gi, "")
    .replace(/,\s*(?:rambut|wajah|muka|ekspresi|jaket|denim|kaos|baju|celana|cargo|sneakers|sepatu|outfit|berjaket|berkaos|berbaju|bercelana|memakai|mengenakan|membawa\s+(?:smartphone|ponsel|hp|senter)|smartphone|ponsel|hp|senter kecil)[^,.]*/gi, "")
    .replace(new RegExp(`\\b${namePattern}\\s*,\\s*`, "gi"), `${name} `)
    .replace(new RegExp(`\\b${namePattern}\\s+(?:mengeluarkan|mengangkat|mengarahkan)\\s+(?:smartphone|ponsel|hp)(?:-nya)?\\s*,\\s*`, "gi"), `${name} `)
    .replace(/\b(?:memegang|membawa|mempersiapkan|menggenggam erat|menggenggam)\s+(?:smartphone|ponsel|hp)(?:-nya)?(?:\s+dan\s+senter\s+kecil(?:nya)?)?,?\s*/gi, "")
    .replace(/\bsenter\s+kecil(?:nya)?\b/gi, "senter")
    .replace(/\bsmartphone(?:-nya)?\b/gi, "HP")
    .replace(/\b(memanggil|merekam|melihat|menatap|mendengar|menyentuh)-nya\b/gi, "$1nya")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .trim();

  return text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enhancePrompt(prompt, input, index, options = {}) {
  const motif = themeMotif(input.theme, index);
  const requestedBase = prompt || `${motif}, tense quiet horror scene`;
  const anchor = visualAnchor(input, requestedBase, index);
  const forceAtmospheric = !options.characterShotAllowed || avoidsVisibleCharacter(requestedBase);
  const base = forceAtmospheric
    ? `${anchor}, ${visualFocusFromScene(requestedBase, input, index)}, atmospheric insert shot that follows the script mood, focus on location, object clue, light, shadow, reflection, phone glow, door, window, vehicle interior, or moving object`
    : `${anchor}, ${requestedBase}`;
  const direction = forceAtmospheric
    ? "atmospheric or object-focused insert shot, no visible person, no face, no full body"
    : chooseShotDirection(base, input, index);
  const characterRule = forceAtmospheric
    ? "no visible protagonist, no extra human figure, no human-shaped ghost; imply the scene only through flashlight beam, phone glow, footprints, open door, abstract shadow, reflection, or object clue"
    : `character continuity: if ${input.protagonistName} appears, use this exact profile: ${input.protagonistProfile}; otherwise keep the frame atmospheric or object-focused and do not force a person into the frame`;
  return [
    base,
    `composition direction: ${direction}`,
    characterRule,
    `visual variety anchor for scene ${index + 1}: ${anchor}`,
    "if a well appears, keep any human silhouette beside the well or reflected safely on water, never inside the well",
    visualPromptSuffix
  ].join(", ");
}

function visualAnchor(input, prompt, index) {
  const text = `${input.idea || ""} ${input.episodeTitle || ""} ${prompt || ""}`.toLowerCase();
  if (/\bangkot|mobil|sopir|halte|spion|penumpang|jalan\b/i.test(text)) {
    return [
      "empty angkot at a lonely roadside stop",
      "wet money and a trembling hand near the dashboard",
      "fogged rear-view mirror with a dark back seat reflection",
      "yellow street lamp over a looping village road",
      "close-up of an old route sticker and phone map glow",
      "shadow-filled passenger bench seen from the driver's POV"
    ][index % 6];
  }
  if (/\bkos|kontrakan|kamar|lorong|pintu\b/i.test(text)) {
    return [
      "narrow Indonesian boarding house corridor",
      "room key and chipped door number close-up",
      "half-open shared kitchen door in weak neon light",
      "phone flashlight sweeping across cracked floor tiles",
      "window reflection at the end of a silent hallway",
      "dark doorway with sandals placed too neatly outside"
    ][index % 6];
  }
  if (/\bgunung|pendaki|tenda|hutan|jalur|peluit\b/i.test(text)) {
    return [
      "misty mountain trail between wet trees",
      "small tent under dim flashlight glow",
      "muddy footprints beside hiking boots",
      "close-up of a whistle hanging from a backpack",
      "cold camp stove and dying ember light",
      "tree line silhouette behind thick fog"
    ][index % 6];
  }
  if (/\bpesan suara|nomor|hp|ibu|pemakaman|rumah keluarga\b/i.test(text)) {
    return [
      "phone screen with incoming voice message glow",
      "family hallway after a funeral with dim lamp",
      "locked bedroom door and fallen photo frame",
      "close-up of old drawer holding a dead phone",
      "melati flowers scattered near a threshold",
      "silent living room seen through a doorway"
    ][index % 6];
  }
  return motifByIndex(input.theme, index);
}

function selectCharacterSceneIndexes(scenes, input) {
  const name = cleanText(input.protagonistName || "Andi", 40).toLowerCase();
  const candidates = scenes
    .map((scene, index) => ({ scene, index, score: characterNeedScore(scene, name) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return new Set(candidates.slice(0, 2).map((item) => item.index));
}

function characterNeedScore(scene, name) {
  const text = `${scene.narration || ""} ${scene.screenText || ""} ${scene.imagePrompt || ""}`.toLowerCase();
  if (avoidsVisibleCharacter(text)) return 0;
  let score = 0;
  if (name && text.includes(name)) score += 3;
  if (/\b(wajah|ekspresi|berdiri|menatap|berjalan|mendekat|mundur|berlari|memegang|menggenggam|mengangkat|menyentuh)\b/i.test(text)) score += 2;
  if (/\b(pria|tokoh utama|protagonist|karakter)\b/i.test(text)) score += 1;
  if (/\b(pov|layar hp|smartphone|senter|cahaya|bayangan|refleksi|pintu|jendela|sumur|kursi|lantai|jejak|objek)\b/i.test(text)) score -= 1;
  return Math.max(0, score);
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

function avoidsVisibleCharacter(value) {
  return /\b(tanpa tokoh|tanpa orang|tanpa manusia|no visible person|no person|no human|without person|without people)\b/i.test(String(value || ""));
}

function normalizeScreenText(value, scene, input, index) {
  const text = stripContinuationLanguage(cleanText(value || "", 64));
  if (text && !/^scene\s+\d+$/i.test(text)) return text;
  return titleFromFocus(visualFocusFromScene(`${scene.imagePrompt || ""} ${scene.narration || ""}`, input, index));
}

function visualFocusFromScene(value, input, index) {
  const text = cleanText(value || "", 900).toLowerCase();
  const motifs = [
    ["sumur", "sumur tua dan permukaan air gelap"],
    ["jendela", "jendela retak dan pantulan samar"],
    ["kaca", "kaca retak dengan cahaya senter"],
    ["kursi", "kursi kosong yang bergeser sendiri"],
    ["pintu", "pintu tua setengah terbuka"],
    ["hp", "layar HP menyala dalam gelap"],
    ["smartphone", "layar smartphone menyala dalam gelap"],
    ["senter", "cahaya senter menyapu lantai tua"],
    ["sawah", "sawah gelap berkabut di luar rumah"],
    ["lorong", "lorong rumah tua yang gelap"],
    ["bayangan", "bayangan samar di dinding retak"],
    ["refleksi", "refleksi samar di permukaan air"]
  ];
  const found = motifs.find(([keyword]) => text.includes(keyword));
  return found?.[1] || themeMotif(input.theme, index);
}

function titleFromFocus(value) {
  const text = cleanText(value || "Bayangan di ruang gelap", 64);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fallbackNarration(scene, input, index) {
  const focus = cleanText(scene.screenText || themeMotif(input.theme, index), 80).toLowerCase();
  const lines = [
    `Aku mengarahkan senter ke ${focus}. Udara langsung dingin, seperti ada yang baru saja lewat di depanku.`,
    `${focus} itu diam saja, tapi rasanya seperti sedang menunggu aku mendekat.`,
    `${input.protagonistName} menahan napas. Dari arah ${focus}, terdengar suara kecil yang tidak mungkin berasal dari angin.`
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
    arcSummary: sanitizeNarrationForSpeech(cleanText(source.arcSummary || fallback?.arcSummary || "Satu episode mistis panjang yang dibagi menjadi beberapa part short.", 420), input),
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
      summary: sanitizeNarrationForSpeech(cleanText(item.summary || defaultPartSummary(part, input), 220), input),
      cliffhanger: sanitizeNarrationForSpeech(stripContinuationLanguage(cleanText(item.cliffhanger || defaultPartCliffhanger(part, input), 180)), input)
    };
  });
  return items;
}

function defaultPartSummary(part, input) {
  const focus = input.theme === "rumah" ? "rumah kosong, sumur, dan jendela gelap" : "gangguan utama";
  if (part === input.totalParts) return `Misteri ${focus} mencapai titik akhir dan semua tanda dari part sebelumnya kembali menyatu.`;
  return `Gangguan dari ${focus} makin dekat, meninggalkan petunjuk baru yang membuat tokoh utama sulit mundur.`;
}

function defaultPartCliffhanger(part, input) {
  if (part === input.totalParts) return "Malam itu akhirnya memberi jawaban, tapi tidak semuanya bisa dibawa pulang.";
  const beats = [
    "Suara kecil terdengar dari tempat yang tadi kosong.",
    "Bayangan di jendela bergerak sebelum lampu padam.",
    "Rekaman memutar suara yang belum pernah diucapkan.",
    "Pintu tua terbuka pelan dari sisi dalam.",
    "Jejak basah muncul dan mengarah kembali ke sumur.",
    "Nama tokoh utama terdengar dari ruang yang terkunci."
  ];
  return beats[(part - 1) % beats.length];
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
      cliffhanger: defaultPartCliffhanger(part, input)
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

function motifByIndex(theme, index) {
  return themeMotif(theme, index);
}

function normalizeKey(value) {
  return cleanText(value || "", 120).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
