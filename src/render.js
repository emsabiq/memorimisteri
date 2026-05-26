import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { nowIso, safeFilename, splitLines } from "./util.js";

const width = 1080;
const height = 1920;
const fps = 30;

export async function renderDraftVideo(story) {
  const workDir = path.join(paths.storyboardDir, story.id);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(paths.videoDir, { recursive: true });

  const segmentPaths = [];
  const scenes = buildRenderScenes(story);
  for (const scene of scenes) {
    const imagePath = await resolveSceneImage(story, scene, workDir);
    const textPath = path.join(workDir, `scene-${scene.index}-text.txt`);
    const caption = splitLines(scene.screenText || scene.narration, 22).join("\n");
    await fs.writeFile(textPath, caption || "Kisah Malam Ini");
    const segmentPath = path.join(workDir, `scene-${scene.index}.mp4`);
    await makeSegment({ imagePath, textPath, scene, segmentPath });
    segmentPaths.push(segmentPath);
  }

  const concatPath = path.join(workDir, "concat.txt");
  await fs.writeFile(concatPath, segmentPaths.map((file) => `file '${file.replace(/\\/g, "/")}'`).join("\n"));

  const filename = `${story.id}-${safeFilename(story.title)}.mp4`;
  const outputPath = path.join(paths.videoDir, filename);
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", concatPath];
  if (story.assets?.audio?.path) args.push("-i", story.assets.audio.path, "-shortest");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (story.assets?.audio?.path) args.push("-c:a", "aac", "-b:a", "160k");
  args.push(outputPath);
  await runFfmpeg(args);

  return {
    path: outputPath,
    url: `/generated/videos/${filename}`,
    renderedAt: nowIso(),
    scenes: segmentPaths.length
  };
}

function buildRenderScenes(story) {
  const opening = {
    index: 0,
    durationSec: 2.2,
    screenText: story.plan.hook || story.title,
    narration: story.plan.hook || story.title,
    palette: ["#07080a", "#1d0e14", "#5b171f"]
  };
  const closing = {
    index: 99,
    durationSec: 2.4,
    screenText: story.plan.ending || "Bagian berikutnya?",
    narration: story.plan.ending || "",
    palette: ["#050506", "#161616", "#453114"]
  };
  return [opening, ...story.plan.scenes, closing];
}

async function resolveSceneImage(story, scene, workDir) {
  const existing = story.assets?.images?.find((item) => item.sceneIndex === scene.index);
  if (existing?.path) return existing.path;
  const ppmPath = path.join(workDir, `scene-${scene.index}.ppm`);
  await createMoodPpm(ppmPath, scene);
  return ppmPath;
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

  await fs.writeFile(outputPath, Buffer.concat([header, pixels]));
}

async function makeSegment({ imagePath, textPath, scene, segmentPath }) {
  const duration = Math.max(1.5, Number(scene.durationSec || 4));
  const font = "C\\:/Windows/Fonts/arialbd.ttf";
  const textFile = textPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
  const fadeOutAt = Math.max(0.8, duration - 0.28).toFixed(2);
  const frameCount = Math.ceil(duration * fps);
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "format=yuv420p",
    "eq=contrast=1.08:saturation=0.86:brightness=-0.035",
    "noise=alls=8:allf=t+u",
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.14:t=fill",
    `drawtext=fontfile='${font}':textfile='${textFile}':x=(w-text_w)/2:y=h*0.66:fontsize=68:fontcolor=white:line_spacing=14:box=1:boxcolor=black@0.48:boxborderw=30`,
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
