import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "./config.js";

const storiesFile = path.join(paths.dataDir, "stories.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, file);
}

export async function listStories() {
  const stories = await readJson(storiesFile, []);
  return stories.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function getStory(id) {
  const stories = await readJson(storiesFile, []);
  return stories.find((story) => story.id === id) || null;
}

export async function saveStory(story) {
  const stories = await readJson(storiesFile, []);
  const index = stories.findIndex((item) => item.id === story.id);
  if (index >= 0) stories[index] = story;
  else stories.push(story);
  await writeJson(storiesFile, stories);
  return story;
}
