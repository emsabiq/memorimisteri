import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

const apiBase = "https://api.elevenlabs.io/v1";

export async function generateElevenLabsSpeech({ storyId, text, voiceId, modelId, filenameSuffix = "elevenlabs" }) {
  assertElevenLabs();
  await fs.mkdir(paths.audioDir, { recursive: true });

  const voice = String(voiceId || config.elevenlabs.voiceId).trim();
  const model = String(modelId || config.elevenlabs.model).trim();
  const filename = `${storyId}-${safeFilename(filenameSuffix)}-narration.mp3`;
  const outputPath = path.join(paths.audioDir, filename);

  const response = await fetch(`${apiBase}/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenlabs.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: 0.34,
        similarity_boost: 0.78,
        style: 0.64,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs TTS gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return {
    provider: "elevenlabs",
    model,
    voiceId: voice,
    path: outputPath,
    url: `/generated/audio/${filename}`
  };
}

function assertElevenLabs() {
  if (!config.elevenlabs.apiKey) throw new Error("ELEVENLABS_API_KEY belum diisi.");
  if (!config.elevenlabs.voiceId) throw new Error("ELEVENLABS_VOICE_ID belum diisi.");
}
