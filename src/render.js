import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { clamp, nowIso, safeFilename, splitLines } from "./util.js";

const width = 1080;
const height = 1920;
const fps = 30;
const scholarRegularFont = process.env.SCHOLAR_FONT_PATH || "C:/Users/Lenovo/AppData/Local/Microsoft/Windows/Fonts/scholar-regular.otf";
const scholarItalicFont = process.env.SCHOLAR_ITALIC_FONT_PATH || "C:/Users/Lenovo/AppData/Local/Microsoft/Windows/Fonts/scholar-italic.otf";

export async function renderDraftVideo(story) {
  const workDir = path.join(paths.storyboardDir, story.id);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(paths.videoDir, { recursive: true });
  await fs.mkdir(paths.imageDir, { recursive: true });

  const segmentPaths = [];
  const fallbackImages = [];
  const scenes = buildRenderScenes(story);
  for (const scene of scenes) {
    const image = await resolveSceneImage(story, scene, workDir);
    if (image.asset) fallbackImages.push(image.asset);
    const textPaths = await writeSegmentTextFiles({ story, scene, workDir });
    const segmentPath = path.join(workDir, `scene-${scene.index}.mp4`);
    await makeSegment({ imagePath: image.path, textPaths, scene, segmentPath });
    segmentPaths.push(segmentPath);
  }

  const concatPath = path.join(workDir, "concat.txt");
  await fs.writeFile(concatPath, segmentPaths.map((file) => `file '${file.replace(/\\/g, "/")}'`).join("\n"));

  const filename = `${story.id}-${safeFilename(story.title)}.mp4`;
  const outputPath = path.join(paths.videoDir, filename);
  const totalDuration = scenes.reduce((sum, scene) => sum + Math.max(1.5, Number(scene.durationSec || 4)), 0);
  const fallbackAudioPath = path.join(workDir, "fallback-horror-bed.m4a");
  let audioPath;
  let audioKind;
  if (story.assets?.audio?.path) {
    const ttsMixPath = path.join(workDir, "tts-horror-mix.m4a");
    await makeTtsHorrorMix({ inputPath: story.assets.audio.path, outputPath: ttsMixPath, duration: totalDuration });
    audioPath = ttsMixPath;
    audioKind = "tts-horror-mix";
  } else {
    const narrationText = story.plan.scenes.map((scene) => scene.narration).join(" ");
    const fallbackAudio = await makeFallbackAudio({ outputPath: fallbackAudioPath, duration: totalDuration, text: narrationText });
    audioPath = fallbackAudio.path;
    audioKind = fallbackAudio.kind;
  }

  const args = ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-i", audioPath];
  args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k");
  args.push(outputPath);
  await runFfmpeg(args);

  return {
    video: {
      path: outputPath,
      url: `/generated/videos/${filename}`,
      renderedAt: nowIso(),
      scenes: segmentPaths.length,
      audio: audioKind,
      durationSec: Number(totalDuration.toFixed(2))
    },
    fallbackImages
  };
}

function buildRenderScenes(story) {
  const targetDuration = clamp(Number(story.input?.durationSec || 60), 45, 60);
  const episode = story.plan.episode || {};
  const contentScenes = fitContentScenes(story.plan.scenes, targetDuration)
    .map((scene) => ({
      ...scene,
      kind: "content",
      storyTitle: story.title,
      partLabel: headerLabel(episode)
    }));
  return contentScenes;
}

function headerLabel(episode) {
  return [episode?.title, partLabel(episode)].filter(Boolean).join(" / ");
}

function partLabel(episode) {
  if (!episode?.currentPart) return "PART 1";
  return `PART ${episode.currentPart}/${episode.totalParts || "?"}`;
}

function fitContentScenes(scenes, targetContentDuration) {
  const items = [...(scenes || [])];
  const total = items.reduce((sum, scene) => sum + Math.max(1.5, Number(scene.durationSec || 4)), 0);
  if (!items.length || total <= 0) return items;

  const scale = targetContentDuration / total;
  let used = 0;
  return items.map((scene, index) => {
    const isLast = index === items.length - 1;
    const durationSec = isLast
      ? Math.max(1.5, Number((targetContentDuration - used).toFixed(2)))
      : Math.max(1.5, Number((Number(scene.durationSec || 4) * scale).toFixed(2)));
    used += durationSec;
    return { ...scene, durationSec };
  });
}

async function resolveSceneImage(story, scene, workDir) {
  const sourceSceneIndex = scene.imageSourceSceneIndex || scene.index;
  const existing = story.assets?.images?.find((item) => item.sceneIndex === sourceSceneIndex);
  if (existing?.path) return { path: existing.path, asset: null };
  const ppmPath = path.join(workDir, `scene-${scene.index}.ppm`);
  await createMoodPpm(ppmPath, scene);

  if (scene.index > 0 && scene.index < 99) {
    const filename = `${story.id}-scene-${scene.index}-preview.png`;
    const previewPath = path.join(paths.imageDir, filename);
    await makeScenePreviewPng({ imagePath: ppmPath, outputPath: previewPath });
    return {
      path: ppmPath,
      asset: {
        sceneIndex: scene.index,
        path: previewPath,
        url: `/generated/images/${filename}`,
        prompt: scene.imagePrompt,
        source: "local-fallback"
      }
    };
  }

  return { path: ppmPath, asset: null };
}

async function createMoodPpm(outputPath, scene) {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  const pixels = Buffer.alloc(width * height * 3);
  const seed = hashScene(scene);
  const palette = scene.palette || paletteForScene(seed);
  const a = hexToRgb(palette[0]);
  const b = hexToRgb(palette[1]);
  const c = hexToRgb(palette[2]);

  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const ty = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const tx = x / (width - 1);
      const vignette = 1 - Math.min(0.7, Math.hypot(tx - 0.5, ty - 0.45) * 1.2);
      const streak = Math.sin((x + seed) * 0.015) * 0.035 + Math.sin((y + seed) * 0.009) * 0.04;
      const mix = Math.max(0, Math.min(1, ty + streak));
      const glow = Math.max(0, 1 - Math.hypot(tx - 0.5, ty - 0.35) * 2.8);
      const noise = (((x * 17 + y * 31 + seed) % 29) - 14) / 255;
      const base = lerpRgb(a, b, mix);
      const lit = lerpRgb(base, c, glow * 0.34);
      pixels[offset++] = clampByte((lit.r * vignette) + noise * 255);
      pixels[offset++] = clampByte((lit.g * vignette) + noise * 255);
      pixels[offset++] = clampByte((lit.b * vignette) + noise * 255);
    }
  }

  drawSceneComposition(pixels, scene, seed);
  await fs.writeFile(outputPath, Buffer.concat([header, pixels]));
}

async function writeSegmentTextFiles({ story, scene, workDir }) {
  const episode = story.plan.episode || {};
  const partText = scene.partLabel || partLabel(episode);
  const titleText = scene.index === 1 ? (story.plan.episode?.title || scene.storyTitle || story.title) : scene.screenText;
  const subtitleText = scene.narration;
  const files = {
    part: path.join(workDir, `scene-${scene.index}-part.txt`),
    title: path.join(workDir, `scene-${scene.index}-title.txt`),
    subtitles: []
  };
  await fs.writeFile(files.part, formatLines(partText, 34, 1) || "PART 1");
  await fs.writeFile(files.title, formatLines(titleText, scene.index === 1 ? 20 : 24, 2) || story.title);
  const words = splitSubtitleWords(subtitleText);
  for (let index = 0; index < words.length; index += 1) {
    const subtitlePath = path.join(workDir, `scene-${scene.index}-subtitle-${index + 1}.txt`);
    await fs.writeFile(subtitlePath, formatLines(words[index], 18, 1) || "");
    files.subtitles.push(subtitlePath);
  }
  return files;
}

function formatLines(value, maxChars, maxLines) {
  return splitLines(value, maxChars).slice(0, maxLines).join("\n");
}

function splitSubtitleWords(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  return words.length ? words : [""];
}

function ffmpegPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
}

async function makeSegment({ imagePath, textPaths, scene, segmentPath }) {
  const duration = Math.max(1.5, Number(scene.durationSec || 4));
  const regularFont = ffmpegPath(scholarRegularFont);
  const italicFont = ffmpegPath(scholarItalicFont);
  const partTextFile = ffmpegPath(textPaths.part);
  const titleTextFile = ffmpegPath(textPaths.title);
  const fadeOutAt = Math.max(0.8, duration - 0.28).toFixed(2);
  const frameCount = Math.ceil(duration * fps);
  const overlays = [
    "drawbox=x=0:y=0:w=iw:h=270:color=black@0.46:t=fill",
    `drawtext=fontfile='${italicFont}':textfile='${partTextFile}':x=64:y=46:fontsize=34:fontcolor=0xe2c483:line_spacing=8`,
    `drawtext=fontfile='${regularFont}':textfile='${titleTextFile}':x=64:y=105:fontsize=${scene.index === 1 ? 66 : 58}:fontcolor=0xf7f1e5:line_spacing=12:borderw=3:bordercolor=black@0.9`,
    ...subtitleOverlays({ regularFont, subtitleFiles: textPaths.subtitles, duration })
  ];
  const zoomFilter = cameraMotionFilter(scene, frameCount);
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    zoomFilter,
    "format=yuv420p",
    "eq=contrast=1.08:saturation=1.08:brightness=0.06",
    "noise=alls=5:allf=t+u",
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.04:t=fill",
    ...overlays,
    "fade=t=in:st=0:d=0.16",
    `fade=t=out:st=${fadeOutAt}:d=0.25`
  ].join(",");

  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-t",
    String(duration),
    "-i",
    imagePath,
    "-vf",
    vf,
    "-an",
    "-r",
    String(fps),
    "-frames:v",
    String(frameCount),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    segmentPath
  ]);
}

function subtitleOverlays({ regularFont, subtitleFiles, duration }) {
  const files = subtitleFiles?.length ? subtitleFiles : [];
  const step = duration / Math.max(1, files.length);
  return files.map((file, index) => {
    const start = Math.max(0, index * step);
    const end = Math.max(start + 0.22, Math.min(duration, (index + 1) * step + 0.05));
    const enable = `between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})`;
    return `drawtext=fontfile='${regularFont}':textfile='${ffmpegPath(file)}':x=(w-text_w)/2:y=h-330:fontsize=76:fontcolor=0xfff4cf:line_spacing=10:box=1:boxcolor=black@0.72:boxborderw=34:borderw=3:bordercolor=black@0.95:enable='${enable}'`;
  });
}

function cameraMotionFilter(scene, frameCount) {
  const text = `${scene.effect || ""} ${scene.transition || ""}`.toLowerCase();
  if (text.includes("out")) {
    return `zoompan=z='max(1.0\\,1.08-on*0.0011)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${width}x${height}:fps=${fps}`;
  }
  if (text.includes("glitch")) {
    return `zoompan=z='min(zoom+0.0018\\,1.1)':x='iw/2-(iw/zoom/2)+sin(on/3)*7':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${width}x${height}:fps=${fps}`;
  }
  return `zoompan=z='min(zoom+0.0012\\,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${width}x${height}:fps=${fps}`;
}

async function makeScenePreviewPng({ imagePath, outputPath }) {
  await runFfmpeg([
    "-y",
    "-i",
    imagePath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=contrast=1.08:saturation=1.08:brightness=0.06`,
    "-frames:v",
    "1",
    outputPath
  ]);
}

async function makeFallbackAudio({ outputPath, duration, text }) {
  const narrationPath = outputPath.replace(/\.m4a$/i, "-narration.wav");
  const narrationTextPath = outputPath.replace(/\.m4a$/i, "-narration.txt");
  let hasNarration = false;
  try {
    await fs.writeFile(narrationTextPath, text, "utf8");
    await makeWindowsNarration({ textPath: narrationTextPath, outputPath: narrationPath });
    hasNarration = true;
  } catch {
    hasNarration = false;
  }

  const fadeOutAt = Math.max(0.5, duration - 0.7).toFixed(2);
  const filter = hasNarration
    ? [
        "[0:a]volume=2.25,aecho=0.65:0.35:70:0.2,highpass=f=85,lowpass=f=5400,dynaudnorm=f=120:g=12[n]",
        "[1:a]volume=0.24,lowpass=f=80,aecho=0.6:0.25:900:0.18[a0]",
        "[2:a]volume=0.12,lowpass=f=180,tremolo=f=0.22:d=0.85[a1]",
        "[3:a]volume=0.065,aecho=0.45:0.25:760:0.18[a2]",
        "[4:a]volume=0.16,highpass=f=70,lowpass=f=1350[a3]",
        "[5:a]volume=0.055,highpass=f=1200,lowpass=f=3800,tremolo=f=8:d=0.72[a4]",
        `[n][a0][a1][a2][a3][a4]amix=inputs=6:duration=longest:normalize=0,lowpass=f=6000,volume=1.08,alimiter=limit=0.95,afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOutAt}:d=0.65[a]`
      ].join(";")
    : [
        "[0:a]volume=0.28,lowpass=f=80,aecho=0.6:0.25:900:0.18[a0]",
        "[1:a]volume=0.14,lowpass=f=180,tremolo=f=0.22:d=0.85[a1]",
        "[2:a]volume=0.07,aecho=0.45:0.25:760:0.18[a2]",
        "[3:a]volume=0.18,highpass=f=70,lowpass=f=1350[a3]",
        "[4:a]volume=0.065,highpass=f=1200,lowpass=f=3800,tremolo=f=8:d=0.72[a4]",
        `[a0][a1][a2][a3][a4]amix=inputs=5:duration=longest:normalize=0,lowpass=f=3600,volume=1.35,alimiter=limit=0.95,afade=t=in:st=0:d=0.45,afade=t=out:st=${fadeOutAt}:d=0.65[a]`
      ].join(";");

  const args = ["-y"];
  if (hasNarration) args.push("-stream_loop", "-1", "-i", narrationPath);
  args.push(
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=48:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=91:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=184:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "anoisesrc=color=brown:amplitude=0.24:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "anoisesrc=color=white:amplitude=0.12:sample_rate=44100",
    "-filter_complex",
    filter,
    "-map",
    "[a]",
    "-t",
    String(duration),
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    "160k",
    outputPath
  );

  await runFfmpeg(args);

  return {
    path: outputPath,
    kind: hasNarration ? "local-voice-horror-bed" : "fallback-horror-bed"
  };
}

async function makeTtsHorrorMix({ inputPath, outputPath, duration }) {
  const fadeOutAt = Math.max(0.5, duration - 0.7).toFixed(2);
  const filter = [
    "[0:a]volume=2.25,aecho=0.58:0.28:82:0.18,highpass=f=85,lowpass=f=5600,dynaudnorm=f=120:g=12[n]",
    "[1:a]volume=0.22,lowpass=f=82,aecho=0.6:0.28:960:0.2[a0]",
    "[2:a]volume=0.105,lowpass=f=180,tremolo=f=0.2:d=0.9[a1]",
    "[3:a]volume=0.058,aecho=0.45:0.25:760:0.2[a2]",
    "[4:a]volume=0.14,highpass=f=72,lowpass=f=1450[a3]",
    "[5:a]volume=0.048,highpass=f=1200,lowpass=f=3900,tremolo=f=8.5:d=0.76[a4]",
    `[n][a0][a1][a2][a3][a4]amix=inputs=6:duration=longest:normalize=0,lowpass=f=6500,volume=1.04,alimiter=limit=0.95,afade=t=in:st=0:d=0.2,afade=t=out:st=${fadeOutAt}:d=0.65[a]`
  ].join(";");

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=48:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=96:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=184:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "anoisesrc=color=brown:amplitude=0.18:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "anoisesrc=color=white:amplitude=0.1:sample_rate=44100",
    "-filter_complex",
    filter,
    "-map",
    "[a]",
    "-t",
    String(duration),
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    "160k",
    outputPath
  ]);
}

function makeWindowsNarration({ textPath, outputPath }) {
  if (process.platform !== "win32") return Promise.reject(new Error("Windows SAPI tidak tersedia."));
  const script = [
    "Add-Type -AssemblyName System.Speech",
    `$text = Get-Content -Raw -LiteralPath '${textPath.replaceAll("'", "''")}'`,
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$voice = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Culture.Name -like 'id-*' -or $_.Name -match 'Indonesia|Indonesian' } | Select-Object -First 1",
    "if (-not $voice) { throw 'Tidak ada voice Indonesia terinstall. Isi OPENAI_API_KEY untuk TTS Indonesia natural.' }",
    "$s.SelectVoice($voice.Name)",
    "$s.Rate = -2",
    "$s.Volume = 100",
    `$s.SetOutputToWaveFile('${outputPath.replaceAll("'", "''")}')`,
    "$s.Speak($text)",
    "$s.Dispose()"
  ].join("; ");

  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `PowerShell narration gagal (${code})`));
    });
  });
}

function drawSceneComposition(pixels, scene, seed) {
  const text = `${scene.screenText || ""} ${scene.narration || ""} ${scene.imagePrompt || ""}`.toLowerCase();
  drawVignetteGlow(pixels);
  drawPerspectiveRoom(pixels, seed);

  if (text.includes("sumur")) {
    drawMoon(pixels, 780, 250, 80);
    drawWell(pixels, 540, 1120);
    drawShadowFigure(pixels, 705, 1025, 1.1);
  } else if (text.includes("jalan") || text.includes("tikungan")) {
    drawRoad(pixels);
    drawLampPost(pixels, 300, 520);
    drawShadowFigure(pixels, 650, 970, 1.0);
  } else if (text.includes("jendela") || text.includes("kaca")) {
    drawWindow(pixels, 300, 390, 480, 520);
    drawShadowFigure(pixels, 670, 980, 1.15);
  } else {
    drawDoor(pixels, 330, 380, 420, 850);
    drawShadowFigure(pixels, 620, 980, 1.08);
  }

  drawDust(pixels, seed);
}

function drawVignetteGlow(pixels) {
  fillEllipse(pixels, 540, 520, 360, 260, { r: 168, g: 98, b: 45 }, 0.18);
  fillEllipse(pixels, 540, 1420, 480, 330, { r: 20, g: 78, b: 70 }, 0.12);
}

function drawPerspectiveRoom(pixels, seed) {
  fillRect(pixels, 0, 1240, width, 680, { r: 32, g: 28, b: 24 }, 0.86);
  const center = { x: 540 + (seed % 80) - 40, y: 820 };
  for (let x = -160; x <= width + 160; x += 150) {
    drawLine(pixels, center.x, center.y, x, height, { r: 92, g: 72, b: 55 }, 0.34, 3);
  }
  for (let y = 1320; y < height; y += 130) {
    drawLine(pixels, 0, y, width, y + 25, { r: 83, g: 63, b: 49 }, 0.27, 2);
  }
}

function drawDoor(pixels, x, y, w, h) {
  fillRect(pixels, x - 22, y - 22, w + 44, h + 44, { r: 18, g: 12, b: 10 }, 0.98);
  fillRect(pixels, x, y, w, h, { r: 55, g: 38, b: 30 }, 0.92);
  fillRect(pixels, x + w - 82, y + 15, 30, h - 30, { r: 230, g: 154, b: 68 }, 0.58);
  fillRect(pixels, x + 30, y + 70, w - 145, h - 140, { r: 19, g: 15, b: 15 }, 0.42);
  fillEllipse(pixels, x + w - 115, y + 455, 16, 16, { r: 238, g: 185, b: 92 }, 0.9);
}

function drawWindow(pixels, x, y, w, h) {
  fillRect(pixels, x - 18, y - 18, w + 36, h + 36, { r: 12, g: 13, b: 15 }, 0.96);
  fillRect(pixels, x, y, w, h, { r: 19, g: 31, b: 36 }, 0.9);
  drawLine(pixels, x + w / 2, y, x + w / 2, y + h, { r: 142, g: 112, b: 83 }, 0.6, 8);
  drawLine(pixels, x, y + h / 2, x + w, y + h / 2, { r: 142, g: 112, b: 83 }, 0.6, 8);
  fillEllipse(pixels, x + w * 0.75, y + h * 0.28, 48, 48, { r: 230, g: 214, b: 164 }, 0.65);
}

function drawRoad(pixels) {
  fillPolygon(pixels, [{ x: 430, y: 870 }, { x: 650, y: 870 }, { x: 980, y: 1920 }, { x: 70, y: 1920 }], { r: 28, g: 30, b: 30 }, 0.9);
  drawLine(pixels, 540, 930, 540, 1830, { r: 197, g: 158, b: 78 }, 0.58, 6);
}

function drawLampPost(pixels, x, y) {
  fillRect(pixels, x, y, 18, 760, { r: 20, g: 19, b: 18 }, 0.98);
  fillEllipse(pixels, x + 8, y - 18, 70, 70, { r: 235, g: 177, b: 80 }, 0.78);
  fillEllipse(pixels, x + 8, y + 20, 230, 280, { r: 209, g: 139, b: 56 }, 0.16);
}

function drawMoon(pixels, x, y, r) {
  fillEllipse(pixels, x, y, r, r, { r: 222, g: 211, b: 174 }, 0.78);
  fillEllipse(pixels, x - 26, y - 14, r * 0.82, r * 0.82, { r: 22, g: 31, b: 38 }, 0.55);
}

function drawWell(pixels, x, y) {
  fillEllipse(pixels, x, y, 230, 80, { r: 56, g: 52, b: 49 }, 0.95);
  fillEllipse(pixels, x, y - 20, 185, 52, { r: 8, g: 9, b: 10 }, 0.95);
  fillRect(pixels, x - 185, y - 280, 28, 290, { r: 64, g: 49, b: 38 }, 0.95);
  fillRect(pixels, x + 160, y - 280, 28, 290, { r: 64, g: 49, b: 38 }, 0.95);
  drawLine(pixels, x - 170, y - 280, x + 175, y - 280, { r: 74, g: 56, b: 39 }, 0.95, 20);
}

function drawShadowFigure(pixels, x, y, scale = 1) {
  fillEllipse(pixels, x, y - 300 * scale, 58 * scale, 70 * scale, { r: 3, g: 4, b: 5 }, 0.92);
  fillEllipse(pixels, x, y - 125 * scale, 95 * scale, 230 * scale, { r: 2, g: 3, b: 4 }, 0.9);
  fillPolygon(pixels, [
    { x: x - 78 * scale, y: y - 90 * scale },
    { x: x + 78 * scale, y: y - 90 * scale },
    { x: x + 140 * scale, y: y + 245 * scale },
    { x: x - 140 * scale, y: y + 245 * scale }
  ], { r: 1, g: 2, b: 3 }, 0.82);
  fillEllipse(pixels, x - 18 * scale, y - 318 * scale, 8 * scale, 5 * scale, { r: 224, g: 210, b: 167 }, 0.42);
  fillEllipse(pixels, x + 18 * scale, y - 318 * scale, 8 * scale, 5 * scale, { r: 224, g: 210, b: 167 }, 0.42);
}

function drawDust(pixels, seed) {
  for (let i = 0; i < 420; i += 1) {
    const x = (seed * (i + 17) * 13) % width;
    const y = (seed * (i + 29) * 7) % height;
    const alpha = 0.08 + ((i % 9) / 100);
    fillEllipse(pixels, x, y, 2 + (i % 3), 2 + (i % 3), { r: 218, g: 194, b: 150 }, alpha);
  }
}

function fillRect(pixels, x, y, w, h, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w));
  const y1 = Math.min(height, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) blendPixel(pixels, xx, yy, color, alpha);
  }
}

function fillEllipse(pixels, cx, cy, rx, ry, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(width - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(height - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) blendPixel(pixels, x, y, color, alpha);
    }
  }
}

function drawLine(pixels, x0, y0, x1, y1, color, alpha = 1, thickness = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    fillEllipse(pixels, x, y, thickness, thickness, color, alpha);
  }
}

function fillPolygon(pixels, points, color, alpha = 1) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point.y))));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        intersections.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      const x0 = Math.max(0, Math.floor(intersections[i]));
      const x1 = Math.min(width - 1, Math.ceil(intersections[i + 1]));
      for (let x = x0; x <= x1; x += 1) blendPixel(pixels, x, y, color, alpha);
    }
  }
}

function blendPixel(pixels, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (Math.floor(y) * width + Math.floor(x)) * 3;
  pixels[index] = clampByte(pixels[index] * (1 - alpha) + color.r * alpha);
  pixels[index + 1] = clampByte(pixels[index + 1] * (1 - alpha) + color.g * alpha);
  pixels[index + 2] = clampByte(pixels[index + 2] * (1 - alpha) + color.b * alpha);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg gagal (${code}): ${stderr.slice(-1200)}`));
    });
  });
}

function hashScene(scene) {
  const text = `${scene.screenText || ""}${scene.narration || ""}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash || 1;
}

function paletteForScene(seed) {
  const palettes = [
    ["#050506", "#10171b", "#4f1b23"],
    ["#070605", "#1d1712", "#6b4d1f"],
    ["#06080a", "#111f1b", "#315645"],
    ["#08070a", "#17121f", "#57344e"],
    ["#050607", "#1b1616", "#6b2222"]
  ];
  return palettes[seed % palettes.length];
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function lerpRgb(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
