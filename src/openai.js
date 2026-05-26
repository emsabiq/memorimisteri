import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

const apiBase = "https://api.openai.com/v1";

export async function requestStoryJson(promptText) {
  assertOpenAi();
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.storyModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an Indonesian horror short-form video writer. Write natural, frightening Indonesian narration that sounds spoken, cinematic, and specific. Return valid JSON only."
        },
        { role: "user", content: promptText }
      ],
      temperature: 0.92
    })
  });
  const data = await parseOpenAiResponse(response);
  const content = data.choices?.[0]?.message?.content || "";
  return JSON.parse(content);
}

export async function generateSceneImage({ storyId, scene, size, quality }) {
  assertOpenAi();
  const prompt = sanitizeImagePrompt(scene.imagePrompt);
  const response = await fetch(`${apiBase}/images/generations`, {
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

export async function generateSpeech({ storyId, text }) {
  assertOpenAi();
  await fs.mkdir(paths.audioDir, { recursive: true });
  const filename = `${storyId}-narration.mp3`;
  const outputPath = path.join(paths.audioDir, filename);

  const response = await fetch(`${apiBase}/audio/speech`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.ttsModel,
      voice: config.openai.ttsVoice,
      input: text,
      instructions: "Bacakan sepenuhnya dalam Bahasa Indonesia dengan pelafalan Indonesia natural. Suaranya dekat, pelan, dan tegang, seperti orang Indonesia sedang menceritakan pengalaman mistis sungguhan kepada teman di ruangan gelap. Beri jeda di titik dan koma, bisikkan bagian yang menakutkan, tetapi jangan berlebihan atau seperti iklan.",
      response_format: "mp3"
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI TTS gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return {
    path: outputPath,
    url: `/generated/audio/${filename}`
  };
}

function assertOpenAi() {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY belum diisi.");
}

function headersJson() {
  return {
    Authorization: `Bearer ${config.openai.apiKey}`,
    "Content-Type": "application/json"
  };
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
