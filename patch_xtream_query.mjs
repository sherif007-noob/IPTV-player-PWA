import fs from 'fs';
let text = fs.readFileSync('src/services/xtream.ts', 'utf8');

text = text.replace(
  'const primaryUrl = shouldProxy\n      ? `${baseUrl}/api/xtream/proxy?url=${encodeURIComponent(url)}`\n      : url;',
  `let primaryUrl = shouldProxy
      ? \`\${baseUrl}/api/xtream/proxy?url=\${encodeURIComponent(url)}\`
      : url;
      
    if (shouldProxy && this.credentials) {
      if (this.credentials.userAgent) primaryUrl += \`&ua=\${encodeURIComponent(this.credentials.userAgent)}\`;
      if (this.credentials.referer) primaryUrl += \`&referer=\${encodeURIComponent(this.credentials.referer)}\`;
      if (this.credentials.origin) primaryUrl += \`&origin=\${encodeURIComponent(this.credentials.origin)}\`;
    }`
);

text = text.replace(
  'if (shouldProxy) {\n      const baseUrl = typeof window !== \'undefined\' && !isFileProtocol ? window.location.origin : \'\';\n      return `${baseUrl}/api/xtream/stream?url=${encodeURIComponent(streamTarget)}`;\n    }',
  `if (shouldProxy) {
      const baseUrl = typeof window !== 'undefined' && !isFileProtocol ? window.location.origin : '';
      let proxyUrl = \`\${baseUrl}/api/xtream/stream?url=\${encodeURIComponent(streamTarget)}\`;
      if (this.credentials) {
        if (this.credentials.userAgent) proxyUrl += \`&ua=\${encodeURIComponent(this.credentials.userAgent)}\`;
        if (this.credentials.referer) proxyUrl += \`&referer=\${encodeURIComponent(this.credentials.referer)}\`;
        if (this.credentials.origin) proxyUrl += \`&origin=\${encodeURIComponent(this.credentials.origin)}\`;
      }
      return proxyUrl;
    }`
);

fs.writeFileSync('src/services/xtream.ts', text);
