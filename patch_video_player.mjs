import fs from 'fs';
const text = fs.readFileSync('src/components/VideoPlayer.tsx', 'utf8');

let newText = text.replace(
  `msg = 'The stream source container or codec is not supported by the player.';`,
  `if (item.type === 'vod' || item.type === 'series') {
                  msg = 'The stream container or codec is not supported by your browser (often MKV or HEVC/AC3 codecs). Try opening this stream in an external player like VLC.';
                } else {
                  msg = 'The stream source container or codec is not supported by the player.';
                }`
);

newText = newText.replace(
  `{/* Container extension switcher (MKV <-> MP4) */}`,
  `{/* Open in VLC Button */}
            {(item.type === 'vod' || item.type === 'series') && (
              <a
                href={"vlc://" + xtreamService.getDirectStreamTarget(item.type, item.type === 'series' && seriesMeta ? seriesMeta.episode.id : item.id, activeUrl.includes('.mp4') ? 'mp4' : 'mkv')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs tv-focus transition-all shadow-lg shadow-orange-500/25 mt-2"
              >
                <span>Open in VLC Player</span>
              </a>
            )}

            {/* Container extension switcher (MKV <-> MP4) */}`
);

fs.writeFileSync('src/components/VideoPlayer.tsx', newText);
