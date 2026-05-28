import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { clamp, nowIso, safeFilename, splitLines } from "./util.js";

const width = 1080;
const height = 1920;
const fps = 30;
const scholarRegularFont = process.env.SCHOLAR_FONT_PATH || "C:/Users/Lenovo/AppData/Local/Microsoft/Windows/Fonts/scholar-regular.otf";
const scholarItalicFont = process.env.SCHOLAR_ITALIC_FONT_PATH || "C:/Users/Lenovo/AppData/Local/Microsoft/Windows/Fonts/scholar-italic.otf";
const scholarFontName = process.env.SUBTITLE_FONT_FAMILY || "Scholar";
const scholarFontsDir = path.dirname(scholarRegularFont);
const transitionDuration = 0.45;
const endCardDuration = 2.4;
const jumpScareDuration = Number.isFinite(Number(process.env.JUMPSCARE_SECONDS))
  ? clamp(Number(process.env.JUMPSCARE_SECONDS), 0.45, 1.25)
  : 0.78;
const introFreezeDuration = Number.isFinite(Number(process.env.INTRO_FREEZE_SECONDS))
  ? clamp(Number(process.env.INTRO_FREEZE_SECONDS), 0.3, 2)
  : 0.8;
const subtitleOffsetSeconds = Number.isFinite(Number(process.env.SUBTITLE_OFFSET_SECONDS))
  ? Number(process.env.SUBTITLE_OFFSET_SECONDS)
  : 0.02;
const producerAudioDir = process.env.HORROR_AUDIO_DIR || "C:/Users/Lenovo/Downloads";
const producerMusicNames = [
  "Puncak Mencekam.mp3",
  "Hawa Dingin Gaib.mp3",
  "Gemetar Ketakutan.mp3",
  "Sepi yang Mencekam.mp3",
  "Ruang Hampa Mistik.mp3",
  "Kabut Gaib (Ambient).mp3",
  "Keheningan Mistik (Ambient).mp3",
  "Bayangan Mistik.mp3"
];
const jumpScareSfxNames = [
  "dragon-studio-woman-screaming-sfx-screaming-sound-effect-320169.mp3",
  "cartoon-music-game-sfx-eerie-horror-stab-525381.mp3",
  "cartoon-music-game-sfx-dynamite-exploding-525380.mp3"
];
const producerMusicVolume = Number.isFinite(Number(process.env.PRODUCER_MUSIC_VOLUME))
  ? clamp(Number(process.env.PRODUCER_MUSIC_VOLUME), 0.04, 0.42)
  : 0.28;

export async function renderDraftVideo(story) {
  const workDir = path.join(paths.storyboardDir, story.id);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(paths.videoDir, { recursive: true });
  await fs.mkdir(paths.imageDir, { recursive: true });

  const sourceAudioDuration = story.assets?.audio?.path ? await probeMediaDuration(story.assets.audio.path) : 0;
  const contentDuration = renderContentDuration(story, sourceAudioDuration);
  const narrationTempo = sourceAudioDuration > contentDuration && contentDuration > 0
    ? clamp(sourceAudioDuration / contentDuration, 1, 1.12)
    : 1;
  const captionScenes = buildRenderScenes(story, contentDuration);
  const scenes = [buildIntroCoverScene(story, captionScenes[0]), ...captionScenes, ...buildEndingScenes(story, captionScenes.at(-1))];
  const transitionDurations = scenes.map((scene, index) => {
    if (index === scenes.length - 1) return 0;
    return transitionDurationForBoundary(scene, scenes[index + 1]);
  });
  const totalDuration = scenes.reduce((sum, scene) => sum + effectiveSceneDuration(scene), 0);
  const jumpScareAt = introFreezeDuration + contentDuration + 0.04;

  const segmentPaths = [];
  const fallbackImages = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const image = await resolveSceneImage(story, scene, workDir);
    if (image.asset) fallbackImages.push(image.asset);
    const textPaths = await writeSegmentTextFiles({ story, scene, workDir });
    const segmentPath = path.join(workDir, `scene-${scene.index}.mp4`);
    await makeSegment({
      imagePath: image.path,
      textPaths,
      scene,
      segmentPath,
      tailDuration: transitionDurations[index],
      isFirst: index === 0,
      isLast: index === scenes.length - 1
    });
    segmentPaths.push(segmentPath);
  }

  const visualPath = path.join(workDir, "visual-transition.mp4");
  await combineSegmentsWithOverlayFade({ segmentPaths, scenes, transitionDurations, outputPath: visualPath });
  const subtitlePath = path.join(workDir, "captions.ass");
  await writeSubtitleAss({
    outputPath: subtitlePath,
    story,
    scenes: captionScenes,
    contentDuration,
    totalDuration,
    introDuration: introFreezeDuration,
    endCardStart: introFreezeDuration + contentDuration + jumpScareDuration
  });
  const filename = `${story.id}-${safeFilename(story.title)}.mp4`;
  const outputPath = path.join(paths.videoDir, filename);
  const fallbackAudioPath = path.join(workDir, "fallback-horror-bed.m4a");
  let audioPath;
  let audioKind;
  if (story.assets?.audio?.path) {
    const ttsMixPath = path.join(workDir, "tts-horror-mix.m4a");
    await makeTtsHorrorMix({
      inputPath: story.assets.audio.path,
      outputPath: ttsMixPath,
      workDir,
      duration: totalDuration,
      narrationDelay: introFreezeDuration,
      narrationTempo,
      jumpScareAt,
      seedText: story.id || story.title
    });
    audioPath = ttsMixPath;
    audioKind = "tts-producer-horror-jumpscare-mix";
  } else {
    const narrationText = story.plan.scenes.map((scene) => scene.narration).join(" ");
    const fallbackAudio = await makeFallbackAudio({
      outputPath: fallbackAudioPath,
      workDir,
      duration: totalDuration,
      text: narrationText,
      narrationDelay: introFreezeDuration,
      jumpScareAt,
      seedText: story.id || story.title
    });
    audioPath = fallbackAudio.path;
    audioKind = fallbackAudio.kind;
  }

  await muxVideoAudioWithAss({ videoPath: visualPath, audioPath, assPath: subtitlePath, outputPath, totalDuration });

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

function buildRenderScenes(story, targetDuration) {
  const targetContentDuration = Math.max(8, Number(targetDuration || story.input?.durationSec || 60));
  const episode = story.plan.episode || {};
  const contentScenes = fitContentScenes(story.plan.scenes, targetContentDuration)
    .map((scene) => ({
      ...scene,
      kind: "content",
      storyTitle: story.title,
      partLabel: partLabel(episode)
    }));
  return contentScenes;
}

function renderContentDuration(story, sourceAudioDuration) {
  const platformMaxDuration = Math.max(45, Number(config.instagram?.maxDurationSec || 90));
  const requestedDuration = clamp(Number(story.input?.durationSec || 60), 45, platformMaxDuration);
  const maxContentDuration = Math.max(8, platformMaxDuration - introFreezeDuration - jumpScareDuration - endCardDuration);
  const targetContentDuration = Math.max(8, requestedDuration - introFreezeDuration - jumpScareDuration - endCardDuration);
  if (sourceAudioDuration > 0) {
    return Number(Math.min(Math.max(sourceAudioDuration, targetContentDuration), maxContentDuration).toFixed(2));
  }
  return targetContentDuration;
}

function buildIntroCoverScene(story, firstScene) {
  const episode = story.plan.episode || {};
  const sourceScene = firstScene || story.plan.scenes?.[0] || {};
  return {
    ...sourceScene,
    index: 0,
    kind: "cover",
    durationSec: introFreezeDuration,
    imageSourceSceneIndex: sourceScene.index || 1,
    partLabel: partLabel(episode),
    storyTitle: story.title,
    screenText: story.title,
    narration: "",
    transition: "cover freeze",
    effect: "still cover"
  };
}

function buildEndingScenes(story, lastScene) {
  const sourceScene = lastScene || story.plan.scenes?.at(-1) || {};
  const episode = story.plan.episode || {};
  return [
    {
      ...sourceScene,
      index: 98,
      kind: "jumpscare",
      durationSec: jumpScareDuration,
      imageSourceSceneIndex: sourceScene.index || story.plan.scenes?.length || 1,
      partLabel: partLabel(episode),
      storyTitle: story.title,
      screenText: "",
      narration: "",
      transition: "sudden jumpscare flash",
      effect: "violent glitch zoom"
    },
    {
      ...sourceScene,
      index: 99,
      kind: "endcard",
      durationSec: endCardDuration,
      imageSourceSceneIndex: sourceScene.index || story.plan.scenes?.length || 1,
      partLabel: partLabel(episode),
      storyTitle: story.title,
      screenText: "Bersambung...",
      narration: "",
      transition: "fade to next part",
      effect: "dark hold"
    }
  ];
}

function transitionDurationForBoundary(fromScene, toScene) {
  if (toScene?.kind === "jumpscare") return 0.045;
  if (fromScene?.kind === "jumpscare" || toScene?.kind === "endcard") return 0.22;
  if (fromScene?.kind === "cover") return 0.18;
  return transitionDuration;
}

function effectiveSceneDuration(scene) {
  const minimum = scene?.kind === "cover" ? 0.3 : 1.5;
  return Math.max(minimum, Number(scene?.durationSec || 4));
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
  if (!items.length) return items;

  const weights = items.map((scene, index) => sceneSpeechWeight(scene.narration) + (index === items.length - 1 ? 0 : 0.65));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return items;

  let used = 0;
  return items.map((scene, index) => {
    const isLast = index === items.length - 1;
    const durationSec = isLast
      ? Math.max(1.5, Number((targetContentDuration - used).toFixed(2)))
      : Math.max(1.5, Number(((targetContentDuration * weights[index]) / totalWeight).toFixed(2)));
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
  const titleText = scene.kind === "cover"
    ? (story.plan.episode?.title || scene.storyTitle || story.title)
    : scene.index === 1
      ? (story.plan.episode?.title || scene.storyTitle || story.title)
      : scene.screenText;
  const files = {
    part: path.join(workDir, `scene-${scene.index}-part.txt`),
    title: path.join(workDir, `scene-${scene.index}-title.txt`)
  };
  await fs.writeFile(files.part, formatLines(partText, 34, 1) || "PART 1");
  await fs.writeFile(files.title, formatLines(titleText, scene.kind === "cover" ? 15 : scene.index === 1 ? 18 : 21, 2) || story.title);
  return files;
}

function formatLines(value, maxChars, maxLines) {
  return splitLines(value, maxChars).slice(0, maxLines).join("\n");
}

function ffmpegPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
}

async function makeSegment({ imagePath, textPaths, scene, segmentPath, tailDuration = transitionDuration, isFirst, isLast }) {
  const duration = effectiveSceneDuration(scene);
  const renderDuration = duration + (isLast ? 0 : tailDuration);
  const regularFont = ffmpegPath(scholarRegularFont);
  const italicFont = ffmpegPath(scholarItalicFont);
  const partTextFile = ffmpegPath(textPaths.part);
  const titleTextFile = ffmpegPath(textPaths.title);
  const frameCount = Math.ceil(renderDuration * fps);
  const overlays = segmentTextOverlays({ scene, regularFont, italicFont, partTextFile, titleTextFile });
  const zoomFilter = cameraMotionFilter(scene, frameCount);
  const vfParts = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    zoomFilter,
    "format=yuv420p",
    scene.kind === "jumpscare"
      ? "eq=contrast=1.36:saturation=0.72:brightness=0.02"
      : "eq=contrast=1.08:saturation=1.08:brightness=0.06",
    scene.kind === "jumpscare" ? "noise=alls=18:allf=t+u" : "noise=alls=5:allf=t+u",
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.04:t=fill",
    ...overlays
  ];
  if (isFirst) vfParts.push("fade=t=in:st=0:d=0.16");
  const vf = vfParts.join(",");

  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-t",
    String(renderDuration),
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

function segmentTextOverlays({ scene, regularFont, italicFont, partTextFile, titleTextFile }) {
  if (scene.kind === "cover") {
    return [
      "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.42:t=fill",
      "drawbox=x=70:y=330:w=940:h=4:color=0xe2c483@0.72:t=fill",
      "drawbox=x=70:y=1390:w=940:h=4:color=0xe2c483@0.72:t=fill",
      `drawtext=fontfile='${italicFont}':text='KISAH MISTIS':x=(w-text_w)/2:y=380:fontsize=42:fontcolor=0xe2c483:borderw=2:bordercolor=black@0.86`,
      `drawtext=fontfile='${italicFont}':textfile='${partTextFile}':x=(w-text_w)/2:y=495:fontsize=50:fontcolor=0xe2c483:borderw=3:bordercolor=black@0.9`,
      `drawtext=fontfile='${regularFont}':textfile='${titleTextFile}':x=(w-text_w)/2:y=(h-text_h)/2-18:fontsize=108:fontcolor=0xf7f1e5:line_spacing=18:borderw=7:bordercolor=black@0.96:shadowx=0:shadowy=5:shadowcolor=black@0.72`,
      `drawtext=fontfile='${italicFont}':text='jangan dengarkan sendirian':x=(w-text_w)/2:y=1442:fontsize=38:fontcolor=0xf7f1e5:borderw=2:bordercolor=black@0.88`
    ];
  }

  if (scene.kind === "jumpscare") {
    return [
      "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.16:t=fill",
      "drawbox=x=0:y=0:w=iw:h=ih:color=white@0.62:t=fill:enable='between(t\\,0\\,0.055)+between(t\\,0.17\\,0.215)'",
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x6f0000@0.22:t=fill:enable='gte(t\\,0.08)'"
    ];
  }

  if (scene.kind === "endcard") {
    return [
      "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.58:t=fill",
      "drawbox=x=120:y=840:w=840:h=3:color=0xe2c483@0.55:t=fill"
    ];
  }

  return [
    "drawbox=x=0:y=0:w=iw:h=315:color=black@0.5:t=fill",
    `drawtext=fontfile='${italicFont}':textfile='${partTextFile}':x=64:y=44:fontsize=40:fontcolor=0xe2c483:line_spacing=8:borderw=1:bordercolor=black@0.85`,
    `drawtext=fontfile='${regularFont}':textfile='${titleTextFile}':x=64:y=112:fontsize=${scene.index === 1 ? 78 : 68}:fontcolor=0xf7f1e5:line_spacing=13:borderw=4:bordercolor=black@0.92`
  ];
}

function cameraMotionFilter(scene, frameCount) {
  if (scene.kind === "cover") {
    return `zoompan=z='1.0':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${width}x${height}:fps=${fps}`;
  }
  if (scene.kind === "jumpscare") {
    return `zoompan=z='if(lt(on\\,2)\\,1.0\\,1.28+0.035*sin(on*2.9))':x='iw/2-(iw/zoom/2)+sin(on*1.2)*22':y='ih/2-(ih/zoom/2)+cos(on*1.7)*18':d=${frameCount}:s=${width}x${height}:fps=${fps}`;
  }
  if (scene.kind === "endcard") {
    return `zoompan=z='1.03':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${width}x${height}:fps=${fps}`;
  }
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

async function combineSegmentsWithOverlayFade({ segmentPaths, scenes, transitionDurations, outputPath }) {
  if (segmentPaths.length === 1) {
    await fs.copyFile(segmentPaths[0], outputPath);
    return;
  }

  let currentPath = segmentPaths[0];
  let currentDuration = effectiveSceneDuration(scenes[0]) + (transitionDurations[0] || 0);
  for (let index = 1; index < segmentPaths.length; index += 1) {
    const nextPath = segmentPaths[index];
    const boundaryDuration = transitionDurations[index - 1] || transitionDuration;
    const nextDuration = effectiveSceneDuration(scenes[index]) + (transitionDurations[index] || 0);
    const mergedPath = index === segmentPaths.length - 1
      ? outputPath
      : path.join(path.dirname(outputPath), `visual-transition-${index}.mp4`);
    const offset = Math.max(0.03, currentDuration - boundaryDuration);
    const padFrames = Math.max(1, Math.round(Math.max(0.05, nextDuration - boundaryDuration) * fps));

    await runFfmpeg([
      "-y",
      "-i",
      currentPath,
      "-i",
      nextPath,
      "-filter_complex",
      [
        `[0:v]fps=${fps},tpad=stop_mode=clone:stop=${padFrames},setpts=N/(${fps}*TB),format=yuv420p[base]`,
        `[1:v]fps=${fps},setpts=PTS-STARTPTS+${offset.toFixed(3)}/TB,format=yuva420p,fade=t=in:st=${offset.toFixed(3)}:d=${boundaryDuration.toFixed(3)}:alpha=1[over]`,
        "[base][over]overlay=eof_action=pass:shortest=0,format=yuv420p[v]"
      ].join(";"),
      "-map",
      "[v]",
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      mergedPath
    ]);

    currentPath = mergedPath;
    currentDuration = currentDuration + nextDuration - boundaryDuration;
  }
}

async function writeSubtitleAss({ outputPath, story, scenes, contentDuration, totalDuration, introDuration, endCardStart }) {
  const events = [];
  const subtitleBase = Math.max(0, Number(introDuration || 0));
  let cursor = subtitleBase;
  for (const scene of scenes) {
    const duration = effectiveSceneDuration(scene);
    const start = Math.max(subtitleBase, cursor + subtitleOffsetSeconds);
    const end = cursor + duration + subtitleOffsetSeconds;
    events.push(...captionEventsForCue(scene.narration, start, end));
    cursor += duration;
  }

  events.push({
    layer: 3,
    start: Math.max(0, Number(endCardStart || (subtitleBase + contentDuration)) + 0.03),
    end: totalDuration,
    style: "EndCard",
    text: "{\\fad(180,520)}Bersambung..."
  });

  const title = assEscape(story.title || "Mistis");
  const body = [
    "[Script Info]",
    `Title: ${title}`,
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${assStyleValue(scholarFontName)},68,&H00FFFFFF,&H0000FFFF,&H00111111,&H88000000,-1,0,0,0,100,100,0,0,1,5,2,2,86,86,500,1`,
    `Style: EndCard,${assStyleValue(scholarFontName)},88,&H00F7F1E5,&H00F7F1E5,&H00111111,&H99000000,-1,0,0,0,100,100,0,0,1,5,2,5,80,80,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
      .filter((event) => event.end > event.start + 0.08)
      .map((event) => {
        const marginV = event.style === "Caption" ? "500" : "0";
        return `Dialogue: ${event.layer || 0},${secondsToAss(event.start)},${secondsToAss(event.end)},${event.style || "Caption"},,0,0,${marginV},,${event.text}`;
      })
  ].join("\n");

  await fs.writeFile(outputPath, `${body}\n`, "utf8");
}

function captionEventsForCue(text, cueStart, cueEnd) {
  const chunks = wrapCaptionChunks(text);
  if (!chunks.length) return [];

  const start = Math.max(0, cueStart);
  const end = Math.max(start + 0.25, cueEnd);
  const duration = end - start;
  const chunkWeights = chunks.map((lines) => speechWeightForWords(wordsFromLines(lines)));
  const totalChunkWeight = chunkWeights.reduce((sum, weight) => sum + weight, 0) || chunks.length;
  const events = [];
  let chunkCursor = start;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const lines = chunks[chunkIndex];
    const chunkStart = chunkCursor;
    const chunkDuration = chunkIndex === chunks.length - 1
      ? end - chunkStart
      : (duration * (chunkWeights[chunkIndex] || 1)) / totalChunkWeight;
    const chunkEnd = chunkIndex === chunks.length - 1 ? end : Math.min(end, chunkStart + chunkDuration);
    const words = wordsFromLines(lines);
    if (!words.length || chunkEnd <= chunkStart) continue;

    const wordWeights = words.map(wordSpeechWeight);
    const totalWordWeight = wordWeights.reduce((sum, weight) => sum + weight, 0) || words.length;
    let wordCursor = chunkStart;
    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
      const wordStart = wordCursor;
      const wordDuration = wordIndex === words.length - 1
        ? chunkEnd - wordStart
        : ((chunkEnd - chunkStart) * wordWeights[wordIndex]) / totalWordWeight;
      const wordEnd = wordIndex === words.length - 1 ? chunkEnd : Math.min(chunkEnd, wordStart + wordDuration);
      if (wordEnd <= wordStart + 0.05) continue;
      events.push({
        layer: 1,
        start: wordStart,
        end: wordEnd,
        style: "Caption",
        text: formatHighlightedAssCaption(lines, wordIndex)
      });
      wordCursor = wordEnd;
    }
    chunkCursor = chunkEnd;
  }

  return events;
}

function wrapCaptionChunks(text) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const chunks = [];
  let lines = [];
  let current = "";
  const maxUnits = 13.2;
  const maxLines = 2;

  const pushLine = (line) => {
    const cleaned = line.trim();
    if (!cleaned) return;
    lines.push(cleaned);
    if (lines.length >= maxLines) {
      chunks.push(lines);
      lines = [];
    }
  };

  for (const word of words) {
    const candidate = `${current} ${word}`.trim();
    if (!current || textWidthUnits(candidate) <= maxUnits) {
      current = candidate;
      continue;
    }
    pushLine(current);
    current = word;
  }
  if (current) pushLine(current);
  if (lines.length) chunks.push(lines);
  return chunks;
}

function textWidthUnits(text) {
  let total = 0;
  for (const char of String(text || "")) {
    if (/\s/.test(char)) total += 0.35;
    else if (".,;:'!|ilI[]()".includes(char)) total += 0.32;
    else if ("mwMW@#%&".includes(char)) total += 0.86;
    else total += 0.58;
  }
  return total;
}

function sceneSpeechWeight(text) {
  const words = splitCaptionWords(text);
  return Math.max(1, speechWeightForWords(words) + punctuationPauseWeight(text));
}

function speechWeightForWords(words) {
  return words.reduce((sum, word) => sum + wordSpeechWeight(word), 0);
}

function wordSpeechWeight(word) {
  const clean = String(word || "").replace(/[^\p{L}\p{N}]/gu, "");
  const length = clean.length || 1;
  let weight = 0.24 + Math.min(1.18, length * 0.067);
  if (length <= 2) weight *= 0.74;
  if (/[,.]/.test(word)) weight += 0.1;
  if (/[;:]/.test(word)) weight += 0.16;
  if (/[!?]/.test(word)) weight += 0.24;
  if (/[.?!]$/.test(word)) weight += 0.18;
  return weight;
}

function punctuationPauseWeight(text) {
  const value = String(text || "");
  const sentencePauses = (value.match(/[.!?]/g) || []).length * 0.22;
  const softPauses = (value.match(/[,;:]/g) || []).length * 0.08;
  return sentencePauses + softPauses;
}

function splitCaptionWords(text) {
  return String(text || "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function wordsFromLines(lines) {
  return splitCaptionWords((lines || []).join(" "));
}

function formatHighlightedAssCaption(lines, activeWordIndex) {
  let index = 0;
  const formatted = lines.map((line) => {
    const words = String(line || "").split(/\s+/).filter(Boolean);
    return words.map((word) => {
      const escaped = assEscape(word);
      const active = index === activeWordIndex;
      index += 1;
      if (!active) return escaped;
      return `{\\1c&H00FFFF&\\bord6}${escaped}{\\1c&HFFFFFF&\\bord5}`;
    }).join(" ");
  });
  return `{\\1c&HFFFFFF&}${formatted.join("\\N")}`;
}

async function muxVideoAudioWithAss({ videoPath, audioPath, assPath, outputPath, totalDuration }) {
  const subtitleFilter = `subtitles='${ffmpegFilterPath(assPath)}':fontsdir='${ffmpegFilterPath(scholarFontsDir)}'`;
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-filter_complex",
    `[0:v]${subtitleFilter},format=yuv420p[v];[1:a]apad=pad_dur=2[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    Number(totalDuration).toFixed(3),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

function secondsToAss(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function assStyleValue(text) {
  return String(text || "Scholar").replace(/[\r\n,]+/g, " ").trim() || "Scholar";
}

function ffmpegFilterPath(filePath) {
  return String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

async function resolveAudioAssetPaths(names, envName) {
  const configured = String((envName && process.env[envName]) || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = configured.length
    ? configured
    : names.map((name) => path.join(producerAudioDir, name));
  const existing = [];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      existing.push(candidate);
    } catch {
      // Missing local audio is fine; renderer falls back to generated beds.
    }
  }
  return existing;
}

async function makeHorrorMusicBed({ outputPath, duration, seedText }) {
  const producerFiles = await resolveAudioAssetPaths(producerMusicNames, "HORROR_MUSIC_FILES");
  if (producerFiles.length) {
    await makeProducerMusicBed({ outputPath, duration, sourcePaths: selectProducerMusicFiles(producerFiles, seedText) });
    return outputPath;
  }
  return makeSyntheticHorrorMusicBed({ outputPath, duration });
}

async function makeProducerMusicBed({ outputPath, duration, sourcePaths }) {
  const selected = sourcePaths.filter(Boolean).slice(0, 3);
  if (!selected.length) return makeSyntheticHorrorMusicBed({ outputPath, duration });

  const total = Math.max(1, Number(duration || 1));
  const tensionStart = Math.max(4, total * 0.34);
  const climaxStart = Math.max(tensionStart + 3, total - 13);
  const fadeOutAt = Math.max(0.5, total - 1.2).toFixed(2);
  const args = ["-y"];
  for (const sourcePath of selected) args.push("-stream_loop", "-1", "-i", sourcePath);

  const filters = [];
  filters.push(`[0:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,dynaudnorm=f=180:g=8,volume=${producerMusicVolume.toFixed(3)},highpass=f=38,lowpass=f=5200,afade=t=in:st=0:d=1.1,afade=t=out:st=${fadeOutAt}:d=1.1[m0]`);
  if (selected[1]) {
    const tensionLength = Math.max(1, total - tensionStart);
    filters.push(`[1:a]atrim=0:${tensionLength.toFixed(3)},asetpts=PTS-STARTPTS,dynaudnorm=f=180:g=8,volume=${(producerMusicVolume * 0.9).toFixed(3)},highpass=f=45,lowpass=f=4800,afade=t=in:st=0:d=1.4,adelay=${Math.round(tensionStart * 1000)}:all=1[m1]`);
  }
  if (selected[2]) {
    const climaxLength = Math.max(1, total - climaxStart);
    filters.push(`[2:a]atrim=0:${climaxLength.toFixed(3)},asetpts=PTS-STARTPTS,dynaudnorm=f=180:g=8,volume=${(producerMusicVolume * 1.02).toFixed(3)},highpass=f=52,lowpass=f=5600,afade=t=in:st=0:d=0.8,adelay=${Math.round(climaxStart * 1000)}:all=1[m2]`);
  }

  const labels = selected.map((_, index) => `[m${index}]`).join("");
  filters.push(`${labels}amix=inputs=${selected.length}:duration=longest:normalize=0,lowpass=f=6200,alimiter=limit=0.72[a]`);

  await runFfmpeg([
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[a]",
    "-t",
    total.toFixed(3),
    "-c:a",
    "pcm_s16le",
    "-ar",
    "44100",
    outputPath
  ]);

  return outputPath;
}

function selectProducerMusicFiles(sourcePaths, seedText) {
  if (sourcePaths.length <= 3) return sourcePaths;
  const seed = hashText(seedText || sourcePaths.join("|"));
  const ambient = sourcePaths.filter((item) => /ambient|kabut|keheningan|ruang|sepi/i.test(path.basename(item)));
  const dramatic = sourcePaths.filter((item) => /puncak|hawa|gemetar|bayangan/i.test(path.basename(item)));
  const pick = (items, offset) => items[(seed + offset) % items.length];
  return [
    pick(ambient.length ? ambient : sourcePaths, 0),
    pick(dramatic.length ? dramatic : sourcePaths, 3),
    pick(sourcePaths, 6)
  ].filter((item, index, array) => item && array.indexOf(item) === index);
}

async function makeSyntheticHorrorMusicBed({ outputPath, duration }) {
  const sampleRate = 44100;
  const sampleCount = Math.max(1, Math.ceil(Number(duration || 1) * sampleRate));
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  const roots = [43.65, 46.25, 49.0, 41.2];

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleRate;
    const total = sampleCount / sampleRate;
    const fadeIn = Math.min(1, t / 1.2);
    const fadeOut = Math.min(1, Math.max(0, (total - t) / 1.4));
    const fade = fadeIn * fadeOut;
    const root = roots[Math.floor(t / 7.5) % roots.length];
    const tremolo = 0.62 + 0.38 * Math.sin(2 * Math.PI * 0.11 * t);
    const drone =
      0.32 * Math.sin(2 * Math.PI * root * t) +
      0.22 * Math.sin(2 * Math.PI * root * 1.05946 * t) +
      0.18 * Math.sin(2 * Math.PI * root * 2.01 * t) +
      0.1 * Math.sin(2 * Math.PI * root * 3.03 * t);
    const pad =
      0.11 * Math.sin(2 * Math.PI * 146.83 * t + Math.sin(t * 0.37) * 0.7) +
      0.08 * Math.sin(2 * Math.PI * 311.13 * t + Math.sin(t * 0.19) * 0.9);
    const pulsePhase = t % 3.15;
    const pulse = pulsePhase < 0.38
      ? Math.sin(2 * Math.PI * (58 + pulsePhase * 28) * t) * Math.exp(-pulsePhase * 7.5)
      : 0;
    const stingPhase = t % 11.2;
    const sting = stingPhase < 1.1
      ? Math.sin(2 * Math.PI * (392 + stingPhase * 120) * t) * Math.exp(-stingPhase * 4.5)
      : 0;
    const noise = (Math.sin(t * 1297.13) * Math.sin(t * 313.71) * Math.sin(t * 771.9)) * 0.08;
    const value = Math.tanh(((drone * tremolo) + pad + (pulse * 0.82) + (sting * 0.3) + noise) * 1.15) * fade * 0.72;
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), 44 + index * 2);
  }

  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

async function makeFallbackAudio({ outputPath, workDir, duration, text, narrationDelay = 0, jumpScareAt = 0, seedText }) {
  const narrationPath = outputPath.replace(/\.m4a$/i, "-narration.wav");
  const narrationTextPath = outputPath.replace(/\.m4a$/i, "-narration.txt");
  const baseOutputPath = outputPath.replace(/\.m4a$/i, "-base.m4a");
  const musicPath = path.join(workDir || path.dirname(outputPath), "dramatic-horror-music.wav");
  await makeHorrorMusicBed({ outputPath: musicPath, duration, seedText });
  const delayMs = Math.max(0, Math.round(Number(narrationDelay || 0) * 1000));
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
        `[0:a]adelay=${delayMs}:all=1,volume=2.35,aecho=0.65:0.35:70:0.2,highpass=f=85,lowpass=f=5400,dynaudnorm=f=120:g=13[n]`,
        "[1:a]volume=0.42,lowpass=f=95,aecho=0.6:0.25:900:0.18[a0]",
        "[2:a]volume=0.25,lowpass=f=230,tremolo=f=0.22:d=0.85[a1]",
        "[3:a]volume=0.15,lowpass=f=460,tremolo=f=0.35:d=0.8,aecho=0.45:0.25:760:0.18[a2]",
        "[4:a]volume=0.34,highpass=f=70,lowpass=f=1450[a3]",
        "[5:a]volume=0.12,highpass=f=900,lowpass=f=3900,tremolo=f=8:d=0.72[a4]",
        "[6:a]volume=0.19,highpass=f=160,lowpass=f=780,tremolo=f=0.42:d=0.88,aecho=0.55:0.28:1180:0.22[a5]",
        "[7:a]volume=0.18,highpass=f=105,lowpass=f=620,tremolo=f=0.12:d=0.92,aecho=0.62:0.32:1420:0.28[m0]",
        "[8:a]volume=0.075,highpass=f=240,lowpass=f=1300,tremolo=f=5.2:d=0.42,aecho=0.38:0.22:520:0.16[m1]",
        "[9:a]volume=1.56,highpass=f=32,lowpass=f=4200,aecho=0.5:0.28:1180:0.18[music]",
        `[n][a0][a1][a2][a3][a4][a5][m0][m1][music]amix=inputs=10:duration=longest:normalize=0,lowpass=f=7200,volume=1.08,alimiter=limit=0.95,afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOutAt}:d=0.65[a]`
      ].join(";")
    : [
        "[0:a]volume=0.46,lowpass=f=95,aecho=0.6:0.25:900:0.18[a0]",
        "[1:a]volume=0.29,lowpass=f=230,tremolo=f=0.22:d=0.85[a1]",
        "[2:a]volume=0.18,lowpass=f=460,tremolo=f=0.35:d=0.8,aecho=0.45:0.25:760:0.18[a2]",
        "[3:a]volume=0.38,highpass=f=70,lowpass=f=1450[a3]",
        "[4:a]volume=0.13,highpass=f=900,lowpass=f=3900,tremolo=f=8:d=0.72[a4]",
        "[5:a]volume=0.23,highpass=f=160,lowpass=f=780,tremolo=f=0.42:d=0.88,aecho=0.55:0.28:1180:0.22[a5]",
        "[6:a]volume=0.2,highpass=f=105,lowpass=f=620,tremolo=f=0.12:d=0.92,aecho=0.62:0.32:1420:0.28[m0]",
        "[7:a]volume=0.085,highpass=f=240,lowpass=f=1300,tremolo=f=5.2:d=0.42,aecho=0.38:0.22:520:0.16[m1]",
        "[8:a]volume=1.62,highpass=f=32,lowpass=f=4200,aecho=0.5:0.28:1180:0.18[music]",
        `[a0][a1][a2][a3][a4][a5][m0][m1][music]amix=inputs=9:duration=longest:normalize=0,lowpass=f=6200,volume=1.28,alimiter=limit=0.95,afade=t=in:st=0:d=0.45,afade=t=out:st=${fadeOutAt}:d=0.65[a]`
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
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=293:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=147:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=311:sample_rate=44100",
    "-i",
    musicPath,
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
    baseOutputPath
  );

  await runFfmpeg(args);
  await addJumpScareSfx({
    basePath: baseOutputPath,
    outputPath,
    workDir,
    duration,
    jumpScareAt
  });

  return {
    path: outputPath,
    kind: hasNarration ? "local-voice-producer-horror-jumpscare-mix" : "fallback-producer-horror-jumpscare-mix"
  };
}

async function makeTtsHorrorMix({ inputPath, outputPath, workDir, duration, narrationDelay = 0, narrationTempo = 1, jumpScareAt = 0, seedText }) {
  const baseOutputPath = outputPath.replace(/\.m4a$/i, "-base.m4a");
  const musicPath = path.join(workDir || path.dirname(outputPath), "dramatic-horror-music.wav");
  await makeHorrorMusicBed({ outputPath: musicPath, duration, seedText });
  const delayMs = Math.max(0, Math.round(Number(narrationDelay || 0) * 1000));
  const tempo = clamp(Number(narrationTempo || 1), 0.8, 1.35);
  const tempoFilter = Math.abs(tempo - 1) > 0.01 ? `atempo=${tempo.toFixed(4)},` : "";
  const fadeOutAt = Math.max(0.5, duration - 0.7).toFixed(2);
  const filter = [
    `[0:a]${tempoFilter}adelay=${delayMs}:all=1,volume=2.55,aecho=0.5:0.22:70:0.14,highpass=f=85,lowpass=f=5800,dynaudnorm=f=110:g=15[n]`,
    "[1:a]volume=0.24,lowpass=f=95,aecho=0.6:0.28:960:0.2[a0]",
    "[2:a]volume=0.13,lowpass=f=230,tremolo=f=0.2:d=0.9[a1]",
    "[3:a]volume=0.08,lowpass=f=460,tremolo=f=0.34:d=0.82,aecho=0.45:0.25:760:0.2[a2]",
    "[4:a]volume=0.18,highpass=f=72,lowpass=f=1450[a3]",
    "[5:a]volume=0.06,highpass=f=900,lowpass=f=3900,tremolo=f=8.5:d=0.76[a4]",
    "[6:a]volume=0.1,highpass=f=160,lowpass=f=780,tremolo=f=0.42:d=0.88,aecho=0.55:0.28:1180:0.22[a5]",
    "[7:a]volume=0.1,highpass=f=105,lowpass=f=620,tremolo=f=0.12:d=0.92,aecho=0.62:0.32:1420:0.28[m0]",
    "[8:a]volume=0.045,highpass=f=240,lowpass=f=1300,tremolo=f=5.2:d=0.42,aecho=0.38:0.22:520:0.16[m1]",
    "[9:a]volume=1.56,highpass=f=32,lowpass=f=4200,aecho=0.5:0.28:1180:0.18[music]",
    `[n][a0][a1][a2][a3][a4][a5][m0][m1][music]amix=inputs=10:duration=longest:normalize=0,lowpass=f=7400,volume=1.08,alimiter=limit=0.95,afade=t=in:st=0:d=0.2,afade=t=out:st=${fadeOutAt}:d=0.65[a]`
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
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=293:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=147:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "sine=frequency=311:sample_rate=44100",
    "-i",
    musicPath,
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
    baseOutputPath
  ]);

  await addJumpScareSfx({
    basePath: baseOutputPath,
    outputPath,
    workDir,
    duration,
    jumpScareAt
  });
}

async function addJumpScareSfx({ basePath, outputPath, workDir, duration, jumpScareAt }) {
  const sfxPath = path.join(workDir || path.dirname(outputPath), "jumpscare-sfx.wav");
  await makeJumpScareSfxBed({ outputPath: sfxPath, duration, jumpScareAt });
  await runFfmpeg([
    "-y",
    "-i",
    basePath,
    "-i",
    sfxPath,
    "-filter_complex",
    "[0:a]volume=1.0[base];[1:a]volume=1.0[sfx];[base][sfx]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.96[a]",
    "-map",
    "[a]",
    "-t",
    Number(duration).toFixed(3),
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    "192k",
    outputPath
  ]);
}

async function makeJumpScareSfxBed({ outputPath, duration, jumpScareAt }) {
  const sourcePaths = await resolveAudioAssetPaths(jumpScareSfxNames, "JUMPSCARE_SFX_FILES");
  if (!sourcePaths.length) return makeSyntheticJumpScareSfxBed({ outputPath, duration, jumpScareAt });

  const total = Math.max(1, Number(duration || 1));
  const start = clamp(Number(jumpScareAt || total - 3), 0.2, Math.max(0.2, total - 0.9));
  const args = ["-y"];
  for (const sourcePath of sourcePaths) args.push("-i", sourcePath);

  const offsets = [-0.08, 0, 0.14];
  const lengths = [1.7, 1.05, 1.35];
  const volumes = [0.62, 0.58, 0.34];
  const filters = sourcePaths.map((_, index) => {
    const offsetMs = Math.max(0, Math.round((start + (offsets[index] || 0)) * 1000));
    return `[${index}:a]atrim=0:${lengths[index] || 1.1},asetpts=PTS-STARTPTS,volume=${volumes[index] || 0.38},highpass=f=75,lowpass=f=9200,afade=t=out:st=${Math.max(0.25, (lengths[index] || 1.1) - 0.22).toFixed(2)}:d=0.22,adelay=${offsetMs}:all=1[s${index}]`;
  });
  const labels = sourcePaths.map((_, index) => `[s${index}]`).join("");
  filters.push(`${labels}amix=inputs=${sourcePaths.length}:duration=longest:normalize=0,alimiter=limit=0.9[a]`);

  await runFfmpeg([
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[a]",
    "-t",
    total.toFixed(3),
    "-c:a",
    "pcm_s16le",
    "-ar",
    "44100",
    outputPath
  ]);

  return outputPath;
}

async function makeSyntheticJumpScareSfxBed({ outputPath, duration, jumpScareAt }) {
  const total = Math.max(1, Number(duration || 1));
  const start = clamp(Number(jumpScareAt || total - 3), 0.2, Math.max(0.2, total - 0.9));
  const startMs = Math.round(start * 1000);
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-t",
    "1.2",
    "-i",
    "anoisesrc=color=white:amplitude=0.38:sample_rate=44100",
    "-f",
    "lavfi",
    "-t",
    "1.0",
    "-i",
    "sine=frequency=880:sample_rate=44100",
    "-filter_complex",
    `[0:a]highpass=f=500,lowpass=f=7000,volume=0.5,adelay=${startMs}:all=1[s0];[1:a]volume=0.35,aecho=0.5:0.25:110:0.18,adelay=${startMs + 80}:all=1[s1];[s0][s1]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.86[a]`,
    "-map",
    "[a]",
    "-t",
    total.toFixed(3),
    "-c:a",
    "pcm_s16le",
    "-ar",
    "44100",
    outputPath
  ]);
  return outputPath;
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

function probeMediaDuration(filePath) {
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
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(0);
        return;
      }
      const duration = Number(stdout.trim());
      resolve(Number.isFinite(duration) ? duration : 0);
    });
  });
}

function hashScene(scene) {
  const text = `${scene.screenText || ""}${scene.narration || ""}`;
  return hashText(text);
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < String(text || "").length; i += 1) hash = (hash * 31 + String(text || "").charCodeAt(i)) >>> 0;
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
