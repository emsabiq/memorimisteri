import { spawnSync } from "node:child_process";
import { config } from "./config.js";
import { remoteEnabled, publicBaseUrl } from "./remote.js";

const checks = [];

check("OPENAI_API_KEY", Boolean(config.openai.apiKey), "wajib untuk story, image, TTS fallback, dan transcribe");
check("FFmpeg", spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true }).status === 0, "wajib untuk render");
check("PUBLIC_BASE_URL", Boolean(publicBaseUrl()), "wajib untuk Meta fetch video publik");
check("REMOTE_UPLOAD", remoteEnabled(), "FTP/SFTP wajib untuk mistis.emsa.pro");
check("FACEBOOK", !config.automation.facebook || Boolean(config.facebook.pageId && (config.facebook.accessToken || config.facebook.userAccessToken)), "aktif butuh Page ID dan token");
check("INSTAGRAM", !config.automation.instagram || Boolean(config.instagram.igUserId && config.instagram.accessToken), "aktif butuh IG User ID dan token");
check("THREADS", !config.automation.threads || Boolean(config.threads.accessToken), "aktif butuh Threads token");

for (const item of checks) {
  console.log(`${item.ok ? "OK" : "FAIL"} ${item.name} - ${item.detail}`);
}

if (checks.some((item) => !item.ok)) process.exit(1);

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}
