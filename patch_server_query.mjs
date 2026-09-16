import fs from 'fs';
let text = fs.readFileSync('server.ts', 'utf8');

text = text.replace(
  'function getUpstreamHeaders(req: express.Request, extraHeaders?: Record<string, string>): Record<string, string> {',
  `function getUpstreamHeaders(req: express.Request, extraHeaders?: Record<string, string>): Record<string, string> {
    const q_ua = req.query.ua as string;
    const q_referer = req.query.referer as string;
    const q_origin = req.query.origin as string;`
);

text = text.replace(
  '// User-Agent\n    if (PROVIDER_USER_AGENT) {\n      headers["User-Agent"] = PROVIDER_USER_AGENT;\n    }',
  `// User-Agent
    if (q_ua) {
      headers["User-Agent"] = q_ua;
    } else if (PROVIDER_USER_AGENT) {
      headers["User-Agent"] = PROVIDER_USER_AGENT;
    }`
);

text = text.replace(
  '// Referer\n    if (PROVIDER_REFERER) {\n      headers["Referer"] = PROVIDER_REFERER;\n    }',
  `// Referer
    if (q_referer) {
      headers["Referer"] = q_referer;
    } else if (PROVIDER_REFERER) {
      headers["Referer"] = PROVIDER_REFERER;
    }`
);

text = text.replace(
  '// Origin\n    if (PROVIDER_ORIGIN) {\n      headers["Origin"] = PROVIDER_ORIGIN;\n    }',
  `// Origin
    if (q_origin) {
      headers["Origin"] = q_origin;
    } else if (PROVIDER_ORIGIN) {
      headers["Origin"] = PROVIDER_ORIGIN;
    }`
);

fs.writeFileSync('server.ts', text);
