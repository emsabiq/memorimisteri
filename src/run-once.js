import { config, ensureProjectDirs } from "./config.js";
import { pathToFileURL } from "node:url";
import { generateFullStory } from "./pipeline.js";
import { absolutizeGeneratedUrls, publicBaseUrl, remoteEnabled, uploadPublicSite, uploadStoryAssets } from "./remote.js";
import { publishToSocials } from "./social.js";
import { listStories, saveStories, saveStory } from "./storage.js";
import { nowIso } from "./util.js";

ensureProjectDirs();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await uploadNextPart();
  console.log(JSON.stringify(result, null, 2));
}

export async function uploadNextPart() {
  if (!config.automation.dailyPartUpload) {
    return { ok: false, skipped: true, reason: "DAILY_PART_UPLOAD_ENABLED=false" };
  }

  await importRemoteStories();
  const stories = await listStories();
  const dueRetry = stories.find((story) => story.status === "rendered" && story.publish?.state === "failed" && isDue(story.publish.nextAttemptAt));
  if (!dueRetry && uploadedToday(stories)) {
    return { ok: false, skipped: true, reason: "Part hari ini sudah uploaded. Retry gagal tetap akan diproses saat due." };
  }
  let candidate = dueRetry || nextSequentialStory(stories);
  if (!candidate && !dueRetry) {
    const generated = await generateNextSequentialPart(stories);
    candidate = generated.story;
  }
  if (!candidate) return { ok: false, skipped: true, reason: "Tidak ada part rendered yang siap upload berurutan." };

  try {
    if (remoteEnabled()) {
      await uploadPublicSite();
      const uploaded = absolutizeGeneratedUrls(candidate);
      Object.assign(candidate, uploaded);
      await saveStory(candidate);
      await uploadStoryAssets(candidate);
    }

    const videoUrl = candidate.assets?.video?.url || "";
    if (!/^https?:\/\//i.test(videoUrl)) {
      throw new Error("Video belum punya public URL. Isi PUBLIC_BASE_URL dan FTP/SFTP agar Meta bisa fetch video.");
    }

    const published = await publishToSocials({
      videoUrl,
      title: candidate.title,
      description: socialDescription(candidate),
      coverUrl: candidate.assets?.images?.[0]?.url || "",
      durationSec: candidate.assets?.video?.durationSec || 0
    });
    candidate.publish = {
      ...(candidate.publish || {}),
      state: "uploaded",
      uploadedAt: nowIso(),
      result: published,
      errors: {},
      nextAttemptAt: ""
    };
    candidate.updatedAt = nowIso();
    await saveStory(candidate);
    return { ok: true, storyId: candidate.id, title: candidate.title, part: partKey(candidate), published };
  } catch (error) {
    const attempts = Number(candidate.publish?.attempts || 0) + 1;
    candidate.publish = {
      ...(candidate.publish || {}),
      state: "failed",
      attempts,
      lastError: error.message,
      failedAt: nowIso(),
      nextAttemptAt: new Date(Date.now() + config.automation.retryMinutes * 60000).toISOString()
    };
    candidate.updatedAt = nowIso();
    await saveStory(candidate);
    return { ok: false, storyId: candidate.id, title: candidate.title, part: partKey(candidate), error: error.message, nextAttemptAt: candidate.publish.nextAttemptAt };
  }
}

async function importRemoteStories() {
  const base = publicBaseUrl();
  if (!base) return;
  try {
    const response = await fetch(`${base}/state/stories.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const remoteStories = await response.json();
    if (!Array.isArray(remoteStories)) return;
    const localStories = await listStories();
    const byId = new Map(localStories.map((story) => [story.id, story]));
    for (const story of remoteStories) {
      if (story?.id) byId.set(story.id, { ...(byId.get(story.id) || {}), ...story });
    }
    await saveStories([...byId.values()]);
  } catch (error) {
    console.warn(`Remote stories belum bisa diimport: ${error.message}`);
  }
}

async function generateNextSequentialPart(stories) {
  const episodeTitle = process.env.MISTIS_EPISODE_TITLE || process.env.EPISODE_TITLE || "";
  const totalParts = Number(process.env.MISTIS_TOTAL_PARTS || process.env.TOTAL_PARTS || 10);
  const group = stories.filter((story) => {
    if (!episodeTitle) return true;
    return episodeKey(story) === episodeTitle.toLowerCase();
  });
  const completedParts = new Set(group
    .map((story) => Number(story.plan?.episode?.currentPart || story.input?.partNumber || 0))
    .filter(Boolean));
  let partNumber = 1;
  while (completedParts.has(partNumber) && partNumber < totalParts) partNumber += 1;

  const input = {
    idea: process.env.MISTIS_IDEA || "Cerita mistis serial dari follower Memorimisteri tentang kejadian aneh yang awalnya kecil, lalu makin dekat dan sulit dijelaskan.",
    episodeTitle: episodeTitle || process.env.MISTIS_DEFAULT_EPISODE || "Memori Misteri Harian",
    protagonistName: process.env.MISTIS_PROTAGONIST_NAME || "Aku",
    protagonistProfile: process.env.MISTIS_PROTAGONIST_PROFILE || "",
    theme: process.env.MISTIS_THEME || "rumah",
    tone: process.env.MISTIS_TONE || "seram pelan, natural, seperti cerita pengalaman pribadi follower Memorimisteri",
    durationSec: Number(process.env.MISTIS_DURATION || 60),
    sceneCount: Number(process.env.MISTIS_SCENES || 8),
    totalParts,
    partNumber,
    imageQuality: process.env.IMAGE_QUALITY || "low",
    imageSize: process.env.IMAGE_SIZE || "1024x1536",
    ttsProvider: process.env.MISTIS_TTS_PROVIDER || "elevenlabs"
  };
  return generateFullStory(input, { ttsProvider: input.ttsProvider });
}

function nextSequentialStory(stories) {
  const rendered = stories.filter((story) => story.status === "rendered" && story.assets?.video?.path && story.publish?.state !== "uploaded");
  const groups = new Map();
  for (const story of stories) {
    const title = episodeKey(story);
    if (!title) continue;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(story);
  }
  return rendered
    .sort(comparePart)
    .find((story) => previousPartsUploaded(groups.get(episodeKey(story)) || [], story));
}

function previousPartsUploaded(group, story) {
  const part = Number(story.plan?.episode?.currentPart || story.input?.partNumber || 1);
  if (part <= 1) return true;
  const uploaded = new Set(group
    .filter((item) => item.publish?.state === "uploaded")
    .map((item) => Number(item.plan?.episode?.currentPart || item.input?.partNumber || 0)));
  for (let index = 1; index < part; index += 1) {
    if (!uploaded.has(index)) return false;
  }
  return true;
}

function comparePart(a, b) {
  return episodeKey(a).localeCompare(episodeKey(b)) || Number(a.plan?.episode?.currentPart || 1) - Number(b.plan?.episode?.currentPart || 1);
}

function episodeKey(story) {
  return String(story.plan?.episode?.title || story.input?.episodeTitle || story.title || "").toLowerCase();
}

function partKey(story) {
  const episode = story.plan?.episode || {};
  return episode.currentPart ? `${episode.title} part ${episode.currentPart}/${episode.totalParts}` : story.title;
}

function isDue(value) {
  if (!value) return true;
  return new Date(value).getTime() <= Date.now();
}

function uploadedToday(stories) {
  const today = localDateKey(new Date());
  return stories.some((story) => story.publish?.state === "uploaded" && localDateKey(new Date(story.publish.uploadedAt || 0)) === today);
}

function localDateKey(date) {
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function socialDescription(story) {
  const episode = story.plan?.episode || {};
  const part = episode.currentPart ? `Part ${episode.currentPart}/${episode.totalParts}` : "";
  return [
    [story.title, part].filter(Boolean).join(" - "),
    story.plan?.hook || story.plan?.logline || "",
    "Cerita mistis serial dari Memorimisteri.",
    "#MemoriMisteri #CeritaSeram #KisahMistis #HorrorIndonesia #ReelsIndonesia"
  ].filter(Boolean).join("\n\n");
}
