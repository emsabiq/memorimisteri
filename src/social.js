import { config } from "./config.js";

function clean(value) {
  return String(value || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const apiError = data?.error || {};
    throw new Error(apiError.message || data.raw || text || `HTTP ${response.status}`);
  }
  return data;
}

function graphUrl(path) {
  return `https://graph.facebook.com/${config.facebook.graphApiVersion}/${path}`;
}

function graphVideoUrl(path) {
  return `https://graph-video.facebook.com/${config.facebook.graphApiVersion}/${path}`;
}

export async function publishToSocials({ videoUrl, title, description, coverUrl, durationSec }) {
  const result = { ok: false, errors: {} };
  if (config.automation.facebook) {
    try {
      result.facebook = await publishToFacebook({ videoUrl, title, description });
    } catch (error) {
      result.errors.facebook = error.message;
    }
  }
  if (config.automation.instagram) {
    try {
      result.instagram = await publishToInstagram({ videoUrl, title, description, coverUrl, durationSec });
    } catch (error) {
      result.errors.instagram = error.message;
    }
  }
  if (config.automation.threads) {
    try {
      result.threads = await publishToThreads({ videoUrl, text: threadsText(title, description) });
    } catch (error) {
      result.errors.threads = error.message;
    }
  }
  result.ok = Boolean(result.facebook?.ok || result.instagram?.ok || result.threads?.ok);
  if (!result.ok && Object.keys(result.errors).length) {
    throw new Error(Object.entries(result.errors).map(([key, value]) => `${key}: ${value}`).join("; "));
  }
  return result;
}

async function resolvePageAccessToken() {
  if (config.facebook.accessToken) return config.facebook.accessToken;
  if (!config.facebook.userAccessToken) throw new Error("Token Facebook belum diisi.");
  const url = new URL(graphUrl("me/accounts"));
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", config.facebook.userAccessToken);
  const data = await fetchJson(url);
  const page = (data.data || []).find((entry) => String(entry.id) === String(config.facebook.pageId));
  if (!page?.access_token) throw new Error("User token Facebook tidak punya akses ke Page target.");
  return page.access_token;
}

async function publishToFacebook({ videoUrl, title, description }) {
  if (!config.facebook.pageId || (!config.facebook.accessToken && !config.facebook.userAccessToken)) {
    throw new Error("FACEBOOK_PAGE_ID dan token belum lengkap.");
  }
  if (!videoUrl) throw new Error("Facebook butuh public video URL.");
  const token = await resolvePageAccessToken();
  if (config.facebook.mediaType === "video") {
    const body = new URLSearchParams({
      access_token: token,
      file_url: videoUrl,
      title: clean(title).slice(0, 100),
      description: clean(description).slice(0, 4900),
      published: String(config.facebook.videoState).toUpperCase() === "PUBLISHED" ? "true" : "false"
    });
    const data = await fetchJson(graphVideoUrl(`${config.facebook.pageId}/videos`), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    return { ok: Boolean(data.id), type: "facebook_video", id: clean(data.id), url: data.id ? `https://www.facebook.com/${data.id}` : "" };
  }

  const startUrl = new URL(graphUrl(`${config.facebook.pageId}/video_reels`));
  startUrl.searchParams.set("access_token", token);
  startUrl.searchParams.set("upload_phase", "start");
  const started = await fetchJson(startUrl, { method: "POST" });
  const uploadUrl = clean(started.upload_url);
  const videoId = clean(started.video_id);
  if (!uploadUrl || !videoId) throw new Error("Facebook tidak mengembalikan upload_url/video_id.");
  await fetchJson(uploadUrl, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_url: videoUrl }
  });
  const finishUrl = new URL(graphUrl(`${config.facebook.pageId}/video_reels`));
  finishUrl.searchParams.set("access_token", token);
  finishUrl.searchParams.set("upload_phase", "finish");
  finishUrl.searchParams.set("video_id", videoId);
  finishUrl.searchParams.set("video_state", config.facebook.videoState || "PUBLISHED");
  finishUrl.searchParams.set("description", clean(description).slice(0, 4900));
  await fetchJson(finishUrl, { method: "POST" });
  return { ok: true, type: "facebook_reel", id: videoId, url: `https://www.facebook.com/reel/${videoId}` };
}

async function publishToInstagram({ videoUrl, title, description, coverUrl, durationSec }) {
  if (!config.instagram.igUserId || !config.instagram.accessToken) throw new Error("INSTAGRAM_IG_USER_ID dan token belum lengkap.");
  if (!videoUrl) throw new Error("Instagram butuh public video URL.");
  if (durationSec && durationSec > config.instagram.maxDurationSec) throw new Error(`Durasi ${durationSec}s melewati batas Instagram ${config.instagram.maxDurationSec}s.`);
  const body = new URLSearchParams({
    access_token: config.instagram.accessToken,
    media_type: "REELS",
    video_url: videoUrl,
    caption: clean(description || title).slice(0, 2200),
    share_to_feed: config.instagram.shareToFeed ? "true" : "false"
  });
  if (coverUrl) body.set("cover_url", coverUrl);
  const created = await fetchJson(graphUrl(`${config.instagram.igUserId}/media`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const creationId = clean(created.id);
  for (let attempt = 1; attempt <= config.instagram.containerMaxAttempts; attempt += 1) {
    const url = new URL(graphUrl(creationId));
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", config.instagram.accessToken);
    const status = await fetchJson(url);
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`Container Instagram gagal: ${status.status || status.status_code}`);
    await sleep(config.instagram.containerPollSeconds * 1000);
  }
  const publishBody = new URLSearchParams({ access_token: config.instagram.accessToken, creation_id: creationId });
  const published = await fetchJson(graphUrl(`${config.instagram.igUserId}/media_publish`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: publishBody
  });
  return { ok: Boolean(published.id), type: "instagram_reel", id: clean(published.id), containerId: creationId };
}

async function publishToThreads({ videoUrl, text }) {
  if (!config.threads.userId || !config.threads.accessToken) throw new Error("THREADS_USER_ID dan THREADS_ACCESS_TOKEN belum lengkap.");
  try {
    return await publishThreadsContainer({ videoUrl, text });
  } catch (error) {
    if (!videoUrl) throw error;
    const fallbackText = clean([text, videoUrl].filter(Boolean).join("\n\n")).slice(0, 500);
    const fallback = await publishThreadsContainer({ videoUrl: "", text: fallbackText });
    return { ...fallback, fallbackFromVideo: error.message };
  }
}

async function publishThreadsContainer({ videoUrl, text }) {
  const body = new URLSearchParams({
    access_token: config.threads.accessToken,
    media_type: videoUrl ? "VIDEO" : "TEXT",
    text: clean(text).slice(0, 500)
  });
  if (videoUrl) body.set("video_url", videoUrl);
  const created = await fetchJson(`${config.threads.graphBaseUrl}/${config.threads.userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const creationId = clean(created.id);
  const published = await fetchJson(`${config.threads.graphBaseUrl}/${config.threads.userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: config.threads.accessToken, creation_id: creationId })
  });
  return { ok: Boolean(published.id), type: videoUrl ? "threads_video" : "threads_text", id: clean(published.id), containerId: creationId };
}

function threadsText(title, description) {
  return [title, clean(description).split("\n").find(Boolean), "#memorimisteri"].filter(Boolean).join("\n\n").slice(0, 500);
}
