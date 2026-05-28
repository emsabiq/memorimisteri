import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import { config, paths } from "./config.js";

export function publicBaseUrl() {
  return String(config.publicBaseUrl || "").replace(/\/+$/g, "");
}

export function remoteEnabled() {
  return Boolean(config.ftp.host && config.ftp.user && config.ftp.password && config.ftp.remoteDir);
}

export function absolutizeGeneratedUrls(story) {
  const base = publicBaseUrl();
  if (!base || !story) return story;
  const withUrl = (asset) => {
    if (!asset?.url) return asset;
    if (/^https?:\/\//i.test(asset.url)) return asset;
    return { ...asset, url: `${base}${String(asset.url).replace(/^\/generated\//, "/")}` };
  };
  return {
    ...story,
    assets: {
      ...story.assets,
      video: withUrl(story.assets?.video),
      audio: withUrl(story.assets?.audio),
      images: (story.assets?.images || []).map(withUrl)
    }
  };
}

export async function uploadStoryAssets(story) {
  const cfg = assertRemoteConfig();
  await withRemoteClient(cfg, async (client) => {
    const assets = [
      story.assets?.video,
      story.assets?.audio,
      ...(story.assets?.images || [])
    ].filter((asset) => asset?.path && asset?.url);

    for (const asset of assets) {
      const remotePath = remotePathFromAssetUrl(asset.url);
      if (!remotePath) continue;
      await client.ensureDir(path.posix.dirname(remotePath));
      await client.upload(asset.path, remotePath);
    }
    await uploadJsonFile(client, path.join(paths.dataDir, "stories.json"), "state/stories.json");
    await uploadJsonFile(client, path.join(paths.dataDir, "submissions.json"), "state/submissions.json").catch(() => {});
  });
}

export async function uploadPublicSite() {
  const cfg = assertRemoteConfig();
  await withRemoteClient(cfg, async (client) => {
    const files = ["fan.php", "styles.css"];
    for (const name of files) {
      const localPath = path.join(paths.publicDir, name);
      await client.upload(localPath, name);
    }
    await client.ensureDir("state");
    await client.ensureDir("submissions");
  });
}

export async function uploadSubmissionAssets(submission) {
  const cfg = assertRemoteConfig();
  await withRemoteClient(cfg, async (client) => {
    const filePath = submission.file?.path;
    const url = submission.file?.url || "";
    if (filePath && url) {
      const remotePath = String(url).replace(/^\/+/, "");
      await client.ensureDir(path.posix.dirname(remotePath));
      await client.upload(filePath, remotePath);
    }
    await uploadJsonFile(client, path.join(paths.dataDir, "submissions.json"), "state/submissions.json");
  });
}

function assertRemoteConfig() {
  const missing = [];
  if (!config.ftp.host) missing.push("FTP_HOST/SFTP_HOST");
  if (!config.ftp.user) missing.push("FTP_USER/SFTP_USER");
  if (!config.ftp.password) missing.push("FTP_PASSWORD/SFTP_PASSWORD");
  if (!config.ftp.remoteDir) missing.push("FTP_REMOTE_DIR/SFTP_REMOTE_DIR");
  if (missing.length) throw new Error(`Remote upload config belum lengkap: ${missing.join(", ")}`);
  return {
    driver: config.ftp.driver === "auto" ? (process.env.SFTP_HOST ? "sftp" : "ftp") : config.ftp.driver,
    host: config.ftp.host,
    port: config.ftp.port,
    user: config.ftp.user,
    password: config.ftp.password,
    remoteDir: config.ftp.remoteDir
  };
}

async function withRemoteClient(cfg, callback) {
  if (cfg.driver === "sftp") {
    const client = new SftpClient();
    try {
      await client.connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 180000 });
      await client.mkdir(cfg.remoteDir, true);
      await callback(new SftpAdapter(client, cfg.remoteDir));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  const client = new FtpClient(180000);
  try {
    await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: false });
    await client.ensureDir(cfg.remoteDir);
    await callback(new FtpAdapter(client, cfg.remoteDir));
  } finally {
    client.close();
  }
}

function remotePathFromAssetUrl(value) {
  const raw = String(value || "");
  if (raw.startsWith("/generated/")) return raw.replace(/^\/generated\//, "");
  if (raw.startsWith("/")) return raw.replace(/^\/+/, "");
  try {
    const url = new URL(raw);
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const generatedIndex = pathname.indexOf("generated/");
    if (generatedIndex >= 0) return pathname.slice(generatedIndex + "generated/".length);
    const known = pathname.match(/(?:^|\/)(videos|images|audio)\/[^/]+$/);
    return known ? known[0].replace(/^\/+/, "") : "";
  } catch {
    return "";
  }
}

async function uploadJsonFile(client, localPath, remotePath) {
  const raw = await fs.readFile(localPath, "utf8");
  await client.ensureDir(path.posix.dirname(remotePath));
  await client.uploadStream(Readable.from([Buffer.from(raw, "utf8")]), remotePath);
}

class FtpAdapter {
  constructor(client, root) {
    this.client = client;
    this.root = root;
  }
  async ensureDir(dir) {
    await this.client.ensureDir(path.posix.join(this.root, dir));
  }
  async upload(localPath, remotePath) {
    await this.client.uploadFrom(localPath, path.posix.join(this.root, remotePath));
  }
  async uploadStream(stream, remotePath) {
    await this.client.uploadFrom(stream, path.posix.join(this.root, remotePath));
  }
}

class SftpAdapter {
  constructor(client, root) {
    this.client = client;
    this.root = root;
  }
  resolve(remotePath) {
    return path.posix.join(this.root, remotePath);
  }
  async ensureDir(dir) {
    await this.client.mkdir(this.resolve(dir), true);
  }
  async upload(localPath, remotePath) {
    await this.client.put(localPath, this.resolve(remotePath));
  }
  async uploadStream(stream, remotePath) {
    await this.client.put(stream, this.resolve(remotePath));
  }
}
