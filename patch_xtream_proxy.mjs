import fs from 'fs';
let text = fs.readFileSync('src/services/xtream.ts', 'utf8');

text = text.replace(
  `    let shouldProxy = !isFileProtocol && this.credentials?.proxyEnabled !== false;
    if (isHttpsBrowser && streamTarget.startsWith('http:')) {
      shouldProxy = true;
    }`,
  `    let shouldProxy = false;
    const isWebOS = typeof window !== 'undefined' && 
                   (window.location.protocol === 'file:' || 
                    typeof (window as any).webOS !== 'undefined' || 
                    (window.navigator && window.navigator.userAgent.includes('Web0S')));
                    
    if (!isWebOS) {
      // In a normal Browser/PWA, VOD and Series MUST be proxied to bypass CORS/Headers blocks
      if (type === 'vod' || type === 'series') {
        shouldProxy = true;
      } else {
        // Live TV follows user preference or HTTPS requirement
        shouldProxy = this.credentials?.proxyEnabled !== false;
      }
      
      if (isHttpsBrowser && streamTarget.startsWith('http:')) {
        shouldProxy = true;
      }
    }`
);

fs.writeFileSync('src/services/xtream.ts', text);
