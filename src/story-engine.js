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

export async function createStoryDraft(input) {
  const normalized = normalizeInput(input);
  const promptText = buildPrompt(normalized);
  let plan;
  let source = "offline-template";
  let warning = "";

  if (config.openai.apiKey) {
    try {
      const ai = await requestStoryJson(promptText);
      plan = normalizePlan(ai, normalized);
      source = "openai";
    } catch (error) {
      warning = `OpenAI gagal, pakai draft offline: ${error.message}`;
      plan = fallbackPlan(normalized);
    }
  } else {
    plan = fallbackPlan(normalized);
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
  const durationSec = clamp(Number(input.durationSec || 60), 20, 120);
  const sceneCount = clamp(Number(input.sceneCount || Math.round(durationSec / 8)), 4, 14);
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

function buildPrompt(input) {
  return [
    "Buat rencana video cerita mistis vertikal bahasa Indonesia.",
    "Konten harus original, cinematic, tidak gore, tidak memakai figur publik nyata, dan cocok untuk YouTube Shorts, Facebook Reels, Instagram Reels.",
    "Kembalikan JSON valid saja dengan shape:",
    "{ title, logline, hook, ending, scenes:[{ index, durationSec, narration, screenText, imagePrompt, transition, effect, soundDesign }] }",
    `Ide: ${input.idea}`,
    `Tema: ${input.theme}`,
    `Tone: ${input.tone}`,
    `Durasi total: ${input.durationSec} detik`,
    `Jumlah scene: ${input.sceneCount}`,
    "Setiap imagePrompt harus detail dan konsisten: vertical 9:16, Indonesian horror atmosphere, cinematic lighting, no text in image, no real celebrity, no logo."
  ].join("\n");
}

function normalizePlan(plan, input) {
  const fallback = fallbackPlan(input);
  const scenes = Array.isArray(plan?.scenes) && plan.scenes.length ? plan.scenes : fallback.scenes;
  return {
    title: cleanText(plan?.title || fallback.title, 80),
    logline: cleanText(plan?.logline || fallback.logline, 240),
    hook: cleanText(plan?.hook || fallback.hook, 240),
    ending: cleanText(plan?.ending || fallback.ending, 240),
    scenes: scenes.slice(0, input.sceneCount).map((scene, index) => normalizeScene(scene, index, input))
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
    "realistic atmosphere, moody shadows, soft mist, high detail",
    "no text, no logo, no celebrity, no gore, no distorted hands"
  ].join(", ");
}

function fallbackPlan(input) {
  const perScene = Math.round(input.durationSec / input.sceneCount);
  const scenes = Array.from({ length: input.sceneCount }, (_, index) => {
    const motif = themeMotif(input.theme, index);
    const beats = [
      "Awalnya aku pikir suara itu cuma tetangga lewat. Tapi ketukannya selalu berhenti tepat saat aku menahan napas.",
      "Di layar HP, jam menunjukkan 03:12. Anehnya, notifikasi dari nomor tak dikenal cuma berisi satu kalimat: jangan buka pintu.",
      "Saat aku mengintip dari celah bawah, tidak ada kaki siapa pun. Yang ada hanya bayangan panjang yang bergerak mundur.",
      "Aku coba menyalakan lampu, tapi saklarnya terasa basah. Dari luar, suara itu berubah menjadi bisikan pelan memanggil namaku.",
      "Pagi harinya penjaga bilang kamar sebelah sudah kosong tiga bulan. Tapi malam itu, ada yang menjawab dari balik dinding.",
      "Sejak kejadian itu, setiap jam tiga lewat dua belas, pintuku diketuk tiga kali. Dan sekarang, ketukan itu datang dari dalam kamar."
    ];
    return normalizeScene({
      durationSec: perScene,
      narration: beats[index % beats.length],
      screenText: ["Jam 03:12", "Jangan buka", "Tidak ada kaki", "Namaku dipanggil", "Kamar kosong", "Dari dalam"][index % 6],
      imagePrompt: `${motif}, ${beats[index % beats.length]}`,
      transition: transitions[index % transitions.length],
      effect: index % 2 ? "slow push in, shadow flicker, film grain" : "subtle handheld drift, dark vignette, cold haze",
      soundDesign: index % 2 ? "distant knock, low breath, short silence" : "room tone, faint wind, floor creak"
    }, index, input);
  });

  return {
    title: "Ketukan Jam 03:12",
    logline: "Sebuah ketukan tengah malam berubah menjadi tanda bahwa ada sesuatu yang sudah lama menunggu di kamar sebelah.",
    hook: "Kalau pintumu diketuk jam tiga pagi, jangan langsung dibuka.",
    ending: "Ketukan terakhir bukan dari luar pintu, tapi dari belakangku.",
    scenes
  };
}

function themeMotif(theme, index) {
  const key = themes[theme] ? theme : "kos";
  const list = themes[key];
  return list[index % list.length];
}
