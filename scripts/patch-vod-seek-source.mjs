import fs from 'node:fs';

const path = 'src/components/VideoPlayer.tsx';
const source = fs.readFileSync(path, 'utf8');
const needle = '    setActiveUrl(nextUrl);';
const replacement = `    setActiveUrl(nextUrl);\n\n    // Explicitly replace the media element source after React commits the state.\n    // The old FFmpeg response is not seekable, so the browser must issue a new\n    // request to the proxy URL containing start=<target>.\n    window.setTimeout(() => {\n      const currentVideo = videoRef.current;\n      if (!currentVideo || currentVideo !== video) return;\n      try {\n        currentVideo.src = nextUrl;\n        currentVideo.load();\n        if (!wasPaused) safePlay();\n      } catch {}\n    }, 0);`;
if (!source.includes(needle)) throw new Error('Expected seek source assignment was not found');
const count = source.split(needle).length - 1;
if (count !== 1) throw new Error(`Expected exactly one seek source assignment, found ${count}`);
fs.writeFileSync(path, source.replace(needle, replacement));
