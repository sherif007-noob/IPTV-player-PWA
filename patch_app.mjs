import fs from 'fs';
let text = fs.readFileSync('src/App.tsx', 'utf8');

text = text.replace(
  "const ext = item.container_extension || 'mkv';",
  "let ext = item.container_extension || 'mp4';\n      if (ext === 'mkv') ext = 'mp4';"
);

text = text.replace(
  "const ext = seriesMeta.episode.container_extension || 'mkv';",
  "let ext = seriesMeta.episode.container_extension || 'mp4';\n      if (ext === 'mkv') ext = 'mp4';"
);

fs.writeFileSync('src/App.tsx', text);
