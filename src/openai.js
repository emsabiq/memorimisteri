import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

export async function requestStoryJson(promptText) {
  assertStoryProvider();
  const errors = [];
  for (const url of storyCompletionUrls()) {
    for (const model of config.story.models) {
      for (const strictJson of [true, false]) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: storyHeadersJson(),
            body: JSON.stringify(storyPayload({ promptText, model, strictJson }))
          });
          const data = await parseOpenAiResponse(response);
          const content = data.choices?.[0]?.message?.content || "";
          return parseJsonContent(content);
        } catch (error) {
          errors.push(`${model}${strictJson ? "" : " relaxed"}: ${error.message}`);
        }
      }
    }
  }
  throw new Error(`Story provider gagal: ${errors.slice(0, 4).join(" | ")}`);
}

export async function generateSceneImage({ storyId, scene, size, quality }) {
  assertOpenAi();
  const prompt = sanitizeImagePrompt(scene.imagePrompt);
  const response = await fetch(`${config.openai.baseUrl}/images/generations`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.imageModel,
      prompt,
      size,
      quality,
      n: 1
    })
  });
  const data = await parseOpenAiResponse(response);
  const item = data.data?.[0];
  if (!item) throw new Error("OpenAI tidak mengembalikan gambar.");

  await fs.mkdir(paths.imageDir, { recursive: true });
  const filename = `${storyId}-scene-${scene.index}-${safeFilename(scene.screenText)}.png`;
  const outputPath = path.join(paths.imageDir, filename);

  if (item.b64_json) {
    await fs.writeFile(outputPath, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const image = await fetch(item.url);
    if (!image.ok) throw new Error(`Gagal download image: HTTP ${image.status}`);
    await fs.writeFile(outputPath, Buffer.from(await image.arrayBuffer()));
  } else {
    throw new Error("Format response image tidak dikenali.");
  }

  return {
    sceneIndex: scene.index,
    path: outputPath,
    url: `/generated/images/${filename}`,
    prompt
  };
}

export async function generateSpeech({ storyId, text, voice, instructions, filenameSuffix = "openai" }) {
  assertOpenAi();
  await fs.mkdir(paths.audioDir, { recursive: true });
  const filename = `${storyId}-${safeFilename(filenameSuffix)}-narration.mp3`;
  const outputPath = path.join(paths.audioDir, filename);

  const response = await fetch(`${config.openai.baseUrl}/audio/speech`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.ttsModel,
      voice: voice || config.openai.ttsVoice,
      input: text,
      instructions: instructions || "Bacakan sepenuhnya dalam Bahasa Indonesia dengan pelafalan Indonesia natural. Suaranya pelan, tegang, dan rapi, seperti narator Indonesia sedang menceritakan pengalaman mistis dengan bahasa formal sedang. Jangan terdengar membaca potongan scene; baca sebagai satu cerita sambung dengan napas natural dan jeda tegang. Tetap jelas, tidak membingungkan, tidak berlebihan, dan bukan gaya iklan.",
      response_format: "mp3"
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI TTS gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return {
    provider: "openai",
    model: config.openai.ttsModel,
    voice: voice || config.openai.ttsVoice,
    path: outputPath,
    url: `/generated/audio/${filename}`
  };
}

export async function transcribeAudioFile(audioPath) {
  assertOpenAi();
  const buffer = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), path.basename(audioPath));
  form.append("model", config.openai.transcribeModel);
  form.append("language", "id");
  form.append("response_format", "json");

  const response = await fetch(`${config.openai.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form
  });
  const data = await parseOpenAiResponse(response);
  return String(data.text || "").replace(/\s+/g, " ").trim();
}

export async function transcribeAudioCaptions(audioPath) {
  assertOpenAi();
  let data;
  try {
    data = await requestVerboseTranscription(audioPath, true);
  } catch {
    data = await requestVerboseTranscription(audioPath, false);
  }
  return {
    provider: "openai",
    model: config.openai.transcribeModel,
    sourceAudioPath: audioPath,
    text: String(data.text || "").replace(/\s+/g, " ").trim(),
    durationSec: Number(data.duration || 0),
    words: normalizeTranscriptWords(data.words),
    segments: normalizeTranscriptSegments(data.segments)
  };
}

async function requestVerboseTranscription(audioPath, withWords) {
  const buffer = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), path.basename(audioPath));
  form.append("model", config.openai.transcribeModel);
  form.append("language", "id");
  form.append("response_format", "verbose_json");
  if (withWords) form.append("timestamp_granularities[]", "word");

  const response = await fetch(`${config.openai.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form
  });
  return parseOpenAiResponse(response);
}

function normalizeTranscriptWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .map((item) => ({
      word: String(item.word || "").trim(),
      start: Number(item.start),
      end: Number(item.end)
    }))
    .filter((item) => item.word && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
}

function normalizeTranscriptSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((item) => ({
      text: String(item.text || "").replace(/\s+/g, " ").trim(),
      start: Number(item.start),
      end: Number(item.end)
    }))
    .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
}

function assertOpenAi() {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY belum diisi.");
}

function assertStoryProvider() {
  if (!config.story.apiKey) throw new Error("OPENAI_API_KEY belum diisi untuk membuat cerita.");
}

function headersJson() {
  return {
    Authorization: `Bearer ${config.openai.apiKey}`,
    "Content-Type": "application/json"
  };
}

function storyHeadersJson() {
  return {
    Authorization: `Bearer ${config.story.apiKey}`,
    "Content-Type": "application/json"
  };
}

function storyCompletionUrls() {
  const base = String(config.story.baseUrl || "").replace(/\/+$/g, "");
  if (!base) return [];
  const urls = [`${base}/chat/completions`];
  if (!/\/v1$/i.test(base) && !/\/v1\//i.test(base)) urls.unshift(`${base}/v1/chat/completions`);
  return [...new Set(urls)];
}

function storyPayload({ promptText, model, strictJson }) {
  const payload = {
    model,
    ...(strictJson ? { response_format: { type: "json_object" } } : {}),
    messages: [
      {
        role: "system",
        content: "You are an Indonesian horror short-form video writer. Write first-person narration in clear medium-formal Indonesian, cinematic and easy to understand, like a narrator telling a frightening personal experience in an orderly way. Return valid JSON only."
      },
      { role: "user", content: promptText }
    ],
    temperature: 0.92
  };
  if (/^gpt-5/i.test(model)) payload.max_completion_tokens = config.story.maxCompletionTokens;
  return payload;
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

function sanitizeImagePrompt(value) {
  return String(value || "")
    .replace(/person inside the well/gi, "person beside the old well")
    .replace(/human inside the well/gi, "human silhouette beside the old well")
    .replace(/body inside the well/gi, "shadow reflected on the well water")
    .replace(/standing inside the well/gi, "standing beside the old well")
    .replace(/in the well['’]s shadow/gi, "beside the well in soft shadow")
    .replace(/from inside the well/gi, "from near the old well")
    .replace(/figure in the well/gi, "distant figure beside the well")
    .replace(/something that fell into the well/gi, "ripples moving across the well water")
    .concat(", no injury, no trapped person, no drowning, no fall, no violence, no self-harm");
}

async function parseOpenAiResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}
