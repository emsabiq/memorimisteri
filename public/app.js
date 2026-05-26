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
  sceneCountBadge: document.querySelector("#sceneCountBadge"),
  sceneGrid: document.querySelector("#sceneGrid"),
  videoSlot: document.querySelector("#videoSlot"),
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
  els.imageBtn.addEventListener("click", () => generateImages());
  els.ttsBtn.addEventListener("click", () => generateTts());
  els.renderBtn.addEventListener("click", () => renderVideo());
}

async function loadHealth() {
  const data = await api("/api/health");
  state.config = data.config;
  const provider = state.config.providers.openai ? "OpenAI aktif" : "Offline draft";
  const ffmpeg = data.tools.ffmpeg ? "FFmpeg siap" : "FFmpeg tidak terbaca";
  els.runtimeStatus.textContent = `${provider} · ${ffmpeg}`;
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
  setBusy(true, "Render video berjalan");
  try {
    const data = await api(`/api/stories/${state.current.id}/render`, { method: "POST" });
    state.current = data.story;
    await loadStories();
    toast("Video draft selesai.");
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
      <strong>${escapeHtml(story.title)}</strong>
      <span>${new Date(story.updatedAt || story.createdAt).toLocaleString("id-ID")}</span>
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
    els.sceneGrid.innerHTML = "";
    els.videoSlot.textContent = "Belum ada video";
    return;
  }

  els.storyTitle.textContent = story.title;
  els.sourceBadge.textContent = story.source === "openai" ? "OpenAI" : "Offline";
  els.logline.textContent = story.plan.logline;
  els.imageStatus.textContent = `Gambar: ${story.assets.images?.length || 0}/${story.plan.scenes.length} scene`;
  els.audioStatus.textContent = story.assets.video?.audio === "tts"
    ? "Suara: TTS"
    : story.assets.video?.audio === "local-voice-horror-bed"
      ? "Suara: voice lokal + ambience"
    : story.assets.video?.audio === "fallback-horror-bed"
      ? "Suara: ambience horor"
      : story.assets.audio?.url
        ? "Suara: TTS siap"
        : "Suara: belum dirender";
  els.previewHook.textContent = story.plan.hook;
  els.previewText.textContent = story.plan.scenes[0]?.screenText || story.title;
  els.tokenMetric.textContent = formatNumber(story.cost.totalTokens);
  els.imageMetric.textContent = formatUsd(story.cost.imageUsd);
  els.ttsMetric.textContent = formatUsd(story.cost.ttsUsd);
  els.totalMetric.textContent = formatUsd(story.cost.totalUsd);
  els.sceneCountBadge.textContent = `${story.plan.scenes.length} scene`;

  els.sceneGrid.innerHTML = story.plan.scenes.map((scene) => {
    const image = story.assets.images?.find((item) => item.sceneIndex === scene.index);
    const thumbStyle = image?.url ? `style="background-image:linear-gradient(180deg, transparent, rgba(0,0,0,.74)), url('${image.url}')"` : "";
    return `
      <article class="scene-card">
        <div class="scene-thumb" ${thumbStyle}>
          <strong>${escapeHtml(scene.screenText)}</strong>
        </div>
        <div class="scene-body">
          <small>${scene.durationSec}s · ${escapeHtml(scene.transition)} · ${escapeHtml(scene.effect)}</small>
          <p>${escapeHtml(scene.narration)}</p>
          <div class="prompt">${escapeHtml(scene.imagePrompt)}</div>
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

function renderButtons() {
  const hasStory = Boolean(state.current);
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
