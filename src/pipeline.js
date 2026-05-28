import { config } from "./config.js";
import { estimateTtsUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateSceneImage, generateSpeech, transcribeAudioCaptions } from "./openai.js";
import { renderDraftVideo } from "./render.js";
import { createStoryDraft } from "./story-engine.js";
import { listStories, saveStory } from "./storage.js";
import { createTitleThumbnail } from "./thumbnail.js";
import { nowIso } from "./util.js";

export async function generateFullStory(input = {}, options = {}) {
  const warnings = [];
  const story = await createStoryDraft(input, { existingStories: await listStories() });
  await saveStory(story);
  console.log(`Estimated paid generation cost before media calls: $${Number(story.cost?.totalUsd || 0).toFixed(5)}`);
  await ensureStoryImages(story, { warnings, strict: true });
  await ensureTitleThumbnail(story, { warnings, strict: true });
  await ensureStoryAudio(story, { warnings, provider: input.ttsProvider || options.ttsProvider, force: true });
  await renderAndPersist(story);
  return { story, warnings };
}

export async function ensureStoryImages(story, options = {}) {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY wajib diisi untuk generate gambar.");
  const warnings = options.warnings || [];
  const size = options.size || story.input.imageSize || config.openai.imageSize;
  const quality = options.quality || story.input.imageQuality || config.openai.imageQuality;
  const limit = Math.max(1, Math.min(Number(options.limit || story.plan.scenes.length), story.plan.scenes.length));
  const images = [...(story.assets.images || [])];

  for (const scene of story.plan.scenes.slice(0, limit)) {
    const existing = images.find((item) => Number(item.sceneIndex) === Number(scene.index));
    if (existing && existing.source !== "local-fallback") continue;
    try {
      const image = await generateImageWithRetry({ story, scene, size, quality });
      const index = images.findIndex((item) => Number(item.sceneIndex) === Number(scene.index));
      if (index >= 0) images.splice(index, 1, image);
      else images.push(image);
      story.assets.images = sortImages(images);
      story.updatedAt = nowIso();
      await saveStory(story);
    } catch (error) {
      const message = `Gambar scene ${scene.index} gagal: ${error.message}`;
      if (options.strict) throw new Error(message);
      warnings.push(message);
    }
  }

  story.assets.images = sortImages(images);
}

export async function ensureTitleThumbnail(story, options = {}) {
  const warnings = options.warnings || [];
  try {
    const thumbnail = await createTitleThumbnail(story);
    if (!thumbnail) throw new Error("Belum ada gambar scene untuk thumbnail.");
    story.assets.thumbnail = thumbnail;
    story.updatedAt = nowIso();
    await saveStory(story);
  } catch (error) {
    const message = `Thumbnail judul gagal: ${error.message}`;
    if (options.strict) throw new Error(message);
    warnings.push(message);
  }
}

export async function ensureStoryAudio(story, options = {}) {
  const warnings = options.warnings || [];
  const requested = String(options.provider || story.input?.ttsProvider || (config.elevenlabs.apiKey ? "elevenlabs" : "openai")).toLowerCase();
  const provider = requested === "elevenlabs" ? "elevenlabs" : "openai";
  if (story.assets.audio?.path && !options.force && String(story.assets.audio.provider || "openai").toLowerCase() === provider) return;

  try {
    const text = narrationTextForTts(story);
    const voice = pickTtsVoice(story, provider);
    const instructions = ttsInstructions(story);
    try {
      story.assets.audio = provider === "elevenlabs"
        ? await generateElevenLabsSpeech({ storyId: story.id, text, voiceId: voice, filenameSuffix: `elevenlabs-${voice}` })
        : await generateSpeech({ storyId: story.id, text, voice, instructions, filenameSuffix: `openai-${voice}` });
    } catch (error) {
      if (provider !== "elevenlabs") throw error;
      warnings.push(`ElevenLabs gagal/habis kuota, fallback langsung ke OpenAI: ${error.message}`);
      const fallbackVoice = pickTtsVoice(story, "openai");
      story.assets.audio = await generateSpeech({ storyId: story.id, text, voice: fallbackVoice, instructions, filenameSuffix: `openai-${fallbackVoice}-fallback-after-elevenlabs` });
      story.assets.audio.fallbackFrom = "elevenlabs";
    }
    story.assets.audio.characters = text.length;
    story.input.ttsProvider = story.assets.audio.provider || provider;
    story.input.ttsVoice = story.assets.audio.voice || story.assets.audio.voiceId || voice;
    story.input.ttsStyle = story.input.ttsStyle || ttsStyleName(story);
    story.cost.ttsUsd = estimateTtsUsd(text.length, story.input.ttsProvider, config.pricing);
    story.cost.totalUsd = Number((Number(story.cost.storyUsd || 0) + Number(story.cost.imageUsd || 0) + Number(story.cost.ttsUsd || 0)).toFixed(5));
    story.assets.captions = await createCaptionTiming(story, warnings);
    story.updatedAt = nowIso();
    await saveStory(story);
  } catch (error) {
    if (options.strict) throw error;
    warnings.push(`TTS gagal: ${error.message}`);
    if (!Array.isArray(options.warnings)) throw error;
  }
}

async function createCaptionTiming(story, warnings) {
  if (!story.assets.audio?.path) return null;
  try {
    const captions = await transcribeAudioCaptions(story.assets.audio.path);
    return {
      ...captions,
      generatedAt: nowIso()
    };
  } catch (error) {
    warnings.push(`Caption timing transcribe gagal, fallback ke scene timing: ${error.message}`);
    return null;
  }
}

function pickTtsVoice(story, provider) {
  const list = provider === "elevenlabs" ? config.elevenlabs.voiceIds : config.openai.ttsVoices;
  const voices = Array.isArray(list) && list.length ? list : [provider === "elevenlabs" ? config.elevenlabs.voiceId : config.openai.ttsVoice];
  const seed = `${story.plan?.episode?.title || story.title || story.id}:${story.plan?.episode?.currentPart || 1}`;
  return voices[Math.abs(hash(seed)) % voices.length];
}

function ttsStyleName(story) {
  const styles = ["bisik tegang", "tenang menahan takut", "voice note tengah malam", "narator pelan sinematik", "cemas tapi jelas"];
  return styles[Math.abs(hash(story.plan?.episode?.title || story.title || story.id)) % styles.length];
}

function ttsInstructions(story) {
  const style = story.input?.ttsStyle || ttsStyleName(story);
  return [
    "Bacakan sepenuhnya dalam Bahasa Indonesia dengan pelafalan Indonesia natural.",
    `Gaya suara: ${style}.`,
    "Terdengar seperti orang Indonesia sedang menceritakan pengalaman mistis sungguhan di ruangan gelap.",
    "Tempo santai dan menahan takut, jangan terlalu cepat.",
    "Baca sebagai satu cerita sambung, bukan potongan scene. Pakai napas natural, jeda tegang, jelas, tidak berlebihan, dan bukan gaya iklan."
  ].join(" ");
}

function hash(value) {
  let result = 0;
  for (const char of String(value || "")) result = ((result << 5) - result) + char.charCodeAt(0);
  return result;
}

export async function renderAndPersist(story) {
  assertFinalImages(story);
  const rendered = await renderDraftVideo(story);
  story.assets.video = rendered.video;
  const images = [...(story.assets.images || [])];
  for (const image of rendered.fallbackImages || []) {
    if (images.some((item) => Number(item.sceneIndex) === Number(image.sceneIndex))) continue;
    images.push(image);
  }
  story.assets.images = sortImages(images);
  story.status = "rendered";
  story.updatedAt = nowIso();
  await saveStory(story);
  return story;
}

export function narrationTextForTts(story) {
  return story.plan.scenes
    .map((scene) => String(scene.narration || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function generateImageWithRetry({ story, scene, size, quality }) {
  try {
    return await generateSceneImage({ storyId: story.id, scene, size, quality });
  } catch (error) {
    const safeScene = { ...scene, imagePrompt: safePromptForScene(story, scene) };
    const image = await generateSceneImage({ storyId: story.id, scene: safeScene, size, quality });
    image.recoveredFrom = error.message;
    return image;
  }
}

function safePromptForScene(story, scene) {
  const character = story.input?.protagonistProfile || "tokoh utama Indonesia membawa HP dan senter kecil";
  return [
    "atmospheric Indonesian horror insert shot, no visible full person, focus on location, object clue, light, shadow, door, window, well surface, or phone glow",
    `if a protagonist is absolutely required, use only a distant safe silhouette with continuity: ${character}`,
    `scene mood: ${scene.screenText || story.title}`,
    "dark but readable blue-green night lighting, cinematic vertical 9:16, no text, no logo, no gore, no injury, no trapped person, no drowning, no fall"
  ].join(", ");
}

function assertFinalImages(story) {
  if (!config.openai.apiKey) return;
  const images = story.assets.images || [];
  const fallback = images.filter((image) => image.source === "local-fallback");
  if (images.length < story.plan.scenes.length || fallback.length) {
    const error = new Error("Gambar belum lengkap/final. Generate gambar dulu sampai semua scene berhasil.");
    error.status = 409;
    throw error;
  }
}

function sortImages(images) {
  return [...images].sort((a, b) => Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0));
}
