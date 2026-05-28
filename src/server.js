import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import multer from "multer";
import { config, ensureProjectDirs, paths, publicConfig } from "./config.js";
import { createStoryDraft } from "./story-engine.js";
import { generateSceneImage } from "./openai.js";
import { ensureStoryAudio, ensureStoryImages, renderAndPersist } from "./pipeline.js";
import { getStory, listStories, listSubmissions, saveStory, saveSubmission } from "./storage.js";
import { uploadNextPart } from "./run-once.js";
import { approveSubmissionToStory, createSubmissionFromUpload, normalizeRemoteSubmission, storeUploadedFile, transcribeSubmission, validateSubmissionFile } from "./submissions.js";
import { nowIso } from "./util.js";

ensureProjectDirs();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(paths.publicDir));
app.use("/generated", express.static(paths.generatedDir));

const upload = multer({
  dest: path.join(os.tmpdir(), "mistis-submissions"),
  limits: { fileSize: config.submissions.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    try {
      validateSubmissionFile(file);
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  }
});

app.get("/api/health", (_req, res) => {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
  res.json({
    ok: true,
    config: publicConfig(),
    tools: {
      ffmpeg: ffmpeg.status === 0
    }
  });
});

app.use("/api", requireDashboardPin);

app.get("/api/stories", async (_req, res, next) => {
  try {
    res.json({ stories: await listStoriesWithRemote() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/submissions", async (_req, res, next) => {
  try {
    res.json({ submissions: await listSubmissionsWithRemote() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions", upload.single("storyFile"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File cerita wajib diunggah." });
    const file = await storeUploadedFile(req.file);
    const submission = await createSubmissionFromUpload({ file, body: req.body || {} });
    res.json({ submission });
  } catch (error) {
    if (req.file?.path) await fs.rm(req.file.path, { force: true }).catch(() => {});
    next(error);
  }
});

app.post("/api/submissions/:id/transcribe", async (req, res, next) => {
  try {
    res.json({ submission: await transcribeSubmission(req.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/:id/story", async (req, res, next) => {
  try {
    res.json(await approveSubmissionToStory(req.params.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.get("/api/stories/:id", async (req, res, next) => {
  try {
    const story = await getStory(req.params.id);
    if (!story) return res.status(404).json({ error: "Story tidak ditemukan." });
    res.json({ story });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stories", async (req, res, next) => {
  try {
    const story = await createUniqueStory(req.body || {});
    await saveStory(story);
    res.json({ story });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stories/full", async (req, res, next) => {
  try {
    const warnings = [];
    const story = await createUniqueStory(req.body || {});
    await saveStory(story);

    if (config.openai.apiKey) {
      await ensureStoryImages(story, { warnings, strict: true });
      await ensureStoryAudio(story, { warnings });
    } else {
      warnings.push("OPENAI_API_KEY belum aktif, gambar dan suara memakai fallback lokal.");
    }

    await renderAndPersist(story);
    res.json({ story, warnings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stories/:id/images", async (req, res, next) => {
  try {
    const story = await requireStory(req.params.id);
    const limit = Math.max(1, Math.min(Number(req.body?.limit || story.plan.scenes.length), story.plan.scenes.length));
    await ensureStoryImages(story, { limit, strict: true });
    story.updatedAt = nowIso();
    await saveStory(story);
    res.json({ story });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stories/:id/tts", async (req, res, next) => {
  try {
    const story = await requireStory(req.params.id);
    await ensureStoryAudio(story, { force: true, provider: req.body?.provider });
    story.updatedAt = nowIso();
    await saveStory(story);
    res.json({ story });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stories/:id/render", async (req, res, next) => {
  try {
    const story = await requireStory(req.params.id);
    const warnings = [];
    if (req.body?.ensureAssets !== false && config.openai.apiKey) {
      await ensureStoryImages(story, { warnings, strict: true });
      await ensureStoryAudio(story, { warnings, provider: req.body?.provider });
    }
    assertFinalImages(story);
    await renderAndPersist(story);
    res.json({ story, warnings });
  } catch (error) {
    next(error);
  }
});

app.get("/api/publish/status", (_req, res) => {
  res.json({
    enabled: false,
    platforms: {
      youtube: "disabled",
      facebook: "disabled",
      instagram: "disabled"
    },
    reason: "Automation upload belum diaktifkan pada fase ini."
  });
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`Mistis Story Video Studio running at http://localhost:${config.port}`);
    startUploadLoop();
  });
}

export default app;

function startUploadLoop() {
  if (!config.automation.dailyPartUpload) return;
  const intervalMs = Math.max(60_000, config.automation.retryMinutes * 60_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await uploadNextPart();
      if (!result.skipped) console.log(`Daily part upload: ${JSON.stringify(result)}`);
    } catch (error) {
      console.warn(`Daily part upload loop gagal: ${error.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000);
  setInterval(tick, intervalMs);
}

async function listSubmissionsWithRemote() {
  const local = await listSubmissions();
  const remote = await fetchRemoteSubmissions();
  const byId = new Map();
  for (const item of [...remote, ...local]) {
    if (item?.id) byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
  }
  return [...byId.values()].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

async function listStoriesWithRemote() {
  const local = await listStories();
  const remote = await fetchRemoteStories();
  const byId = new Map();
  for (const item of [...remote, ...local]) {
    if (item?.id) byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
  }
  return [...byId.values()].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

async function fetchRemoteStories() {
  if (!config.publicBaseUrl) return [];
  try {
    const url = `${String(config.publicBaseUrl).replace(/\/+$/g, "")}/state/stories.json?v=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function fetchRemoteSubmissions() {
  if (!config.publicBaseUrl) return [];
  try {
    const url = `${String(config.publicBaseUrl).replace(/\/+$/g, "")}/state/submissions.json?v=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    const items = data.map(normalizeRemoteSubmission);
    for (const item of items) await saveSubmission(item);
    return items;
  } catch {
    return [];
  }
}

function requireDashboardPin(req, res, next) {
  const expected = String(process.env.AUTO_DASHBOARD_PIN || "123456").trim();
  const provided = String(req.headers["x-dashboard-pin"] || req.query.pin || "").trim();
  if (!expected || provided === expected) return next();
  res.status(401).json({ error: "PIN dashboard tidak valid." });
}

async function requireStory(id) {
  const story = await getStory(id);
  if (!story) {
    const error = new Error("Story tidak ditemukan.");
    error.status = 404;
    throw error;
  }
  return story;
}

async function createUniqueStory(input) {
  const existingStories = await listStories();
  return createStoryDraft(input, { existingStories });
}

async function ensureStoryImagesOld(story, options = {}) {
  const warnings = options.warnings || [];
  const size = options.size || story.input.imageSize || config.openai.imageSize;
  const quality = options.quality || story.input.imageQuality || config.openai.imageQuality;
  const limit = Math.max(1, Math.min(Number(options.limit || story.plan.scenes.length), story.plan.scenes.length));
  const images = [...(story.assets.images || [])];
  let failures = 0;

  for (const scene of story.plan.scenes.slice(0, limit)) {
    const existing = images.find((item) => item.sceneIndex === scene.index);
    if (existing && existing.source !== "local-fallback") continue;
    try {
      const image = await generateImageWithRetry({ story, scene, size, quality });
      const index = images.findIndex((item) => item.sceneIndex === scene.index);
      if (index >= 0) images.splice(index, 1, image);
      else images.push(image);
      story.assets.images = sortImages(images);
      story.updatedAt = nowIso();
      await saveStory(story);
    } catch (error) {
      failures += 1;
      const message = `Gambar scene ${scene.index} gagal: ${error.message}`;
      if (options.strict) throw new Error(message);
      warnings.push(message);
      if (failures >= 2) break;
    }
  }

  story.assets.images = sortImages(images);
}

async function generateImageWithRetry({ story, scene, size, quality }) {
  try {
    return await generateSceneImage({ storyId: story.id, scene, size, quality });
  } catch (error) {
    const safeScene = {
      ...scene,
      imagePrompt: safePromptForScene(story, scene)
    };
    const image = await generateSceneImage({ storyId: story.id, scene: safeScene, size, quality });
    image.recoveredFrom = error.message;
    return image;
  }
}

function safePromptForScene(story, scene) {
  const character = story.input?.protagonistProfile || "Andi, pria Indonesia muda memakai jaket denim gelap, kaos hitam, celana cargo hitam, membawa smartphone dan senter kecil";
  const sceneIndex = Number(scene.index || 0);
  const atmosphericShots = [
    "wide atmospheric shot with no visible person, focus on the old Indonesian house, rice field mist, doorway, and negative space",
    "object detail shot with no full person, focus on a phone screen, small flashlight beam, old door, cracked window, or well surface",
    "POV flashlight shot, only a hand, phone, or small flashlight may appear, no face required",
    "distant silhouette optional and small in frame, atmosphere and location remain the main subject"
  ];
  const shot = atmosphericShots[sceneIndex % atmosphericShots.length];
  return [
    shot,
    `if the script absolutely requires Andi, show only a small safe distant silhouette with this continuity: ${character}`,
    `scene mood: ${scene.screenText || story.title}`,
    "old empty house near rice field, closed old well nearby only as background object, no person inside the well",
    "moody blue-green night lighting, soft mist, visible main subject, readable silhouette, cinematic phone-screen composition",
    "vertical 9:16, high detail, dark but not underexposed, no text, no logo, no celebrity, no gore, no extra human figures, no human-shaped ghost, no injury, no trapped person, no drowning, no fall, no violence, no self-harm"
  ].join(", ");
}

async function ensureStoryAudioOld(story, options = {}) {
  const warnings = options.warnings || [];
  const requested = String(options.provider || story.input?.ttsProvider || (config.elevenlabs.apiKey ? "elevenlabs" : "openai")).toLowerCase();
  const provider = requested === "elevenlabs" ? "elevenlabs" : "openai";
  if (story.assets.audio?.path && !options.force && String(story.assets.audio.provider || "openai").toLowerCase() === provider) return;
  try {
    const text = narrationTextForTts(story);
    try {
      story.assets.audio = provider === "elevenlabs"
        ? await generateElevenLabsSpeech({ storyId: story.id, text, filenameSuffix: "elevenlabs-female-horror" })
        : await generateSpeech({ storyId: story.id, text, voice: config.openai.ttsVoice, filenameSuffix: "openai-female-horror" });
    } catch (error) {
      if (provider !== "elevenlabs") throw error;
      warnings.push(`ElevenLabs gagal/habis kuota, fallback langsung ke OpenAI: ${error.message}`);
      story.assets.audio = await generateSpeech({ storyId: story.id, text, voice: config.openai.ttsVoice, filenameSuffix: "openai-fallback-after-elevenlabs" });
      story.assets.audio.fallbackFrom = "elevenlabs";
    }
    story.assets.audio.characters = text.length;
    story.input.ttsProvider = story.assets.audio.provider || provider;
    story.updatedAt = nowIso();
    await saveStory(story);
  } catch (error) {
    if (options.strict) throw error;
    warnings.push(`TTS gagal: ${error.message}`);
  }
}

function narrationTextForTts(story) {
  return story.plan.scenes
    .map((scene) => String(scene.narration || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function renderAndPersistOld(story) {
  assertFinalImages(story);
  const rendered = await renderDraftVideo(story);
  story.assets.video = rendered.video;
  const images = [...(story.assets.images || [])];
  for (const image of rendered.fallbackImages || []) {
    if (images.some((item) => item.sceneIndex === image.sceneIndex)) continue;
    images.push(image);
  }
  story.assets.images = sortImages(images);
  story.status = "rendered";
  story.updatedAt = nowIso();
  await saveStory(story);
  return story;
}

function sortImages(images) {
  return [...images].sort((a, b) => Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0));
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
