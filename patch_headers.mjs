import fs from 'fs';
const text = fs.readFileSync('server.ts', 'utf8');
const patched = text.replace(
  'const clientIp = getClientIp(req);',
  `const clientIp = getClientIp(req);
    // Anti-geo-block: if our datacenter IP is blocked, some IPTV panels trust X-Forwarded-For to authorize the client's home IP
    if (clientIp) {
      extraHeaders["X-Forwarded-For"] = clientIp;
    }`
);
fs.writeFileSync('server.ts', patched);
