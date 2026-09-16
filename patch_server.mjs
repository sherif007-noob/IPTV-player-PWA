import fs from 'fs';
let text = fs.readFileSync('server.ts', 'utf8');
text = text.replace(
  'console.warn(`Upstream stream error (${upstream.status}):`, errText.slice(0, 200));',
  'if (upstream.status !== 404) console.warn(`Upstream stream error (${upstream.status}):`, errText.slice(0, 200));'
);
fs.writeFileSync('server.ts', text);
