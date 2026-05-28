const state = {
  pin: sessionStorage.getItem("mistisPin") || "",
  config: null,
  stories: [],
  submissions: [],
  current: null,
  currentSubmission: null,
  busy: false
};

const els = {
  pinGate: document.querySelector("#pinGate"),
  pinForm: document.querySelector("#pinForm"),
  runtimeStatus: document.querySelector("#runtimeStatus"),
  heroTitle: document.querySelector("#heroTitle"),
  fbLamp: document.querySelector("#fbLamp"),
  igLamp: document.querySelector("#igLamp"),
  threadsLamp: document.querySelector("#threadsLamp"),
  storyCount: document.querySelector("#storyCount"),
  submissionCount: document.querySelector("#submissionCount"),
  todayUpload: document.querySelector("#todayUpload"),
  retryCount: document.querySelector("#retryCount"),
  sourceBadge: document.querySelector("#sourceBadge"),
  runDailyWorkflowBtn: document.querySelector("#runDailyWorkflowBtn"),
  logline: document.querySelector("#logline"),
  flowSteps: document.querySelector("#flowSteps"),
  videoSlot: document.querySelector("#videoSlot"),
  submissionBadge: document.querySelector("#submissionBadge"),
  submissionList: document.querySelector("#submissionList"),
  submissionDetail: document.querySelector("#submissionDetail"),
  studioBadge: document.querySelector("#studioBadge"),
  studioSummary: document.querySelector("#studioSummary"),
  studioGrid: document.querySelector("#studioGrid"),
  episodeBadge: document.querySelector("#episodeBadge"),
  episodeGrid: document.querySelector("#episodeGrid"),
  storyList: document.querySelector("#storyList"),
  automationStatus: document.querySelector("#automationStatus"),
  remoteStatus: document.querySelector("#remoteStatus"),
  providerStatus: document.querySelector("#providerStatus"),
  toast: document.querySelector("#toast")
};

init();

function init() {
  bindEvents();
  if (state.pin) unlock();
}

function bindEvents() {
  els.pinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pin = new FormData(els.pinForm).get("pin");
    sessionStorage.setItem("mistisPin", state.pin);
    await unlock();
  });
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });
  els.runDailyWorkflowBtn?.addEventListener("click", runDailyPartWorkflow);
}

async function unlock() {
  try {
    await loadAll();
    els.pinGate.classList.add("hidden");
    render();
    setInterval(refreshQuietly, 60000);
  } catch (error) {
    sessionStorage.removeItem("mistisPin");
    state.pin = "";
    els.pinGate.classList.remove("hidden");
    toast(error.message);
  }
}

async function refreshQuietly() {
  try {
    await loadAll();
    render();
  } catch {}
}

async function loadAll() {
  const health = await fetchJson("/api/health", { public: true });
  state.config = health.config;
  const [stories, submissions] = await Promise.all([
    fetchJson("/api/stories"),
    fetchJson("/api/submissions")
  ]);
  state.stories = stories.stories || [];
  state.submissions = submissions.submissions || [];
  state.current = state.current
    ? state.stories.find((story) => story.id === state.current.id) || state.stories[0] || null
    : state.stories[0] || null;
}

function render() {
  renderStatus();
  renderMetrics();
  renderCurrent();
  renderInbox();
  renderStudio();
  renderEpisodes();
}

function renderStatus() {
  const cfg = state.config;
  const auto = cfg.automation || {};
  els.runtimeStatus.textContent = auto.dailyPartUpload ? "Auto mode aktif" : "Auto mode standby";
  setLamp(els.fbLamp, cfg.social?.facebookReady && auto.facebook);
  setLamp(els.igLamp, cfg.social?.instagramReady && auto.instagram);
  setLamp(els.threadsLamp, cfg.social?.threadsReady && auto.threads);
  els.automationStatus.textContent = `Upload harian: ${auto.dailyPartUpload ? "aktif" : "mati"}; retry: ${auto.retryMinutes || 15} menit; akun: ${auto.accountName || "memorimisteri"}; workflow manual: ${cfg.github?.workflowDispatch ? "siap" : "belum diset"}.`;
  els.remoteStatus.textContent = cfg.ftp?.configured ? `${cfg.ftp.host} -> ${cfg.ftp.remoteDir}` : "Remote belum lengkap.";
  els.providerStatus.textContent = [
    cfg.providers?.story ? `Cerita: ${cfg.providers?.storyProvider || "provider"} / ${cfg.providers?.storyModel || "-"}` : "Cerita belum aktif",
    cfg.providers?.openai ? "OpenAI image/TTS aktif" : "OpenAI image/TTS belum aktif",
    cfg.providers?.elevenlabs ? "ElevenLabs aktif" : "ElevenLabs fallback dilewati",
    `TTS: ${cfg.providers?.ttsModel || "-"}`
  ].join(" / ");
}

function renderMetrics() {
  els.storyCount.textContent = String(state.stories.length);
  els.submissionCount.textContent = String(state.submissions.length);
  els.submissionBadge.textContent = String(state.submissions.length);
  els.todayUpload.textContent = String(state.stories.filter(uploadedToday).length);
  els.retryCount.textContent = String(state.stories.filter((story) => story.publish?.state === "failed").length);
}

function renderCurrent() {
  const story = state.current;
  if (!story) {
    els.heroTitle.textContent = "Belum ada episode";
    els.logline.textContent = "Workflow akan membuat Season baru saat jadwal berjalan.";
    els.flowSteps.innerHTML = "";
    els.videoSlot.textContent = "Belum ada video.";
    return;
  }
  const season = seasonMeta(story);
  const part = season.current ? `Episode ${season.current}/${season.total}` : "Draft";
  els.heroTitle.textContent = season.episodeTitle || story.title;
  els.sourceBadge.textContent = story.publish?.state === "uploaded" ? "Uploaded" : story.publish?.state === "failed" ? "Retry" : "Rendered";
  els.logline.textContent = [season.title, part, story.plan?.logline].filter(Boolean).join(" - ");
  const totalScenes = story.plan?.scenes?.length || 0;
  const imageCount = story.assets?.images?.length || 0;
  const steps = [
    ["Draft", Boolean(totalScenes), `${totalScenes} scene`],
    ["Gambar", imageCount >= totalScenes && totalScenes > 0, `${imageCount}/${totalScenes}`],
    ["Audio", Boolean(story.assets?.audio?.path || story.assets?.audio?.url), story.input?.ttsProvider || "TTS"],
    ["Upload", story.publish?.state === "uploaded", story.publish?.state || "menunggu"]
  ];
  els.flowSteps.innerHTML = steps.map(([label, done, meta], index) => `
    <div class="flow-step ${done ? "done" : ""}">
      <span>${index + 1}</span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(meta)}</small>
    </div>
  `).join("");
  els.videoSlot.innerHTML = story.assets?.video?.url
    ? `<video controls playsinline src="${escapeAttr(story.assets.video.url)}"></video>`
    : "Video belum tersedia.";
}

function renderInbox() {
  els.submissionList.innerHTML = state.submissions.map((item) => `
    <button type="button" data-id="${item.id}">
      <strong>${escapeHtml(item.title || "Kiriman tanpa judul")}</strong>
      <span>${escapeHtml(item.fanName || "Anonim")} - ${submissionStatus(item)}</span>
    </button>
  `).join("") || `<div class="empty-state">Belum ada kiriman.</div>`;
  els.submissionList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentSubmission = state.submissions.find((item) => item.id === button.dataset.id);
      renderSubmissionDetail();
    });
  });
  if (!state.currentSubmission && state.submissions.length) state.currentSubmission = state.submissions[0];
  renderSubmissionDetail();
}

function renderSubmissionDetail() {
  const item = state.currentSubmission;
  if (!item) {
    els.submissionDetail.innerHTML = `<div class="empty-state">Pilih kiriman untuk review.</div>`;
    return;
  }
  const canTranscribe = !item.text || item.status === "waiting_transcribe";
  const canStory = Boolean(item.text || item.transcript);
  els.submissionDetail.innerHTML = `
    <div class="submission-card">
      <div>
        <strong>${escapeHtml(item.title || "Kiriman follower")}</strong>
        <p>${escapeHtml(item.fanName || "Anonim")} ${item.contact ? `- ${escapeHtml(item.contact)}` : ""}</p>
        <small>${escapeHtml(item.originalFilename || "")}</small>
      </div>
      <div class="submission-actions">
        <button id="transcribeSubmissionBtn" class="secondary" type="button" ${canTranscribe ? "" : "disabled"}>Transcribe</button>
        <button id="storySubmissionBtn" class="primary" type="button" ${canStory ? "" : "disabled"}>Buat episode</button>
      </div>
      <pre>${escapeHtml((item.text || item.transcript || item.note || "Belum ada teks/transkrip.").slice(0, 2400))}</pre>
    </div>
  `;
  document.querySelector("#transcribeSubmissionBtn")?.addEventListener("click", transcribeCurrentSubmission);
  document.querySelector("#storySubmissionBtn")?.addEventListener("click", storyFromCurrentSubmission);
}

function renderEpisodes() {
  const grouped = groupByEpisode(state.stories);
  els.episodeBadge.textContent = `${state.stories.length} episode`;
  els.episodeGrid.innerHTML = [...grouped.entries()].map(([title, stories]) => {
    const total = Math.max(...stories.map((story) => Number(seasonMeta(story).total || 0)), 0);
    const uploaded = stories.filter((story) => story.publish?.state === "uploaded").length;
    const first = stories[0] || {};
    const meta = seasonMeta(first);
    return `
      <article class="part-card">
        <span>${uploaded}/${total || stories.length} uploaded</span>
        <strong>${escapeHtml(title || "Season tanpa judul")}</strong>
        <small>${escapeHtml(meta.arcSummary || first.plan?.logline || "")}</small>
      </article>
    `;
  }).join("") || `<div class="empty-state">Belum ada season.</div>`;
  els.storyList.innerHTML = state.stories.map((story) => `
    <button type="button" data-id="${story.id}">
      <strong>${escapeHtml(seasonMeta(story).episodeTitle || story.title)}</strong>
      <span>${escapeHtml(partLabel(story))} - ${escapeHtml(story.publish?.state || story.status || "draft")}</span>
    </button>
  `).join("");
  els.storyList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.current = state.stories.find((story) => story.id === button.dataset.id);
      selectTab("overview");
      render();
    });
  });
}

async function transcribeCurrentSubmission() {
  if (!state.currentSubmission || state.busy) return;
  await busy("Transcribe kiriman", async () => {
    const data = await fetchJson(`/api/submissions/${state.currentSubmission.id}/transcribe`, { method: "POST" });
    state.currentSubmission = data.submission;
    await loadAll();
    toast("Transkrip siap direview.");
  });
}

async function storyFromCurrentSubmission() {
  if (!state.currentSubmission || state.busy) return;
  await busy("Membuat draft episode", async () => {
    const data = await fetchJson(`/api/submissions/${state.currentSubmission.id}/story`, {
      method: "POST",
      body: JSON.stringify({})
    });
    state.currentSubmission = data.submission;
    state.current = data.story;
    await loadAll();
    toast("Draft episode dari follower siap.");
  });
}

async function runDailyPartWorkflow() {
  if (state.busy) return;
  if (!confirm("Jalankan workflow untuk generate episode berikutnya sekarang? Ini sama seperti jadwal otomatis dan bisa memakai API serta upload sesuai setting workflow.")) return;
  await busy("Menjalankan workflow harian", async () => {
    await fetchJson("/api/workflows/mistis-daily-part", {
      method: "POST",
      body: JSON.stringify({})
    });
    toast("Workflow sudah dikirim ke GitHub Actions.");
  });
}

async function busy(label, fn) {
  state.busy = true;
  toast(label);
  try {
    await fn();
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.public ? {} : { "X-Dashboard-Pin": state.pin })
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function selectTab(id) {
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
}

function setLamp(el, ok) {
  el.classList.toggle("ok", Boolean(ok));
  el.classList.toggle("bad", !ok);
}

function currentSeasonStory() {
  const withOutline = [state.current, ...state.stories].find((story) => {
    const outline = story?.plan?.season?.episodeOutline || story?.plan?.episode?.partOutline;
    return story && Array.isArray(outline) && outline.length;
  });
  return withOutline || state.current || state.stories[0] || null;
}

function normalizeStudioOutline(story, total) {
  const season = story?.plan?.season || {};
  const episode = story?.plan?.episode || {};
  const raw = Array.isArray(season.episodeOutline)
    ? season.episodeOutline
    : Array.isArray(episode.partOutline)
      ? episode.partOutline
      : [];
  return Array.from({ length: total }, (_, index) => {
    const episodeNumber = index + 1;
    const item = raw.find((entry) => Number(entry?.episode || entry?.part || 0) === episodeNumber) || raw[index] || {};
    const storyboards = Array.isArray(item.storyboards) ? item.storyboards.map((beat) => String(beat || "").trim()).filter(Boolean) : [];
    return {
      episode: episodeNumber,
      title: item.title || "",
      summary: item.summary || item.cliffhanger || "",
      storyboards
    };
  });
}

function storiesForSeason(title) {
  const key = normalizeKey(title);
  if (!key) return state.stories;
  return state.stories.filter((story) => normalizeKey(seasonMeta(story).title || story.title) === key);
}

function groupByEpisode(stories) {
  const map = new Map();
  for (const story of stories) {
    const key = seasonMeta(story).title || story.title || "Season";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(story);
  }
  return map;
}

function uploadedToday(story) {
  if (story.publish?.state !== "uploaded" || !story.publish?.uploadedAt) return false;
  return new Date(story.publish.uploadedAt).toDateString() === new Date().toDateString();
}

function partLabel(story) {
  const season = seasonMeta(story);
  return season.current ? `Episode ${season.current}/${season.total || "?"}` : "Draft";
}

function renderStudio() {
  if (!els.studioGrid) return;
  const baseStory = currentSeasonStory();
  if (!baseStory) {
    els.studioBadge.textContent = "Belum ada cerita";
    els.studioSummary.innerHTML = `<div class="empty-state">Belum ada cerita Season. Jalankan generate episode pertama dulu supaya sistem membuat outline 10 episode beserta storyboard.</div>`;
    els.studioGrid.innerHTML = "";
    return;
  }

  const meta = seasonMeta(baseStory);
  const total = Math.max(10, Number(meta.total || 10));
  const outline = normalizeStudioOutline(baseStory, total);
  const seasonStories = storiesForSeason(meta.title);
  const byEpisode = new Map(seasonStories.map((story) => [Number(seasonMeta(story).current || story.input?.partNumber || 0), story]));
  const ready = outline.filter((item) => item.storyboards.length >= 8).length;
  const uploaded = seasonStories.filter((story) => story.publish?.state === "uploaded").length;
  const rendered = seasonStories.filter((story) => Boolean(story.assets?.video?.url || story.assets?.video?.path)).length;
  const completeOutline = outline.length >= total && ready >= total;
  const completeSeason = uploaded >= total;

  els.studioBadge.textContent = completeSeason ? "Season selesai" : completeOutline ? "Cerita siap" : "Outline belum lengkap";
  els.studioSummary.innerHTML = `
    <div>
      <span>Season</span>
      <strong>${escapeHtml(meta.title || "Season tanpa judul")}</strong>
    </div>
    <div>
      <span>Outline</span>
      <strong>${ready}/${total}</strong>
    </div>
    <div>
      <span>Video</span>
      <strong>${rendered}/${total}</strong>
    </div>
    <div>
      <span>Upload</span>
      <strong>${uploaded}/${total}</strong>
    </div>
  `;

  els.studioGrid.innerHTML = outline.map((item) => {
    const story = byEpisode.get(item.episode);
    const storyReady = item.storyboards.length >= 8;
    const videoReady = Boolean(story?.assets?.video?.url || story?.assets?.video?.path);
    const isUploaded = story?.publish?.state === "uploaded";
    const stateLabel = isUploaded ? "Uploaded" : videoReady ? "Video siap" : storyReady ? "Outline siap" : "Butuh storyboard";
    return `
      <article class="studio-card ${isUploaded ? "done" : videoReady ? "ready" : storyReady ? "planned" : "missing"}">
        <span>Episode ${item.episode}/${total}</span>
        <strong>${escapeHtml(item.title || `Episode ${item.episode}`)}</strong>
        <small>${item.storyboards.length} storyboard</small>
        <p>${escapeHtml((item.summary || item.storyboards.slice(0, 2).join(" - ")).slice(0, 180))}</p>
        <em>${escapeHtml(stateLabel)}</em>
      </article>
    `;
  }).join("");
}

function seasonMeta(story) {
  const season = story?.plan?.season || {};
  const episode = story?.plan?.episode || {};
  return {
    title: season.title || episode.title || story?.input?.seasonTitle || story?.input?.episodeTitle || "",
    total: Number(season.totalEpisodes || episode.totalParts || story?.input?.totalParts || 0),
    current: Number(season.currentEpisode || episode.currentPart || story?.input?.partNumber || 0),
    episodeTitle: season.episodeTitle || episode.partTitle || story?.title || "",
    arcSummary: season.arcSummary || episode.arcSummary || ""
  };
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function submissionStatus(item) {
  const map = {
    waiting_transcribe: "Menunggu transcribe",
    ready_for_review: "Siap review",
    ready_for_story: "Siap cerita",
    converted_to_story: "Sudah jadi draft"
  };
  return map[item.status] || item.status || "Baru";
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
