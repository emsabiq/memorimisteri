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
    const story = await createStoryDraft(req.body || {});
    await saveStory(story);
    res.json({ story });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stories/:id/images", async (req, res, next) => {
  try {
    const story = await requireStory(req.params.id);
    const size = req.body?.size || story.input.imageSize || config.openai.imageSize;
    const quality = req.body?.quality || story.input.imageQuality || config.openai.imageQuality;
    const limit = Math.max(1, Math.min(Number(req.body?.limit || story.plan.scenes.length), story.plan.scenes.length));
    const images = [...(story.assets.images || [])];
    for (const scene of story.plan.scenes.slice(0, limit)) {
      if (images.some((item) => item.sceneIndex === scene.index)) continue;
      const image = await generateSceneImage({ storyId: story.id, scene, size, quality });
      images.push(image);
    }
    story.assets.images = images;
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
    const text = story.plan.scenes.map((scene) => scene.narration).join("\n\n");
    const audio = await generateSpeech({ storyId: story.id, text });
    story.assets.audio = audio;
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
    const rendered = await renderDraftVideo(story);
    story.assets.video = rendered.video;
    const images = [...(story.assets.images || [])];
    for (const image of rendered.fallbackImages || []) {
      if (images.some((item) => item.sceneIndex === image.sceneIndex)) continue;
      images.push(image);
    }
    story.assets.images = images;
    story.status = "rendered";
    story.updatedAt = nowIso();
    await saveStory(story);
    res.json({ story });
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
