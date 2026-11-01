// Replaces schemas/s2c.json and c2s.json with the latest release of sruon/XiPackets-definitions.
// layouts.json is ours and stays.
import { writeFileSync } from 'node:fs';

const RELEASE = 'https://github.com/sruon/XiPackets-definitions/releases/download/latest';

for (const name of ['s2c.json', 'c2s.json']) {
  const res = await fetch(`${RELEASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const text = await res.text();
  JSON.parse(text);
  writeFileSync(new URL(`../schemas/${name}`, import.meta.url), text);
  console.log(`schemas/${name}: ${text.length} bytes`);
}
