import express from "express";
import { spawnSync } from "node:child_process";
import { config, ensureProjectDirs, paths, publicConfig } from "./config.js";
import { createStoryDraft } from "./story-engine.js";
import { generateSceneImage, generateSpeech } from "./openai.js";
import { getStory, listStories, saveStory } from "./storage.js";
import { renderDraftVideo } from "./render.js";
import { nowIso } from "./util.js";

ensureProjectDirs();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(paths.publicDir));
app.use("/generated", express.static(paths.generatedDir));

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

app.get("/api/stories", async (_req, res, next) => {
  try {
    res.json({ stories: await listStories() });
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
    await ensureStoryAudio(story, { force: true });
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
      await ensureStoryAudio(story, { warnings });
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

app.listen(config.port, () => {
  console.log(`Mistis Story Video Studio running at http://localhost:${config.port}`);
});

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

async function ensureStoryImages(story, options = {}) {
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
  const characterShots = [
    `safe medium shot of Andi near the location, ${character}`,
    `distant safe silhouette of Andi with the same outfit and small flashlight, ${character}`
  ];
  const forceAtmospheric = [2, 4, 6].includes(sceneIndex);
  const shot = !forceAtmospheric && sceneIndex % 3 === 2
    ? characterShots[sceneIndex % characterShots.length]
    : atmosphericShots[Number(scene.index || 0) % atmosphericShots.length];
  return [
    shot,
    `scene mood: ${scene.screenText || story.title}`,
    "old empty house near rice field, closed old well nearby only as background object, no person inside the well",
    "moody blue-green night lighting, soft mist, visible main subject, readable silhouette, cinematic phone-screen composition",
    "vertical 9:16, high detail, dark but not underexposed, no text, no logo, no celebrity, no gore, no injury, no trapped person, no drowning, no fall, no violence, no self-harm"
  ].join(", ");
}

async function ensureStoryAudio(story, options = {}) {
  const warnings = options.warnings || [];
  if (story.assets.audio?.path && !options.force) return;
  try {
    const text = story.plan.scenes.map((scene) => scene.narration).join("\n\n");
    story.assets.audio = await generateSpeech({ storyId: story.id, text });
    story.updatedAt = nowIso();
    await saveStory(story);
  } catch (error) {
    if (options.strict) throw error;
    warnings.push(`TTS gagal: ${error.message}`);
  }
}

async function renderAndPersist(story) {
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
