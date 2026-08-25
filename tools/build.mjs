#!/usr/bin/env node
/*
  NBC Events - bouwscript voor de 3D kolom previews
  ------------------------------------------------------------------
  Draait in GitHub Actions (of lokaal, als je Node + ffmpeg hebt).

    node tools/build.mjs scan
        Verwerkt alle losse videobestanden in docs/p/, comprimeert ze
        naar het budget uit config.json en zet er een preview-pagina bij.

    node tools/build.mjs add --video <pad-of-url> [--name "Klant - datum"]
        Zelfde, maar voor één video die van buiten de repo komt.

  Beide modes bouwen daarna de overzichtspagina docs/index.html opnieuw.
*/
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS      = path.join(ROOT, 'docs');
const PREVIEWS  = path.join(DOCS, 'p');
const CONFIG    = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const TPL_PAGE  = fs.readFileSync(path.join(ROOT, 'tools', 'template-preview.html'), 'utf8');
const TPL_INDEX = fs.readFileSync(path.join(ROOT, 'tools', 'template-index.html'), 'utf8');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const MB        = 1024 * 1024;

const warnings = [];
const errors   = [];

// ---------- kleine helpers ------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * MB, ...opts });
  if (r.error) throw new Error(`${cmd} kon niet worden gestart: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} faalde (exit ${r.status})\n${(r.stderr || '').trim()}`);
  return r.stdout;
}

function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugify(s) {
  let x = s.toLowerCase();
  // accenten weghalen zodat "Café" en "Cafe" dezelfde map worden
  x = x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  x = x.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!x) x = 'kolom';
  if (x.length > 40) x = x.slice(0, 40).replace(/-+$/, '');
  return x;
}

// "Deloitte_25 aug - trim.mp4" -> "Deloitte 25 aug"
function displayNameFromFile(file) {
  let n = path.basename(file, path.extname(file));
  n = n.replace(/\s*-?\s*trim\s*$/i, '');
  n = n.replace(/_+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return n;
}

function probe(file) {
  const out = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', file,
  ]);
  const meta = JSON.parse(out);
  const st   = (meta.streams && meta.streams[0]) || {};
  const w    = Number(st.width)  || 0;
  const h    = Number(st.height) || 0;
  const dur  = Number(meta.format && meta.format.duration) || 0;
  if (!w || !h || !dur) throw new Error('Kon breedte, hoogte of duur niet uitlezen');
  return { width: w, height: h, duration: dur };
}

// smallere kolom bij lange video's, zodat het bitrate-budget blijft kloppen
function maxWidthFor(duration) {
  if (duration <= 30)  return 1044;
  if (duration <= 90)  return 928;
  if (duration <= 240) return 696;
  return 560;
}

// ---------- comprimeren ---------------------------------------------

function encode(src, dest, info) {
  const budgetBytes = CONFIG.videoBudgetMB * MB;
  const cap    = Number(CONFIG.maxDurationSec) || 0;
  const durEff = cap > 0 && info.duration > cap ? cap : info.duration;
  const maxW   = maxWidthFor(durEff);
  const kbps   = Math.floor((0.97 * budgetBytes * 8) / durEff / 1000);

  const logBase = path.join(os.tmpdir(), 'kolom_' + crypto.randomBytes(8).toString('hex'));
  const trim    = cap > 0 ? ['-t', String(cap)] : [];
  const common  = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', src, ...trim,
    '-an',
    '-c:v', 'libx264',
    '-preset', String(CONFIG.preset || 'medium'),
    '-b:v', `${kbps}k`,
    '-passlogfile', logBase,
    '-vf', `scale=min(iw\\,${maxW}):-2`,
    '-r', String(CONFIG.fps || 24),
  ];

  try {
    run('ffmpeg', [...common, '-pass', '1', '-f', 'null', '/dev/null']);
    run('ffmpeg', [...common, '-pass', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest]);
  } finally {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith(path.basename(logBase))) {
        try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
      }
    }
  }
}

// ---------- één video tot preview verwerken --------------------------

function makePreview(srcFile, displayName) {
  const name = displayName || displayNameFromFile(srcFile);
  const slug = slugify(name);
  const dir  = path.join(PREVIEWS, slug);

  const info = probe(srcFile);
  const faceAspect = info.height / (info.width / 4);

  if (!CONFIG.forceAll && faceAspect < CONFIG.minFaceAspect) {
    throw new Error(
      `"${path.basename(srcFile)}" ziet er niet uit als een 4-zijden ledkolom ` +
      `(zijde-verhouding ${faceAspect.toFixed(2)}, verwacht minstens ${CONFIG.minFaceAspect}). ` +
      `Staan de vier zijden wel naast elkaar? Zet anders "forceAll": true in config.json.`
    );
  }

  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'kolom.mp4');

  const srcMB = fs.statSync(srcFile).size / MB;
  if (srcMB > CONFIG.videoBudgetMB) {
    console.log(`  comprimeren (${srcMB.toFixed(1)} MB -> doel ${CONFIG.videoBudgetMB} MB)...`);
    encode(srcFile, dest, info);
  } else {
    console.log(`  al klein genoeg (${srcMB.toFixed(1)} MB), overnemen zonder hercoderen`);
    fs.copyFileSync(srcFile, dest);
  }

  const finalInfo = probe(dest);
  const meta = {
    slug,
    name,
    updated: new Date().toISOString(),
    video: {
      bytes:    fs.statSync(dest).size,
      width:    finalInfo.width,
      height:   finalInfo.height,
      duration: Math.round(finalInfo.duration * 10) / 10,
    },
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const showName = CONFIG.showName !== false && name.length > 0;
  const page = TPL_PAGE
    .replaceAll('__PAGE_TITLE__',    htmlEscape(showName ? `${name} · NBC 3D Kolom` : 'NBC Events · 3D Kolom Preview'))
    .replaceAll('__OG_TITLE__',      htmlEscape(showName ? name : 'NBC Events · 3D Kolom Preview'))
    .replaceAll('__NAME_DISPLAY__',  showName ? 'block' : 'none')
    .replaceAll('__PROJECT_NAME__',  showName ? htmlEscape(name) : '');
  fs.writeFileSync(path.join(dir, 'index.html'), page);

  console.log(`  klaar -> docs/p/${slug}/  (${(meta.video.bytes / MB).toFixed(1)} MB)`);
  return meta;
}

// ---------- overzichtspagina ----------------------------------------

function readAllMeta() {
  if (!fs.existsSync(PREVIEWS)) return [];
  const out = [];
  for (const entry of fs.readdirSync(PREVIEWS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(PREVIEWS, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try { out.push(JSON.parse(fs.readFileSync(metaPath, 'utf8'))); } catch {}
  }
  out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return out;
}

function buildIndex() {
  const items = readAllMeta();
  let cards;

  if (items.length === 0) {
    cards =
      '<div class="empty">Er staan nog geen previews klaar.<br><br>' +
      'Zet een ledkolom-video in de map <code>docs/p/</code> van deze repository; ' +
      'de preview en de deelbare link worden er automatisch bij gemaakt.</div>';
  } else {
    cards = '<div class="grid">\n' + items.map((m) => {
      const mb   = (m.video.bytes / MB).toFixed(1);
      const secs = Math.round(m.video.duration);
      const date = new Date(m.updated).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
      return `    <a class="card" href="p/${encodeURIComponent(m.slug)}/">\n` +
             `      <div class="name">${htmlEscape(m.name)}</div>\n` +
             `      <div class="meta">${date} · ${secs} sec · ${mb} MB</div>\n` +
             `    </a>`;
    }).join('\n') + '\n  </div>';
  }

  const subtitle = items.length === 1
    ? '1 preview beschikbaar'
    : `${items.length} previews beschikbaar`;

  fs.writeFileSync(
    path.join(DOCS, 'index.html'),
    TPL_INDEX.replaceAll('__CARDS__', cards).replaceAll('__SUBTITLE__', htmlEscape(subtitle))
  );
  console.log(`overzicht bijgewerkt: ${items.length} preview(s)`);
}

// ---------- losse videobestanden oppikken ----------------------------

function collectLooseVideos() {
  if (!fs.existsSync(PREVIEWS)) return [];
  const found = [];

  // losse bestanden direct in docs/p/
  for (const entry of fs.readdirSync(PREVIEWS, { withFileTypes: true })) {
    if (entry.isFile() && VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) {
      found.push({ file: path.join(PREVIEWS, entry.name), name: null });
    }
  }

  // een video die iemand rechtstreeks in een preview-map heeft gezet
  for (const entry of fs.readdirSync(PREVIEWS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PREVIEWS, entry.name);
    for (const f of fs.readdirSync(dir)) {
      const ext = path.extname(f).toLowerCase();
      if (!VIDEO_EXT.has(ext) || f === 'kolom.mp4') continue;
      const metaPath = path.join(dir, 'meta.json');
      let name = displayNameFromFile(f);
      if (fs.existsSync(metaPath)) {
        try { name = JSON.parse(fs.readFileSync(metaPath, 'utf8')).name || name; } catch {}
      }
      found.push({ file: path.join(dir, f), name });
    }
  }
  return found;
}

// ---------- download voor de "add"-mode ------------------------------

function download(url) {
  const dest = path.join(os.tmpdir(), 'bron_' + crypto.randomBytes(8).toString('hex') + path.extname(new URL(url).pathname));
  const token = process.env.GITHUB_TOKEN || '';
  const args = ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest];

  // release-assets van een private repo hebben de API + een token nodig
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
  if (m && token) {
    const [, owner, repo, tag, file] = m;
    const relJson = run('curl', [
      '-fsSL', '-H', `Authorization: Bearer ${token}`,
      '-H', 'Accept: application/vnd.github+json',
      `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    ]);
    const asset = JSON.parse(relJson).assets.find((a) => a.name === decodeURIComponent(file));
    if (!asset) throw new Error(`Release "${tag}" bevat geen bestand "${decodeURIComponent(file)}"`);
    run('curl', [...args, '-H', `Authorization: Bearer ${token}`, '-H', 'Accept: application/octet-stream', asset.url]);
    return dest;
  }

  if (token && url.startsWith('https://')) {
    const host = new URL(url).host;
    if (host === 'github.com' || host === 'api.github.com' || host.endsWith('.githubusercontent.com')) {
      args.push('-H', `Authorization: Bearer ${token}`);
    }
  }
  run('curl', [...args, url]);
  return dest;
}

// ---------- hoofdprogramma -------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] || 'scan';
  fs.mkdirSync(PREVIEWS, { recursive: true });

  const jobs = [];

  if (mode === 'add') {
    if (!args.video) throw new Error('Gebruik: node tools/build.mjs add --video <pad-of-url> [--name "Naam"]');
    const isUrl = /^https?:\/\//i.test(args.video);
    const file  = isUrl ? download(args.video) : path.resolve(args.video);
    if (!fs.existsSync(file)) throw new Error(`Bestand niet gevonden: ${args.video}`);
    const name = args.name || displayNameFromFile(isUrl ? new URL(args.video).pathname : file);
    jobs.push({ file, name, cleanup: isUrl });
  } else if (mode === 'scan') {
    for (const v of collectLooseVideos()) jobs.push({ ...v, cleanup: true });
  } else {
    throw new Error(`Onbekende mode "${mode}". Gebruik "scan" of "add".`);
  }

  if (jobs.length === 0) console.log('Geen nieuwe video\'s gevonden.');

  for (const job of jobs) {
    console.log(`\n> ${path.basename(job.file)}`);
    try {
      makePreview(job.file, job.name);
      if (job.cleanup) fs.rmSync(job.file, { force: true });   // bronbestand niet bewaren
    } catch (e) {
      errors.push(`${path.basename(job.file)}: ${e.message}`);
      console.error(`  FOUT: ${e.message}`);
    }
  }

  buildIndex();

  if (warnings.length) {
    console.log('\nWaarschuwingen:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (errors.length) {
    console.error('\nNiet verwerkt:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
  }
}

main();
