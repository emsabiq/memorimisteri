import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import mammoth from "mammoth";
import { config, paths } from "./config.js";
import { transcribeAudioFile } from "./openai.js";
import { createStoryDraft } from "./story-engine.js";
import { getSubmission, listStories, saveStory, saveSubmission } from "./storage.js";
import { cleanText, createId, nowIso, safeFilename } from "./util.js";

const allowedExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".webm", ".mp4", ".txt", ".md", ".docx"]);

export function validateSubmissionFile(file) {
  const ext = path.extname(file?.originalname || "").toLowerCase();
  if (!allowedExtensions.has(ext)) {
    const error = new Error("File harus rekaman audio/video pendek, .txt/.md, atau .docx.");
    error.status = 400;
    throw error;
  }
}

export async function createSubmissionFromUpload({ file, body }) {
  validateSubmissionFile(file);
  const ext = path.extname(file.originalname || "").toLowerCase();
  const text = await extractText(file.path, ext);
  const durationSec = isMediaExtension(ext) ? await probeDuration(file.path) : 0;
  const normalizedText = cleanText([body?.storyText, text].filter(Boolean).join("\n\n"), 20000);

  if (isMediaExtension(ext) && durationSec < config.submissions.minAudioSeconds) {
    const error = new Error(`Durasi rekaman minimal ${config.submissions.minAudioSeconds} detik.`);
    error.status = 400;
    throw error;
  }
  if (!isMediaExtension(ext) && normalizedText.length < config.submissions.minTextChars) {
    const error = new Error(`Teks cerita minimal ${config.submissions.minTextChars} karakter.`);
    error.status = 400;
    throw error;
  }

  const submission = {
    id: createId("fan"),
    status: normalizedText ? "ready_for_review" : "waiting_transcribe",
    fanName: cleanText(body?.fanName || "Anonim", 80),
    contact: cleanText(body?.contact || "", 120),
    title: cleanText(body?.title || path.basename(file.originalname, ext), 120),
    note: cleanText(body?.note || "", 1000),
    originalFilename: file.originalname,
    file: {
      path: file.path,
      url: `/generated/submissions/${path.basename(file.path)}`,
      ext,
      size: file.size,
      durationSec
    },
    text: normalizedText,
    transcript: "",
    storyId: "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await saveSubmission(submission);
  return submission;
}

export async function transcribeSubmission(id) {
  const submission = await requireSubmission(id);
  await ensureLocalSubmissionFile(submission);
  if (submission.text && submission.status !== "waiting_transcribe") return submission;
  if (!isMediaExtension(submission.file?.ext)) {
    const ext = String(submission.file?.ext || "").toLowerCase();
    const extracted = await extractText(submission.file.path, ext);
    const text = cleanText([submission.text, extracted].filter(Boolean).join("\n\n"), 20000);
    if (text.length < config.submissions.minTextChars) {
      const error = new Error(`Teks cerita terlalu pendek. Minimal ${config.submissions.minTextChars} karakter.`);
      error.status = 409;
      throw error;
    }
    submission.text = text;
    submission.status = "ready_for_review";
    submission.updatedAt = nowIso();
    await saveSubmission(submission);
    return submission;
  }
  const transcript = await transcribeAudioFile(submission.file.path);
  if (transcript.length < config.submissions.minTextChars) {
    const error = new Error(`Transkrip terlalu pendek. Minimal ${config.submissions.minTextChars} karakter.`);
    error.status = 409;
    throw error;
  }
  submission.transcript = transcript;
  submission.text = transcript;
  submission.status = "ready_for_story";
  submission.updatedAt = nowIso();
  await saveSubmission(submission);
  return submission;
}

export function normalizeRemoteSubmission(item = {}) {
  const base = String(config.publicBaseUrl || "").replace(/\/+$/g, "");
  const file = item.file || {};
  const url = String(file.url || "");
  return {
    ...item,
    remote: true,
    file: {
      ...file,
      url: /^https?:\/\//i.test(url) || !base ? url : `${base}${url.startsWith("/") ? url : `/${url}`}`,
      path: file.path || ""
    }
  };
}

export async function approveSubmissionToStory(id, input = {}) {
  const submission = await requireSubmission(id);
  const text = cleanText(submission.text || submission.transcript || input.storyText || "", 20000);
  if (text.length < config.submissions.minTextChars) {
    const error = new Error(`Cerita belum cukup panjang. Minimal ${config.submissions.minTextChars} karakter.`);
    error.status = 409;
    throw error;
  }
  const payload = {
    idea: [
      `Cerita kiriman follower ${submission.fanName}:`,
      text,
      submission.note ? `Catatan: ${submission.note}` : ""
    ].filter(Boolean).join("\n\n"),
    episodeTitle: input.episodeTitle || submission.title || "",
    protagonistName: input.protagonistName || "Aku",
    theme: input.theme || "rumah",
    totalParts: input.totalParts || 10,
    partNumber: input.partNumber || 1,
    durationSec: input.durationSec || 85,
    sceneCount: input.sceneCount || 9,
    imageQuality: input.imageQuality || config.openai.imageQuality,
    tone: input.tone || "seram pelan, terasa seperti cerita nyata dari follower, rapi untuk serial memorimisteri"
  };
  const story = await createStoryDraft(payload, { existingStories: await listStories() });
  story.submission = {
    id: submission.id,
    fanName: submission.fanName,
    title: submission.title,
    sourceFile: submission.file?.url || ""
  };
  await saveStory(story);
  submission.status = "converted_to_story";
  submission.storyId = story.id;
  submission.updatedAt = nowIso();
  await saveSubmission(submission);
  return { submission, story };
}

export async function storeUploadedFile(file) {
  validateSubmissionFile(file);
  await fs.mkdir(paths.uploadDir, { recursive: true });
  const ext = path.extname(file.originalname || "").toLowerCase();
  const filename = `${Date.now()}-${safeFilename(path.basename(file.originalname, ext))}${ext}`;
  const targetPath = path.join(paths.uploadDir, filename);
  await fs.rename(file.path, targetPath);
  return { ...file, path: targetPath };
}

async function requireSubmission(id) {
  const submission = await getSubmission(id);
  if (!submission) {
    const error = new Error("Kiriman tidak ditemukan.");
    error.status = 404;
    throw error;
  }
  return submission;
}

async function ensureLocalSubmissionFile(submission) {
  try {
    if (submission.file?.path) {
      await fs.access(submission.file.path);
      return;
    }
  } catch {}
  const url = String(submission.file?.url || "");
  if (!/^https?:\/\//i.test(url)) return;
  await fs.mkdir(paths.uploadDir, { recursive: true });
  const ext = submission.file?.ext || path.extname(new URL(url).pathname) || ".bin";
  const localPath = path.join(paths.uploadDir, `${submission.id}-remote${ext}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gagal download file kiriman remote: HTTP ${response.status}`);
  await fs.writeFile(localPath, Buffer.from(await response.arrayBuffer()));
  submission.file.path = localPath;
  await saveSubmission(submission);
}

async function extractText(filePath, ext) {
  if (ext === ".txt" || ext === ".md") return fs.readFile(filePath, "utf8");
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  }
  return "";
}

function isMediaExtension(ext) {
  return [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".webm", ".mp4"].includes(ext);
}

function probeDuration(filePath) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const duration = Number(stdout.trim());
      resolve(Number.isFinite(duration) ? duration : 0);
    });
  });
}
