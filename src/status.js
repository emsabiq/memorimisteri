import { spawnSync } from "node:child_process";
import { publicConfig } from "./config.js";

const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });

console.log(JSON.stringify({
  config: publicConfig(),
  tools: {
    ffmpeg: ffmpeg.status === 0
  }
}, null, 2));
