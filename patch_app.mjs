import fs from 'fs';
let text = fs.readFileSync('src/App.tsx', 'utf8');

text = text.replace(
  "let ext = item.container_extension || 'mp4';\n      if (ext === 'mkv') ext = 'mp4';",
  "const ext = item.container_extension;"
);

text = text.replace(
  "let ext = seriesMeta.episode.container_extension || 'mp4';\n      if (ext === 'mkv') ext = 'mp4';",
  "const ext = seriesMeta.episode.container_extension;"
);

fs.writeFileSync('src/App.tsx', text);
