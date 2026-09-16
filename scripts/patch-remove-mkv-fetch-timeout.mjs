import fs from 'fs';
const path = 'server.ts';
const text = fs.readFileSync(path, 'utf8');
const oldText = 'upstream = await fetch(streamUrl, { method: "GET", headers: upstreamHeaders, redirect: "follow", signal: AbortSignal.timeout(30000) });';
const newText = 'upstream = await fetch(streamUrl, { method: "GET", headers: upstreamHeaders, redirect: "follow" });';
if (!text.includes(oldText)) throw new Error('Expected MKV upstream fetch timeout expression not found');
fs.writeFileSync(path, text.replace(oldText, newText));
