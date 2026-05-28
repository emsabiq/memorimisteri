import { config, ensureProjectDirs } from "./config.js";
import { pathToFileURL } from "node:url";
import { generateFullStory } from "./pipeline.js";
import { absolutizeGeneratedUrls, publicBaseUrl, remoteEnabled, uploadPublicSite, uploadStateFiles, uploadStoryAssets, waitForPublicAsset } from "./remote.js";
import { publishToSocials } from "./social.js";
import { listStories, saveStories, saveStory } from "./storage.js";
import { nowIso } from "./util.js";

ensureProjectDirs();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await uploadNextPart();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.skipped) process.exitCode = 1;
}

export async function uploadNextPart() {
  if (!config.automation.dailyPartUpload) {
    return { ok: false, skipped: true, reason: "DAILY_PART_UPLOAD_ENABLED=false" };
  }

  await importRemoteStories();
  let stories = await listStories();
  const forceNewPart = truthyEnv("MISTIS_FORCE_NEW_PART");
  const resetEpisodeState = forceNewPart && forcedPartNumber() === 1 && truthyEnv("MISTIS_RESET_EPISODE_STATE");
  if (resetEpisodeState) {
    console.log("MISTIS_RESET_EPISODE_STATE=true, clearing local imported story state before generating a clean part 1.");
    await saveStories([]);
    stories = [];
  }
  const dueRetry = stories.find((story) => story.status === "rendered" && story.publish?.state === "failed" && isDue(story.publish.nextAttemptAt) && isPublishReady(story));
  if (!forceNewPart && !dueRetry && uploadedToday(stories)) {
    return { ok: false, skipped: true, reason: "Part hari ini sudah uploaded. Retry gagal tetap akan diproses saat due." };
  }
  let candidate = null;
  if (forceNewPart) {
    console.log(`MISTIS_FORCE_NEW_PART=true, generating a fresh part ${forcedPartNumber()} on this runner.`);
    const generated = await generateForcedPart(stories);
    candidate = generated.story;
  } else {
    candidate = dueRetry || nextSequentialStory(stories);
  }
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
      await persistCandidate(candidate, resetEpisodeState);
      await uploadStoryAssets(candidate);
    }

    let videoUrl = candidate.assets?.video?.url || "";
    if (!/^https?:\/\//i.test(videoUrl)) {
      throw new Error("Video belum punya public URL. Isi PUBLIC_BASE_URL dan FTP/SFTP agar Meta bisa fetch video.");
    }
    videoUrl = await waitForPublicAsset(videoUrl, { contentType: "video", minimumBytes: 1024 });
    candidate.assets.video.url = videoUrl;
    if (candidate.assets?.images?.[0]?.url) {
      candidate.assets.images[0].url = await waitForPublicAsset(candidate.assets.images[0].url, { contentType: "image", minimumBytes: 256 }).catch(() => candidate.assets.images[0].url);
    }
    if (candidate.assets?.thumbnail?.url) {
      candidate.assets.thumbnail.url = await waitForPublicAsset(candidate.assets.thumbnail.url, { contentType: "image", minimumBytes: 256 }).catch(() => candidate.assets.thumbnail.url);
    }
    await persistCandidate(candidate, resetEpisodeState);
    if (remoteEnabled()) await uploadStateFiles();

    const published = await publishToSocials({
      videoUrl,
      title: candidate.title,
      description: socialDescription(candidate),
      coverUrl: candidate.assets?.thumbnail?.url || candidate.assets?.images?.[0]?.url || "",
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
    await persistCandidate(candidate, resetEpisodeState);
    if (remoteEnabled()) await uploadStateFiles();
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
    await persistCandidate(candidate, resetEpisodeState);
    if (remoteEnabled()) {
      await uploadStateFiles().catch((syncError) => {
        console.warn(`State remote belum tersinkron setelah upload gagal: ${syncError.message}`);
      });
    }
    return { ok: false, storyId: candidate.id, title: candidate.title, part: partKey(candidate), error: error.message, nextAttemptAt: candidate.publish.nextAttemptAt };
  }
}

async function persistCandidate(candidate, resetEpisodeState) {
  if (resetEpisodeState) {
    await saveStories([candidate]);
    return candidate;
  }
  return saveStory(candidate);
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
  const active = findActiveEpisode(stories);
  const generatedIdea = active ? active.idea : randomEpisodeSeed(stories);
  const totalParts = active?.totalParts || generatedIdea.totalParts;
  const partNumber = active?.nextPart || 1;
  const input = {
    idea: process.env.MISTIS_IDEA || generatedIdea.idea,
    episodeTitle: active?.title || "",
    protagonistName: process.env.MISTIS_PROTAGONIST_NAME || generatedIdea.protagonistName,
    protagonistProfile: process.env.MISTIS_PROTAGONIST_PROFILE || generatedIdea.protagonistProfile,
    theme: process.env.MISTIS_THEME || generatedIdea.theme,
    tone: process.env.MISTIS_TONE || generatedIdea.tone,
    durationSec: Number(process.env.MISTIS_DURATION || generatedIdea.durationSec),
    sceneCount: Number(process.env.MISTIS_SCENES || generatedIdea.sceneCount),
    totalParts,
    partNumber,
    imageQuality: process.env.IMAGE_QUALITY || "low",
    imageSize: process.env.IMAGE_SIZE || "1024x1536",
    ttsProvider: process.env.MISTIS_TTS_PROVIDER || "elevenlabs",
    ttsStyle: process.env.MISTIS_TTS_STYLE || generatedIdea.ttsStyle
  };
  return generateFullStory(input, { ttsProvider: input.ttsProvider });
}

async function generateForcedPart(stories) {
  const generatedIdea = randomEpisodeSeed(stories);
  const totalParts = clampPartTotal(process.env.MISTIS_TOTAL_PARTS || generatedIdea.totalParts);
  const partNumber = Math.max(1, Math.min(forcedPartNumber(), totalParts));
  const input = {
    idea: process.env.MISTIS_IDEA || generatedIdea.idea,
    episodeTitle: process.env.MISTIS_EPISODE_TITLE || "",
    protagonistName: process.env.MISTIS_PROTAGONIST_NAME || generatedIdea.protagonistName,
    protagonistProfile: process.env.MISTIS_PROTAGONIST_PROFILE || generatedIdea.protagonistProfile,
    theme: process.env.MISTIS_THEME || generatedIdea.theme,
    tone: process.env.MISTIS_TONE || generatedIdea.tone,
    durationSec: Number(process.env.MISTIS_DURATION || generatedIdea.durationSec),
    sceneCount: Number(process.env.MISTIS_SCENES || generatedIdea.sceneCount),
    totalParts,
    partNumber,
    imageQuality: process.env.IMAGE_QUALITY || "low",
    imageSize: process.env.IMAGE_SIZE || "1024x1536",
    ttsProvider: process.env.MISTIS_TTS_PROVIDER || "elevenlabs",
    ttsStyle: process.env.MISTIS_TTS_STYLE || generatedIdea.ttsStyle
  };
  return generateFullStory(input, { ttsProvider: input.ttsProvider });
}

function findActiveEpisode(stories) {
  const groups = new Map();
  for (const story of stories.filter((item) => item.publish?.state === "uploaded" && isPublishReady(item))) {
    const title = episodeKey(story);
    if (!title) continue;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(story);
  }
  const candidates = [...groups.entries()].map(([title, group]) => {
    const totalParts = clampPartTotal(Math.max(...group.map((story) => Number(story.plan?.episode?.totalParts || story.input?.totalParts || 0))));
    const uploaded = new Set(group
      .filter((story) => story.publish?.state === "uploaded")
      .map((story) => Number(story.plan?.episode?.currentPart || story.input?.partNumber || 0))
      .filter(Boolean));
    let nextPart = 1;
    while (uploaded.has(nextPart) && nextPart < totalParts) nextPart += 1;
    const complete = uploaded.size >= totalParts && uploaded.has(totalParts);
    const newest = Math.max(...group.map((story) => new Date(story.updatedAt || story.createdAt || 0).getTime()).filter(Number.isFinite));
    const base = group[0] || {};
    return {
      title: base.plan?.episode?.title || base.input?.episodeTitle || title,
      totalParts,
      nextPart,
      complete,
      newest,
      idea: {
        idea: base.input?.idea || base.plan?.episode?.arcSummary || base.plan?.logline,
        protagonistName: base.input?.protagonistName || "Aku",
        protagonistProfile: base.input?.protagonistProfile || "",
        theme: base.input?.theme || "rumah",
        tone: base.input?.tone || "seram pelan, natural, seperti cerita pengalaman pribadi follower Memorimisteri",
        durationSec: base.input?.durationSec || 85,
        sceneCount: base.input?.sceneCount || 9,
        ttsStyle: base.input?.ttsStyle || ""
      }
    };
  }).filter((item) => !item.complete);
  return candidates.sort((a, b) => b.newest - a.newest)[0] || null;
}

function randomEpisodeSeed(stories) {
  const themes = ["rumah", "kos", "jalan", "pendaki", "mimpi"];
  const names = ["Raka", "Naya", "Dimas", "Laras", "Ari", "Mira", "Bagas", "Sinta", "Reno", "Tari"];
  const places = [
    "rumah kontrakan belakang pasar yang lampunya menyala sendiri setiap jam dua malam",
    "kos lama di ujung gang yang punya kamar tanpa nomor",
    "jalan kampung dekat kebun tebu yang selalu membuat pengendara kembali ke titik awal",
    "villa kosong dekat hutan pinus yang masih menyimpan pesan suara penyewa sebelumnya",
    "warung tutup di pinggir sawah yang menerima pesanan dari nomor tidak dikenal",
    "jalur pendakian berkabut tempat peluit terdengar dari arah jurang",
    "rumah keluarga setelah pemakaman, ketika suara orang yang sudah tiada masih masuk lewat pesan suara"
  ];
  const fears = [
    "suara ketukan kecil yang makin dekat",
    "bayangan yang muncul duluan di pantulan kaca",
    "pesan suara dari nomor yang sudah tidak aktif",
    "jejak basah yang berhenti tepat di depan tempat tidur",
    "pintu terkunci yang membuka dari sisi dalam",
    "rekaman HP yang memutar suara narator sendiri"
  ];
  const styles = ["bisik tegang", "tenang menahan takut", "voice note tengah malam", "narator pelan sinematik", "cemas tapi jelas"];
  const index = stories.length + new Date().getDate();
  const protagonistName = names[index % names.length];
  const theme = themes[index % themes.length];
  const place = places[index % places.length];
  const fear = fears[(index + 2) % fears.length];
  return {
    idea: `Buat episode serial Memori Misteri original tentang ${protagonistName} yang mengalami gangguan di ${place}. Teror utama dimulai dari ${fear}, lalu setiap part membuka petunjuk baru tanpa kehilangan rasa cerita nyata.`,
    protagonistName,
    protagonistProfile: `${protagonistName}, orang Indonesia dewasa, wajah lelah tapi penasaran, pakaian gelap sederhana, membawa HP dan senter kecil untuk kontinuitas visual`,
    theme,
    tone: "seram pelan, rapi, terasa seperti cerita pengalaman nyata, twist bertahap, tidak gore",
    durationSec: 75 + ((index * 7) % 36),
    sceneCount: 8 + (index % 3),
    totalParts: 7 + (index % 7),
    ttsStyle: styles[index % styles.length]
  };
}

function clampPartTotal(value) {
  const number = Number(value || 10);
  return Math.max(7, Math.min(13, Number.isFinite(number) ? number : 10));
}

function nextSequentialStory(stories) {
  const rendered = stories.filter((story) => story.status === "rendered" && story.assets?.video?.path && story.publish?.state !== "uploaded" && isPublishReady(story));
  const groups = new Map();
  for (const story of stories) {
    const title = episodeKey(story);
    if (!title) continue;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(story);
  }
  return rendered
    .sort(comparePart)
    .find((story) => {
      const group = groups.get(episodeKey(story)) || [];
      return !samePartAlreadyUploaded(group, story) && previousPartsUploaded(group, story);
    });
}

function samePartAlreadyUploaded(group, story) {
  const part = storyPartNumber(story);
  return group.some((item) => item.publish?.state === "uploaded" && isPublishReady(item) && storyPartNumber(item) === part);
}

function previousPartsUploaded(group, story) {
  const part = storyPartNumber(story);
  if (part <= 1) return true;
  const uploaded = new Set(group
    .filter((item) => item.publish?.state === "uploaded" && isPublishReady(item))
    .map((item) => storyPartNumber(item)));
  for (let index = 1; index < part; index += 1) {
    if (!uploaded.has(index)) return false;
  }
  return true;
}

function comparePart(a, b) {
  return episodeKey(a).localeCompare(episodeKey(b)) || storyPartNumber(a) - storyPartNumber(b);
}

function storyPartNumber(story) {
  const value = Number(story.plan?.episode?.currentPart || story.input?.partNumber || 1);
  return Number.isFinite(value) ? value : 1;
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
  return stories.some((story) => story.publish?.state === "uploaded" && isPublishReady(story) && localDateKey(new Date(story.publish.uploadedAt || 0)) === today);
}

function isPublishReady(story) {
  const sceneCount = Number(story.plan?.scenes?.length || story.input?.sceneCount || 0);
  const images = Array.isArray(story.assets?.images) ? story.assets.images : [];
  const finalImages = sceneCount > 0
    && images.length >= sceneCount
    && images.slice(0, sceneCount).every((image) => (image?.path || image?.url) && image.source !== "local-fallback");
  const hasAudio = Boolean(story.assets?.audio?.path || story.assets?.audio?.url);
  const hasVideo = Boolean(story.assets?.video?.path || story.assets?.video?.url);
  const duration = Number(story.assets?.video?.durationSec || 0);
  return Boolean(finalImages && hasAudio && hasVideo && (!duration || duration >= 45));
}

function truthyEnv(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

function forcedPartNumber() {
  const value = Number(process.env.MISTIS_FORCE_PART_NUMBER || process.env.MISTIS_PART_NUMBER || 1);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
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
