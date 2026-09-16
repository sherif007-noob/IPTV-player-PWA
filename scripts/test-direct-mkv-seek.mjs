import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
if (!ffmpeg) throw new Error("ffmpeg-static did not resolve");

const root = path.resolve(".github", "mkv-seek-fixture");
const fixture = path.join(root, "fixture.mkv");
const output = path.join(root, "seeked.mp4");
await fs.mkdir(root, { recursive: true });

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stderr) : reject(new Error(`${command} exited with ${code}\n${stderr}`)));
  });
}

// Generate a small indexed Matroska fixture so the test does not depend on any external media server.
await run(ffmpeg, [
  "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25",
  "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
  "-t", "12",
  "-c:v", "libx264", "-preset", "ultrafast", "-g", "25", "-bf", "0",
  "-c:a", "aac", "-b:a", "96k",
  "-f", "matroska", "-y", fixture,
]);

const media = await fs.readFile(fixture);
const requests = [];
const server = createServer((req, res) => {
  if (req.url !== "/fixture.mkv") {
    res.writeHead(404).end();
    return;
  }
  const range = req.headers.range;
  requests.push({ method: req.method, range: range || null });

  if (req.method === "HEAD") {
    res.writeHead(200, {
      "Content-Type": "video/x-matroska",
      "Content-Length": media.length,
      "Accept-Ranges": "bytes",
    }).end();
    return;
  }

  if (!range) {
    res.writeHead(200, {
      "Content-Type": "video/x-matroska",
      "Content-Length": media.length,
      "Accept-Ranges": "bytes",
    });
    res.end(media);
    return;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${media.length}` }).end();
    return;
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : media.length - 1;
  if (!Number.isSafeInteger(start) || start >= media.length) {
    res.writeHead(416, { "Content-Range": `bytes */${media.length}` }).end();
    return;
  }
  const end = Math.min(requestedEnd, media.length - 1);
  const chunk = media.subarray(start, end + 1);
  res.writeHead(206, {
    "Content-Type": "video/x-matroska",
    "Content-Length": chunk.length,
    "Content-Range": `bytes ${start}-${end}/${media.length}`,
    "Accept-Ranges": "bytes",
  });
  res.end(chunk);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/fixture.mkv`;

try {
  // This is intentionally the architecture used by the new server path:
  // FFmpeg opens the remote URL itself and performs input-side seeking.
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error",
    "-ss", "6",
    "-user_agent", "IPTVSmartersPlayer/3.0.0",
    "-i", url,
    "-t", "2",
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "ultrafast", "-bf", "0",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4", "-y", output,
  ]);

  const stat = await fs.stat(output);
  if (stat.size < 1024) throw new Error(`Seeked output is unexpectedly small: ${stat.size} bytes`);

  const rangeRequests = requests.filter((request) => request.range);
  if (rangeRequests.length === 0) {
    throw new Error(`FFmpeg successfully transcoded, but never used HTTP Range. Requests: ${JSON.stringify(requests)}`);
  }

  console.log("Direct MKV URL seek test passed.");
  console.log(`Fixture size: ${media.length} bytes`);
  console.log(`Output size: ${stat.size} bytes`);
  console.log(`HTTP requests: ${requests.length}`);
  console.log(`HTTP Range requests: ${rangeRequests.length}`);
  console.log(JSON.stringify(requests, null, 2));
} finally {
  server.close();
  await fs.rm(root, { recursive: true, force: true });
}
