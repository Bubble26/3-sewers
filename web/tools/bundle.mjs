#!/usr/bin/env node
/**
 * Builds dist/stickball.html — one self-contained page (three.js + all modules + CSS inlined).
 * That file is what gets published as an Artifact, so it must have zero external requests.
 */
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = await esbuild.build({
  entryPoints: [ROOT + 'src/main.js'],
  bundle: true, format: 'esm', write: false, minify: true, legalComments: 'none',
  target: ['chrome110', 'safari16', 'firefox110'],
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' },
  alias: { three: ROOT + 'node_modules/three/build/three.module.js' },
});
const js = out.outputFiles[0].text;
const css = await readFile(ROOT + 'styles.css', 'utf8');
const html = await readFile(ROOT + 'index.html', 'utf8');

const body = html
  .replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace(/<script type="module" src="[^"]*"><\/script>/, `<script type="module">\n${js}\n</script>`);

await mkdir(ROOT + 'dist', { recursive: true });
await writeFile(ROOT + 'dist/stickball.html', body);
const kb = Math.round(Buffer.byteLength(body) / 1024);
console.log(`dist/stickball.html  ${kb} KB`);

// The artifact build: the same page without its outer document tags, because the artifact
// host supplies its own <!doctype>/<head>/<body> skeleton and a nested document breaks it.
{
  const full = await readFile(ROOT + 'dist/stickball.html', 'utf8');
  const pick = (re) => (full.match(re) || [, ''])[1];
  const headHtml = pick(/<head>([\s\S]*?)<\/head>/);
  const bodyHtml = pick(/<body>([\s\S]*?)<\/body>/);
  const title = (headHtml.match(/<title>([\s\S]*?)<\/title>/) || [, 'Three Sewers'])[1];
  const styleCss = (headHtml.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const art = [
    `<title>${title}</title>`,
    `<style>${styleCss}\nhtml,body{margin:0;padding:0;height:100%;overflow:hidden;background:#12100e}\n</style>`,
    bodyHtml.trim(),
  ].join('\n');
  await writeFile(ROOT + 'dist/artifact.html', art);
  console.log(`dist/artifact.html    ${Math.round(Buffer.byteLength(art) / 1024)} KB`);
}
