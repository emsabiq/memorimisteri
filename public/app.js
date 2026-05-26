const state = {
  config: null,
  stories: [],
  current: null,
  busy: false
};

const els = {
  form: document.querySelector("#storyForm"),
  runtimeStatus: document.querySelector("#runtimeStatus"),
  publishStatus: document.querySelector("#publishStatus"),
  storyCount: document.querySelector("#storyCount"),
  storyList: document.querySelector("#storyList"),
  storyTitle: document.querySelector("#storyTitle"),
  sourceBadge: document.querySelector("#sourceBadge"),
  logline: document.querySelector("#logline"),
  imageStatus: document.querySelector("#imageStatus"),
  audioStatus: document.querySelector("#audioStatus"),
  tokenMetric: document.querySelector("#tokenMetric"),
  imageMetric: document.querySelector("#imageMetric"),
  ttsMetric: document.querySelector("#ttsMetric"),
  totalMetric: document.querySelector("#totalMetric"),
  previewHook: document.querySelector("#previewHook"),
  previewText: document.querySelector("#previewText"),
  episodeBadge: document.querySelector("#episodeBadge"),
  episodeGrid: document.querySelector("#episodeGrid"),
  sceneCountBadge: document.querySelector("#sceneCountBadge"),
  sceneGrid: document.querySelector("#sceneGrid"),
  flowSteps: document.querySelector("#flowSteps"),
  videoSlot: document.querySelector("#videoSlot"),
  fullGenerateBtn: document.querySelector("#fullGenerateBtn"),
  fullGenerateTopBtn: document.querySelector("#fullGenerateTopBtn"),
  imageBtn: document.querySelector("#imageBtn"),
  ttsBtn: document.querySelector("#ttsBtn"),
  renderBtn: document.querySelector("#renderBtn"),
  toast: document.querySelector("#toast")
};

init();

async function init() {
  await loadHealth();
  await loadStories();
  bindEvents();
  render();
}

function bindEvents() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createStory(new FormData(els.form));
  });
  els.fullGenerateBtn.addEventListener("click", () => createFullStory(new FormData(els.form)));
  els.fullGenerateTopBtn.addEventListener("click", () => createFullStory(new FormData(els.form)));
  els.imageBtn.addEventListener("click", () => generateImages());
  els.ttsBtn.addEventListener("click", () => generateTts());
  els.renderBtn.addEventListener("click", () => renderVideo());
}

async function loadHealth() {
  const data = await api("/api/health");
  state.config = data.config;
  const provider = state.config.providers.openai ? "OpenAI aktif" : "Offline draft";
  const ffmpeg = data.tools.ffmpeg ? "FFmpeg siap" : "FFmpeg tidak terbaca";
  els.runtimeStatus.textContent = `${provider} - ${ffmpeg}`;
  els.publishStatus.textContent = state.config.automation.enabled ? "Enabled" : "Disabled";
}

async function loadStories() {
  const data = await api("/api/stories");
  state.stories = data.stories || [];
  if (!state.current && state.stories.length) state.current = state.stories[0];
}

async function createStory(formData) {
  setBusy(true, "Membuat draft cerita");
  try {
    const payload = Object.fromEntries(formData.entries());
    const data = await api("/api/stories", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.current = data.story;
    await loadStories();
    toast("Draft cerita siap.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function createFullStory(formData) {
  setBusy(true, "Generate part lengkap: storyboard, gambar, TTS, render");
  try {
    const payload = Object.fromEntries(formData.entries());
    const data = await api("/api/stories/full", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.current = data.story;
    await loadStories();
    const warning = data.warnings?.length ? ` (${data.warnings.length} warning)` : "";
    toast(`Video part selesai${warning}.`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function generateImages() {
  if (!state.current) return toast("Buat draft dulu.");
  if (!state.config.providers.openai) return toast("OPENAI_API_KEY belum diisi.");
  setBusy(true, "Membuat gambar scene");
  try {
    const data = await api(`/api/stories/${state.current.id}/images`, {
      method: "POST",
      body: JSON.stringify({
        limit: state.current.plan.scenes.length,
        size: state.current.input.imageSize,
        quality: state.current.input.imageQuality
      })
    });
    state.current = data.story;
    await loadStories();
    toast("Gambar scene selesai.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function generateTts() {
  if (!state.current) return toast("Buat draft dulu.");
  if (!state.config.providers.openai) return toast("OPENAI_API_KEY belum diisi.");
  setBusy(true, "Membuat TTS");
  try {
    const data = await api(`/api/stories/${state.current.id}/tts`, { method: "POST" });
    state.current = data.story;
    await loadStories();
    toast("TTS selesai.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function renderVideo() {
  if (!state.current) return toast("Buat draft dulu.");
  setBusy(true, "Render video dan lengkapi aset");
  try {
    const data = await api(`/api/stories/${state.current.id}/render`, {
      method: "POST",
      body: JSON.stringify({ ensureAssets: true })
    });
    state.current = data.story;
    await loadStories();
    const warning = data.warnings?.length ? ` (${data.warnings.length} warning)` : "";
    toast(`Video draft selesai${warning}.`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

function render() {
  renderStoryList();
  renderCurrent();
  renderButtons();
}

function renderStoryList() {
  els.storyCount.textContent = String(state.stories.length);
  els.storyList.innerHTML = state.stories.map((story) => `
    <button type="button" data-id="${story.id}">
      <strong>${escapeHtml(story.plan?.episode?.partTitle || story.title)}</strong>
      <span>${escapeHtml(partLabel(story))} - ${new Date(story.updatedAt || story.createdAt).toLocaleString("id-ID")}</span>
    </button>
  `).join("");
  els.storyList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.current = state.stories.find((story) => story.id === button.dataset.id);
      render();
    });
  });
}

function renderCurrent() {
  const story = state.current;
  if (!story) {
    els.episodeBadge.textContent = "0 part";
    els.episodeGrid.innerHTML = "";
    els.sceneGrid.innerHTML = "";
    els.flowSteps.innerHTML = "";
    els.videoSlot.textContent = "Belum ada video";
    return;
  }

  const episode = story.plan.episode || {};
  const episodeLabel = episode.currentPart ? `Part ${episode.currentPart}/${episode.totalParts}` : "";
  els.storyTitle.textContent = episode.partTitle || story.title;
  els.sourceBadge.textContent = story.source === "openai" ? "OpenAI" : "Offline";
  els.logline.textContent = [episode.title, episodeLabel, story.plan.logline].filter(Boolean).join(" - ");
  els.imageStatus.textContent = `Gambar: ${story.assets.images?.length || 0}/${story.plan.scenes.length} scene`;
  els.audioStatus.textContent = story.assets.video?.audio?.startsWith("tts")
    ? "Suara: TTS"
    : story.assets.video?.audio === "local-voice-horror-bed"
      ? "Suara: voice Indonesia lokal + ambience"
    : story.assets.video?.audio === "fallback-horror-bed"
      ? "Suara: ambience horor, TTS Indonesia belum aktif"
      : story.assets.audio?.url
        ? "Suara: TTS siap"
        : "Suara: belum dirender";
  els.previewHook.textContent = story.plan.hook;
  els.previewText.textContent = story.plan.scenes[0]?.screenText || story.title;
  els.tokenMetric.textContent = formatNumber(story.cost.totalTokens);
  els.imageMetric.textContent = formatUsd(story.cost.imageUsd);
  els.ttsMetric.textContent = formatUsd(story.cost.ttsUsd);
  els.totalMetric.textContent = formatUsd(story.cost.totalUsd);
  els.sceneCountBadge.textContent = `${story.plan.scenes.length} scene${episodeLabel ? ` / ${episodeLabel}` : ""}`;
  renderFlowSteps(story);
  renderEpisodeRoadmap(story);

  els.sceneGrid.innerHTML = story.plan.scenes.map((scene) => {
    const image = story.assets.images?.find((item) => item.sceneIndex === scene.index);
    const thumbStyle = image?.url ? `style="background-image:linear-gradient(180deg, transparent, rgba(0,0,0,.74)), url('${image.url}')"` : "";
    return `
      <article class="scene-card">
        <div class="scene-thumb" ${thumbStyle}>
          <strong>${escapeHtml(scene.screenText)}</strong>
        </div>
        <div class="scene-body">
          <small>${scene.durationSec}s / ${escapeHtml(scene.screenText)}</small>
          <p>${escapeHtml(scene.narration)}</p>
          <details class="scene-more">
            <summary>Detail scene</summary>
            <div class="detail-grid">
              <span>Transisi</span><strong>${escapeHtml(scene.transition)}</strong>
              <span>Efek</span><strong>${escapeHtml(scene.effect)}</strong>
              <span>Suara</span><strong>${escapeHtml(scene.soundDesign)}</strong>
            </div>
            <div class="prompt">${escapeHtml(scene.imagePrompt)}</div>
          </details>
        </div>
      </article>
    `;
  }).join("");

  if (story.assets.video?.url) {
    els.videoSlot.innerHTML = `<video controls playsinline src="${story.assets.video.url}"></video>`;
  } else {
    els.videoSlot.textContent = "Video draft belum dirender";
  }
}

function renderFlowSteps(story) {
  const totalScenes = story.plan.scenes.length;
  const imageCount = story.assets.images?.length || 0;
  const hasAudio = Boolean(story.assets.audio?.url || story.assets.audio?.path);
  const hasVideo = Boolean(story.assets.video?.url);
  const steps = [
    ["Draft", Boolean(story.plan?.scenes?.length), `${totalScenes} scene siap`],
    ["Gambar", imageCount >= totalScenes, `${imageCount}/${totalScenes}`],
    ["TTS", hasAudio, hasAudio ? "siap" : "belum"],
    ["Render", hasVideo, hasVideo ? "video siap" : "belum"]
  ];
  els.flowSteps.innerHTML = steps.map(([label, done, meta], index) => `
    <div class="flow-step ${done ? "done" : ""}">
      <span>${index + 1}</span>
      <strong>${label}</strong>
      <small>${meta}</small>
    </div>
  `).join("");
}

function renderEpisodeRoadmap(story) {
  const episode = story.plan.episode || {};
  const outline = episode.partOutline || [];
  els.episodeBadge.textContent = `${outline.length || episode.totalParts || 0} part`;
  const done = completedParts(episode.title);
  els.episodeGrid.innerHTML = outline.map((part) => {
    const isDone = done.has(Number(part.part));
    const isCurrent = Number(part.part) === Number(episode.currentPart);
    return `
      <button type="button" class="part-card ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}" data-part="${part.part}">
        <span>${isDone ? "Selesai" : isCurrent ? "Aktif" : "Siap"}</span>
        <strong>Part ${part.part}: ${escapeHtml(part.title)}</strong>
        <small>${escapeHtml(part.summary || part.cliffhanger || "")}</small>
      </button>
    `;
  }).join("");
  els.episodeGrid.querySelectorAll(".part-card").forEach((button) => {
    button.addEventListener("click", () => selectPartForGeneration(story, button.dataset.part));
  });
}

function completedParts(episodeTitle) {
  const title = String(episodeTitle || "").toLowerCase();
  return new Set(state.stories
    .filter((story) => String(story.plan?.episode?.title || "").toLowerCase() === title)
    .filter((story) => story.status === "rendered" && story.assets?.video?.url)
    .map((story) => Number(story.plan?.episode?.currentPart))
    .filter(Boolean));
}

function selectPartForGeneration(story, partNumber) {
  const values = {
    episodeTitle: story.plan?.episode?.title || story.input?.episodeTitle || "",
    idea: story.input?.idea || "",
    protagonistName: story.input?.protagonistName || "Andi",
    protagonistProfile: story.input?.protagonistProfile || "",
    theme: story.input?.theme || "rumah",
    durationSec: "60",
    partNumber: String(partNumber || 1),
    totalParts: String(story.plan?.episode?.totalParts || story.input?.totalParts || 10),
    sceneCount: String(story.input?.sceneCount || 8),
    imageQuality: story.input?.imageQuality || "low",
    tone: story.input?.tone || ""
  };
  Object.entries(values).forEach(([name, value]) => setFormValue(name, value));
  toast(`Part ${partNumber} siap digenerate.`);
}

function setFormValue(name, value) {
  const field = els.form.elements[name];
  if (field) field.value = value;
}

function partLabel(story) {
  const episode = story.plan?.episode || {};
  return episode.currentPart ? `Part ${episode.currentPart}/${episode.totalParts}` : "Draft";
}

function renderButtons() {
  const hasStory = Boolean(state.current);
  els.fullGenerateBtn.disabled = state.busy;
  els.fullGenerateTopBtn.disabled = state.busy;
  els.imageBtn.disabled = state.busy || !hasStory || !state.config?.providers.openai;
  els.ttsBtn.disabled = state.busy || !hasStory || !state.config?.providers.openai;
  els.renderBtn.disabled = state.busy || !hasStory;
}

function setBusy(value, label = "") {
  state.busy = value;
  if (value && label) toast(label);
  renderButtons();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(3)}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("id-ID");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
