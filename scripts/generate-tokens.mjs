import { readFileSync, writeFileSync } from 'node:fs';
const tokens = JSON.parse(
  readFileSync(new URL('../docs/design/tokens.json', import.meta.url), 'utf8'),
);
const lines = ['/* Generated from docs/design/tokens.json. */', ':root {'];
for (const [key, value] of Object.entries(tokens.color)) {
  lines.push(`  --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`);
}
lines.push(
  `  --shadow-card: ${tokens.shadow.card};`,
  `  --font-family: ${tokens.font.family.map((s) => (s.includes(' ') ? `"${s}"` : s)).join(', ')};`,
  '}',
);
const content = lines.join('\n') + '\n';
const path = new URL('../src/app/tokens.css', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== content)
    throw new Error('Design tokens changed. Run npm run tokens.');
} else writeFileSync(path, content);
