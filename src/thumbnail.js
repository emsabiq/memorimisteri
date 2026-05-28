import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { safeFilename } from "./util.js";

const width = 1080;
const height = 1920;
const bundledFontDir = path.join(paths.publicDir, "assets", "fonts");
const scholarRegularFont = process.env.SCHOLAR_FONT_PATH || path.join(bundledFontDir, "scholar-regular.otf");

export async function createTitleThumbnail(story) {
  const source = firstImage(story);
  if (!source?.path) return null;

  await fs.mkdir(paths.imageDir, { recursive: true });
  const workDir = path.join(paths.storyboardDir, story.id);
  await fs.mkdir(workDir, { recursive: true });

  const titlePath = path.join(workDir, "thumbnail-title.txt");
  const metaPath = path.join(workDir, "thumbnail-meta.txt");
  await fs.writeFile(titlePath, wrapTitle(story.plan?.season?.title || story.plan?.episode?.title || story.title || "Memori Misteri"), "utf8");
  await fs.writeFile(metaPath, thumbnailMeta(story), "utf8");

  const filename = `${story.id}-thumbnail-${safeFilename(story.title || "title")}.png`;
  const outputPath = path.join(paths.imageDir, filename);
  const titleFile = ffmpegFilterPath(titlePath);
  const metaFile = ffmpegFilterPath(metaPath);
  const fontFile = ffmpegFilterPath(scholarRegularFont);
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "eq=brightness=-0.055:contrast=1.08:saturation=0.92",
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.30:t=fill",
    "drawbox=x=0:y=1240:w=iw:h=430:color=black@0.58:t=fill",
    `drawtext=fontfile='${fontFile}':textfile='${metaFile}':x=76:y=1284:fontsize=46:fontcolor=0xd8efea:line_spacing=8:borderw=3:bordercolor=black@0.9`,
    `drawtext=fontfile='${fontFile}':textfile='${titleFile}':x=76:y=1360:fontsize=88:fontcolor=0xf7f1e5:line_spacing=14:borderw=6:bordercolor=black@0.96:shadowx=0:shadowy=5:shadowcolor=black@0.72`,
    "format=rgb24"
  ].join(",");

  await runFfmpeg([
    "-y",
    "-i",
    source.path,
    "-vf",
    filter,
    "-frames:v",
    "1",
    outputPath
  ]);

  return {
    path: outputPath,
    url: `/generated/images/${filename}`,
    source: "title-thumbnail",
    sourceSceneIndex: source.sceneIndex || 1,
    title: story.title
  };
}

function firstImage(story) {
  return [...(story.assets?.images || [])].sort((a, b) => Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0))[0];
}

function thumbnailMeta(story) {
  const season = story.plan?.season || {};
  const episode = story.plan?.episode || {};
  const current = season.currentEpisode || episode.currentPart;
  const total = season.totalEpisodes || episode.totalParts;
  const part = current ? `EPISODE ${current}/${total || "?"}` : "EPISODE 1";
  return ["MEMORI MISTERI", part].join("  |  ");
}

function wrapTitle(value) {
  const words = String(value || "Memori Misteri").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 16 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join("\n");
}

function ffmpegFilterPath(filePath) {
  return String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
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
      else reject(new Error(`ffmpeg thumbnail gagal (${code}): ${stderr.slice(-1200)}`));
    });
  });
}
