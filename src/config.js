import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const runtimeDir = process.env.VERCEL ? path.join("/tmp", "mistis-video") : rootDir;

function clean(value) {
  return String(value || "").trim();
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function bool(value) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (!cleaned) return false;
  return !["0", "false", "no", "off"].includes(cleaned);
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(value) {
  return clean(value).split(",").map((item) => clean(item)).filter(Boolean);
}

const openAiBaseUrl = clean(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/g, "");
const storyApiKey = process.env.OPENAI_API_KEY || "";
const storyBaseUrl = openAiBaseUrl;
const storyModels = listEnv(process.env.OPENAI_STORY_MODEL || "gpt-4.1-mini");

export const paths = {
  rootDir,
  dataDir: path.join(runtimeDir, "data"),
  generatedDir: path.join(runtimeDir, "generated"),
  imageDir: path.join(runtimeDir, "generated", "images"),
  audioDir: path.join(runtimeDir, "generated", "audio"),
  videoDir: path.join(runtimeDir, "generated", "videos"),
  storyboardDir: path.join(runtimeDir, "generated", "storyboards"),
  uploadDir: path.join(runtimeDir, "generated", "submissions"),
  publicDir: path.join(rootDir, "public")
};

export function ensureProjectDirs() {
  for (const [key, dir] of Object.entries(paths)) {
    if (key === "rootDir" || key === "publicDir") continue;
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const config = {
  port: Math.max(1, Math.floor(numberEnv("PORT", 3035))),
  publicBaseUrl: clean(process.env.PUBLIC_BASE_URL),
  story: {
    apiKey: storyApiKey,
    baseUrl: storyBaseUrl,
    model: storyModels[0] || "gpt-4.1-mini",
    models: storyModels.length ? storyModels : ["gpt-4.1-mini"],
    maxCompletionTokens: Math.max(500, Math.floor(numberEnv("STORY_MAX_COMPLETION_TOKENS", 12000))),
    provider: "openai"
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: openAiBaseUrl,
    imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
    imageSize: clean(process.env.IMAGE_SIZE || "1024x1536"),
    imageQuality: clean(process.env.IMAGE_QUALITY || "low"),
    ttsModel: clean(process.env.OPENAI_TTS_MODEL || process.env.TTS_MODEL || "gpt-4o-mini-tts"),
    ttsVoice: clean(process.env.OPENAI_TTS_VOICE || process.env.TTS_VOICE || "shimmer"),
    ttsVoices: clean(process.env.OPENAI_TTS_VOICES || "nova,shimmer,coral,verse,sage,alloy").split(",").map((item) => clean(item)).filter(Boolean),
    ttsMaleVoices: clean(process.env.OPENAI_TTS_MALE_VOICES || "onyx,echo,verse,alloy").split(",").map((item) => clean(item)).filter(Boolean),
    ttsFemaleVoices: clean(process.env.OPENAI_TTS_FEMALE_VOICES || "nova,shimmer,coral,sage").split(",").map((item) => clean(item)).filter(Boolean),
    transcribeModel: clean(process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1"),
    ttsEffectsEnabled: boolEnv("TTS_EFFECTS_ENABLED", true)
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    model: clean(process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2"),
    voiceId: clean(process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku"),
    voiceIds: clean(process.env.ELEVENLABS_VOICE_IDS || process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku").split(",").map((item) => clean(item)).filter(Boolean),
    maleVoiceIds: clean(process.env.ELEVENLABS_MALE_VOICE_IDS || "").split(",").map((item) => clean(item)).filter(Boolean),
    femaleVoiceIds: clean(process.env.ELEVENLABS_FEMALE_VOICE_IDS || process.env.ELEVENLABS_VOICE_IDS || process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku").split(",").map((item) => clean(item)).filter(Boolean)
  },
  pricing: {
    storyInputUsdPer1MTokens: numberEnv("STORY_INPUT_USD_PER_1M_TOKENS", 0.4),
    storyOutputUsdPer1MTokens: numberEnv("STORY_OUTPUT_USD_PER_1M_TOKENS", 1.6),
    ttsUsdPer1MChars: numberEnv("TTS_USD_PER_1M_CHARS", 15),
    elevenlabsTtsUsdPer1KChars: numberEnv("ELEVENLABS_TTS_USD_PER_1K_CHARS", 0.1)
  },
  automation: {
    enabled: boolEnv("AUTOMATION_ENABLED", false),
    youtube: boolEnv("YOUTUBE_UPLOAD_ENABLED", false),
    facebook: boolEnv("FACEBOOK_UPLOAD_ENABLED", false),
    instagram: boolEnv("INSTAGRAM_UPLOAD_ENABLED", false),
    threads: boolEnv("THREADS_UPLOAD_ENABLED", false),
    dailyPartUpload: boolEnv("DAILY_PART_UPLOAD_ENABLED", false),
    retryMinutes: Math.max(1, Math.floor(numberEnv("PART_UPLOAD_RETRY_MINUTES", 15))),
    accountName: clean(process.env.SOCIAL_ACCOUNT_NAME || "memorimisteri")
  },
  github: {
    workflowToken: process.env.MISTIS_GITHUB_WORKFLOW_TOKEN || process.env.GITHUB_WORKFLOW_TOKEN || "",
    repo: clean(process.env.MISTIS_GITHUB_REPO || process.env.GITHUB_REPOSITORY || "emsabiq/memorimisteri"),
    workflowId: clean(process.env.MISTIS_GITHUB_WORKFLOW_ID || "mistis-daily-part.yml"),
    workflowRef: clean(process.env.MISTIS_GITHUB_WORKFLOW_REF || process.env.VERCEL_GIT_COMMIT_REF || "master")
  },
  ftp: {
    driver: clean(process.env.UPLOAD_DRIVER || "auto").toLowerCase(),
    host: clean(process.env.FTP_HOST || process.env.SFTP_HOST),
    port: Math.max(1, Math.floor(numberEnv("FTP_PORT", numberEnv("SFTP_PORT", process.env.SFTP_HOST ? 22 : 21)))),
    user: clean(process.env.FTP_USER || process.env.SFTP_USER),
    password: process.env.FTP_PASSWORD || process.env.SFTP_PASSWORD || "",
    hasPassword: Boolean(process.env.FTP_PASSWORD || process.env.SFTP_PASSWORD),
    remoteDir: clean(process.env.FTP_REMOTE_DIR || process.env.SFTP_REMOTE_DIR || "/public_html/mistis")
  },
  facebook: {
    graphApiVersion: clean(process.env.GRAPH_API_VERSION || "v25.0"),
    pageId: clean(process.env.MISTIS_FACEBOOK_PAGE_ID || process.env.FACEBOOK_PAGE_ID),
    accessToken: process.env.MISTIS_FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "",
    userAccessToken: process.env.MISTIS_FACEBOOK_USER_ACCESS_TOKEN || process.env.FACEBOOK_USER_ACCESS_TOKEN || "",
    mediaType: clean(process.env.FACEBOOK_MEDIA_TYPE || "reel").toLowerCase(),
    videoState: clean(process.env.FACEBOOK_VIDEO_STATE || "PUBLISHED")
  },
  instagram: {
    igUserId: clean(process.env.MISTIS_INSTAGRAM_IG_USER_ID || process.env.INSTAGRAM_IG_USER_ID),
    accessToken: process.env.MISTIS_INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || "",
    shareToFeed: boolEnv("INSTAGRAM_SHARE_TO_FEED", true),
    containerPollSeconds: Math.min(60, Math.max(2, numberEnv("INSTAGRAM_CONTAINER_POLL_SECONDS", 6))),
    containerMaxAttempts: Math.min(180, Math.max(5, numberEnv("INSTAGRAM_CONTAINER_MAX_ATTEMPTS", 90))),
    maxDurationSec: Math.max(1, numberEnv("INSTAGRAM_MAX_DURATION_SECONDS", 90))
  },
  threads: {
    userId: clean(process.env.THREADS_USER_ID),
    accessToken: process.env.THREADS_ACCESS_TOKEN || "",
    graphBaseUrl: clean(process.env.THREADS_GRAPH_BASE_URL || "https://graph.threads.net/v1.0").replace(/\/+$/g, "")
  },
  submissions: {
    minTextChars: Math.max(80, numberEnv("FAN_STORY_MIN_TEXT_CHARS", 250)),
    minAudioSeconds: Math.max(5, numberEnv("FAN_STORY_MIN_AUDIO_SECONDS", 20)),
    maxUploadMb: Math.max(1, numberEnv("FAN_STORY_MAX_UPLOAD_MB", 50))
  }
};

export function publicConfig() {
  return {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    providers: {
      openai: Boolean(config.openai.apiKey),
      story: Boolean(config.story.apiKey),
      storyProvider: config.story.provider,
      storyBaseUrl: config.story.baseUrl.replace(/^https?:\/\//, ""),
      storyModel: config.story.model,
      imageModel: config.openai.imageModel,
      imageSize: config.openai.imageSize,
      imageQuality: config.openai.imageQuality,
      ttsModel: config.openai.ttsModel,
      ttsVoice: config.openai.ttsVoice,
      ttsVoices: config.openai.ttsVoices,
      ttsMaleVoices: config.openai.ttsMaleVoices,
      ttsFemaleVoices: config.openai.ttsFemaleVoices,
      openaiTranscribeModel: config.openai.transcribeModel,
      elevenlabs: Boolean(config.elevenlabs.apiKey),
      elevenlabsModel: config.elevenlabs.model
    },
    automation: config.automation,
    ftp: {
      configured: Boolean(config.ftp.host && config.ftp.user && config.ftp.hasPassword),
      host: config.ftp.host,
      remoteDir: config.ftp.remoteDir
    },
    social: {
      facebookReady: bool(config.facebook.pageId && (config.facebook.accessToken || config.facebook.userAccessToken)),
      instagramReady: bool(config.instagram.igUserId && config.instagram.accessToken),
      threadsReady: bool(config.threads.userId && config.threads.accessToken)
    },
    github: {
      workflowDispatch: Boolean(config.github.workflowToken && config.github.repo && config.github.workflowId),
      repo: config.github.repo,
      workflowId: config.github.workflowId,
      workflowRef: config.github.workflowRef
    },
    submissions: {
      minTextChars: config.submissions.minTextChars,
      minAudioSeconds: config.submissions.minAudioSeconds,
      maxUploadMb: config.submissions.maxUploadMb
    }
  };
}
