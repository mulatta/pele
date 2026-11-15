// node scripts/compare-svg.mjs <before bundle> <after bundle>: every corpus diagram must render
// to the same SVG, with and without source info and in a narrow width, or fail with the same
// message, in both.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [before, after] = await Promise.all(process.argv.slice(2, 4).map((p) => import(pathToFileURL(resolve(p)).href)));
const out = (lib, src, options) => {
  try {
    return lib.render(src, options).svg;
  } catch (e) {
    return `error: ${e.message}`;
  }
};
const now = Date.UTC(2026, 0, 15, 12);
let n = 0;
let differ = 0;
for (const file of readdirSync('tests/corpus').sort()) {
  for (const src of JSON.parse(readFileSync(`tests/corpus/${file}`, 'utf8'))) {
    // A gantt chart marks the present, so the time is fixed.
    for (const options of [{ now }, { now, sourceInfo: true }, { now, maxWidth: 300 }]) {
      n++;
      if (out(before, src, options) === out(after, src, options)) continue;
      differ++;
      if (differ <= 5) console.error(`differs: ${file} ${JSON.stringify(options)}: ${JSON.stringify(src.slice(0, 80))}`);
    }
  }
}
console.log(`${n} renders, ${differ} differ`);
process.exit(differ ? 1 : 0);
