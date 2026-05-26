import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function clean(value) {
  return String(value || "").trim();
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const paths = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  generatedDir: path.join(rootDir, "generated"),
  imageDir: path.join(rootDir, "generated", "images"),
  audioDir: path.join(rootDir, "generated", "audio"),
  videoDir: path.join(rootDir, "generated", "videos"),
  storyboardDir: path.join(rootDir, "generated", "storyboards"),
  publicDir: path.join(rootDir, "public")
};

export function ensureProjectDirs() {
  for (const dir of Object.values(paths)) {
    if (String(dir).includes(rootDir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export const config = {
  port: Math.max(1, Math.floor(numberEnv("PORT", 3035))),
  publicBaseUrl: clean(process.env.PUBLIC_BASE_URL),
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    storyModel: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
    imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
    imageSize: clean(process.env.IMAGE_SIZE || "1024x1536"),
    imageQuality: clean(process.env.IMAGE_QUALITY || "low"),
    ttsModel: clean(process.env.TTS_MODEL || "gpt-4o-mini-tts"),
    ttsVoice: clean(process.env.TTS_VOICE || "onyx"),
    ttsEffectsEnabled: boolEnv("TTS_EFFECTS_ENABLED", true)
  },
  pricing: {
    storyInputUsdPer1MTokens: numberEnv("STORY_INPUT_USD_PER_1M_TOKENS", 0.4),
    storyOutputUsdPer1MTokens: numberEnv("STORY_OUTPUT_USD_PER_1M_TOKENS", 1.6),
    ttsUsdPer1MChars: numberEnv("TTS_USD_PER_1M_CHARS", 15)
  },
  automation: {
    enabled: boolEnv("AUTOMATION_ENABLED", false),
    youtube: boolEnv("YOUTUBE_UPLOAD_ENABLED", false),
    facebook: boolEnv("FACEBOOK_UPLOAD_ENABLED", false),
    instagram: boolEnv("INSTAGRAM_UPLOAD_ENABLED", false)
  },
  ftp: {
    host: clean(process.env.FTP_HOST),
    port: Math.max(1, Math.floor(numberEnv("FTP_PORT", 21))),
    user: clean(process.env.FTP_USER),
    hasPassword: Boolean(process.env.FTP_PASSWORD),
    remoteDir: clean(process.env.FTP_REMOTE_DIR || "/public_html/video")
  }
};

export function publicConfig() {
  return {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    providers: {
      openai: Boolean(config.openai.apiKey),
      storyModel: config.openai.storyModel,
      imageModel: config.openai.imageModel,
      imageSize: config.openai.imageSize,
      imageQuality: config.openai.imageQuality,
      ttsModel: config.openai.ttsModel,
      ttsVoice: config.openai.ttsVoice
    },
    automation: config.automation,
    ftp: {
      configured: Boolean(config.ftp.host && config.ftp.user && config.ftp.hasPassword),
      host: config.ftp.host,
      remoteDir: config.ftp.remoteDir
    }
  };
}
