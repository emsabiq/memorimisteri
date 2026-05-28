import { ensureProjectDirs } from "./config.js";
import { uploadPublicSite } from "./remote.js";

ensureProjectDirs();
await uploadPublicSite();
console.log("Public fan site uploaded.");
