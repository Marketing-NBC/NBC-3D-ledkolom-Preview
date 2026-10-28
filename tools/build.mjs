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

    node tools/build.mjs moment --preview <link-of-naam> [--sec 12]
        Kiest zelf het moment uit de video voor de foto op locatie.
        Zonder --sec kiest het script weer zelf.

  Alle modes zetten daarna bij elke preview de pagina opnieuw neer en maken
  waar nodig de foto van de kolom in de NBC-foyer (zie tools/foto.mjs), en
  bouwen de overzichtspagina docs/index.html opnieuw.
*/
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { maakFoto, FOTO_VERSIE } from './foto.mjs';

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS      = path.join(ROOT, 'docs');
const PREVIEWS  = path.join(DOCS, 'p');
const CONFIG    = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const TPL_PAGE  = fs.readFileSync(path.join(ROOT, 'tools', 'template-preview.html'), 'utf8');
const TPL_INDEX = fs.readFileSync(path.join(ROOT, 'tools', 'template-index.html'), 'utf8');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const MB        = 1024 * 1024;

const errors = [];

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

// Achter de leesbare naam komt een willekeurig staartje, zodat iemand die één
// link heeft de andere niet kan raden. Bestaat er al een map voor deze naam,
// dan houden we dat staartje aan: een nieuwe versie van dezelfde video hoort
// op dezelfde link te blijven staan.
const TOKEN = /-[0-9a-f]{8}$/;

function slugVoor(name) {
  const basis = slugify(name);
  if (fs.existsSync(PREVIEWS)) {
    for (const entry of fs.readdirSync(PREVIEWS, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(basis + '-') && TOKEN.test(entry.name.slice(basis.length))) {
        return entry.name;
      }
    }
  }
  return `${basis}-${crypto.randomBytes(4).toString('hex')}`;
}

// "Deloitte_25 aug - trim.mp4" -> "Deloitte 25 aug"
// "Brookz.-.27.aug.mp4"          -> "Brookz - 27 aug"
//
// GitHub vervangt spaties door punten in de naam van een release-bijlage.
// Staat er nergens een spatie maar wel een punt, dan zijn die punten dus de
// spaties van de oorspronkelijke bestandsnaam. Zit er wel een spatie in, dan
// laten we punten met rust: die horen er dan bij.
function displayNameFromFile(file) {
  let n = path.basename(file, path.extname(file));
  if (!n.includes(' ') && n.includes('.')) n = n.replace(/\.+/g, ' ');
  n = n.replace(/_+/g, ' ');
  n = n.replace(/\s*-?\s*trim\s*$/i, '');
  n = n.replace(/\s{2,}/g, ' ').trim();
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
  const slug = slugVoor(name);
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

  // een zelf gekozen moment voor de foto blijft staan bij een nieuwe versie
  let fotoMoment;
  try { fotoMoment = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).fotoMoment; } catch {}

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
  if (fotoMoment !== undefined) meta.fotoMoment = fotoMoment;
  fotoBijwerken(dir, meta);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  schrijfPagina(dir, meta);

  console.log(`  klaar -> docs/p/${slug}/  (${(meta.video.bytes / MB).toFixed(1)} MB)`);
  return meta;
}

function schrijfPagina(dir, meta) {
  const name = meta.name || '';
  const showName = CONFIG.showName !== false && name.length > 0;
  const page = TPL_PAGE
    .replaceAll('__PAGE_TITLE__',    htmlEscape(showName ? `${name} · NBC 3D Kolom` : 'NBC Events · 3D Kolom Preview'))
    .replaceAll('__OG_TITLE__',      htmlEscape(showName ? name : 'NBC Events · 3D Kolom Preview'))
    .replaceAll('__NAME_DISPLAY__',  showName ? 'block' : 'none')
    .replaceAll('__PROJECT_NAME__',  showName ? htmlEscape(name) : '');
  fs.writeFileSync(path.join(dir, 'index.html'), page);
}

// De foto van de kolom in de foyer. Lukt die niet, dan gaat de preview gewoon
// door: de pagina laat de schuif dan weg en toont alleen de 3D-kolom.
function fotoBijwerken(dir, meta) {
  const doel = path.join(dir, 'foto.jpg');
  // "fotoMoment" in meta.json: de seconde die iemand zelf heeft gekozen
  const zelf  = typeof meta.fotoMoment === 'number';
  const klopt = meta.foto && meta.foto.versie === FOTO_VERSIE && fs.existsSync(doel) &&
                Boolean(meta.foto.zelf) === zelf && (!zelf || meta.foto.gevraagd === meta.fotoMoment);
  if (klopt) return false;
  try {
    const moment = maakFoto(path.join(dir, 'kolom.mp4'), doel, zelf ? meta.fotoMoment : undefined);
    meta.foto = zelf
      ? { versie: FOTO_VERSIE, moment, zelf: true, gevraagd: meta.fotoMoment }
      : { versie: FOTO_VERSIE, moment };
    const hoe = zelf ? 'zelf gekozen' : 'automatisch gekozen';
    console.log(`  foto in de foyer gemaakt voor ${path.basename(dir)} (still op ${moment} sec, ${hoe})`);
  } catch (e) {
    console.error(`  LET OP: foto in de foyer mislukt voor ${path.basename(dir)}: ${e.message}`);
    fs.rmSync(doel, { force: true });
    delete meta.foto;
  }
  return true;
}

// Bestaande previews meenemen: een nieuwe versie van het sjabloon of van de
// foyer-foto komt zo ook bij links terecht die al verstuurd zijn.
function bestaandeBijwerken() {
  if (!fs.existsSync(PREVIEWS)) return;
  for (const entry of fs.readdirSync(PREVIEWS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PREVIEWS, entry.name);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath) || !fs.existsSync(path.join(dir, 'kolom.mp4'))) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }

    if (fotoBijwerken(dir, meta)) {
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    }
    schrijfPagina(dir, meta);
  }
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

// De publieke site krijgt bewust GEEN lijst van previews. Wie een link naar
// een kolom heeft en het pad afknipt, hoort niet de klanten van alle andere
// kolommen te zien. Het overzicht komt in LINKS.md te staan: dat leest mee met
// de repository en dus met wie daar toegang toe heeft.
function buildLanding() {
  fs.writeFileSync(
    path.join(DOCS, 'index.html'),
    TPL_INDEX.replaceAll('__JAAR__', String(new Date().getFullYear()))
  );

  // zoekmachines helemaal buiten de deur houden
  fs.writeFileSync(path.join(DOCS, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
}

function buildLinks(basisUrl) {
  const items = readAllMeta();
  const regels = [
    '# Links naar de previews',
    '',
    '<!-- Dit bestand wordt automatisch bijgewerkt. Niet met de hand aanpassen. -->',
    '',
    'Stuur een collega alleen de link van de kolom die hij nodig heeft. De',
    'previews staan niet op een overzichtspagina en de links zijn niet te raden,',
    'dus wie er één heeft komt niet bij de rest.',
    '',
  ];

  if (items.length === 0) {
    regels.push('Er staan nog geen previews klaar.');
  } else {
    regels.push('| Preview | Link | Duur | Grootte | Bijgewerkt |');
    regels.push('| --- | --- | --- | --- | --- |');
    for (const m of items) {
      const mb   = (m.video.bytes / MB).toFixed(1);
      const secs = Math.round(m.video.duration);
      const dag  = new Date(m.updated).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
      regels.push(`| ${m.name} | ${basisUrl}p/${m.slug}/ | ${secs} sec | ${mb} MB | ${dag} |`);
    }
  }

  regels.push('');
  fs.writeFileSync(path.join(ROOT, 'LINKS.md'), regels.join('\n'));
  console.log(`overzicht bijgewerkt: ${items.length} preview(s) in LINKS.md`);
}

// ---------- zelf het moment voor de foto kiezen ----------------------

// "12", "12.5", "12,5", "0:12" of "1:05" -> seconden; leeg -> undefined
function leesSeconden(tekst) {
  const t = String(tekst ?? '').trim().replace(',', '.');
  if (!t) return undefined;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`"${tekst}" is geen tijd. Gebruik seconden (12 of 12,5) of minuten:seconden (0:12).`);
  return Math.round(((Number(m[1]) || 0) * 60 + Number(m[2])) * 10) / 10;
}

// een preview terugvinden aan zijn link, mapnaam of naam op het startscherm
function vindPreview(zoek) {
  const z = String(zoek || '').trim();
  if (!z) throw new Error('Vul in om welke preview het gaat: de link, of de naam op het startscherm.');
  const mappen = fs.readdirSync(PREVIEWS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PREVIEWS, e.name, 'meta.json')))
    .map((e) => e.name);

  const uitLink = z.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  if (mappen.includes(uitLink)) return uitLink;

  const basis = slugify(z);
  const treffers = mappen.filter((m) => {
    if (m.slice(0, -9) === basis) return true;
    try { return slugify(JSON.parse(fs.readFileSync(path.join(PREVIEWS, m, 'meta.json'), 'utf8')).name || '') === basis; }
    catch { return false; }
  });
  if (treffers.length === 1) return treffers[0];
  if (treffers.length > 1) throw new Error(`"${z}" past op meer dan één preview: ${treffers.join(', ')}. Plak de link.`);
  throw new Error(`Geen preview gevonden voor "${z}". Plak de link uit LINKS.md.`);
}

function kiesMoment(zoek, sec) {
  const map = vindPreview(zoek);
  const metaPath = path.join(PREVIEWS, map, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const moment = leesSeconden(sec);
  if (moment === undefined) {
    delete meta.fotoMoment;
    console.log(`${meta.name}: het script kiest weer zelf het moment voor de foto.`);
  } else {
    const duur = meta.video && meta.video.duration;
    if (duur && moment > duur) throw new Error(`De video van "${meta.name}" duurt maar ${duur} sec; ${moment} sec bestaat niet.`);
    meta.fotoMoment = moment;
    console.log(`${meta.name}: foto op ${moment} sec.`);
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
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

// ---------- bronbestanden ophalen ------------------------------------

function api(pad) {
  const token = process.env.GITHUB_TOKEN || '';
  const url = pad.startsWith('http') ? pad : `https://api.github.com${pad}`;
  const args = ['-fsSL', '--retry', '3', '--retry-delay', '2', '-H', 'Accept: application/vnd.github+json'];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  return JSON.parse(run('curl', [...args, url]));
}

// een release-asset via de API: werkt ook als de repository private is
function downloadAsset(asset) {
  const token = process.env.GITHUB_TOKEN || '';
  const dest = path.join(os.tmpdir(), 'bron_' + crypto.randomBytes(8).toString('hex') + path.extname(asset.name));
  const args = ['-fsSL', '--retry', '3', '--retry-delay', '2', '-H', 'Accept: application/octet-stream'];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  console.log(`  ophalen uit release (${(asset.size / MB).toFixed(0)} MB)...`);
  run('curl', [...args, '-o', dest, asset.url]);
  return dest;
}

function download(url) {
  const dest = path.join(os.tmpdir(), 'bron_' + crypto.randomBytes(8).toString('hex') + path.extname(new URL(url).pathname));
  const token = process.env.GITHUB_TOKEN || '';
  const args = ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest];

  // een geplakte release-link omzetten naar de API, zodat een token werkt
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
  if (m) {
    const [, owner, repo, tag, file] = m;
    const rel = api(`/repos/${owner}/${repo}/releases/tags/${tag}`);
    const asset = (rel.assets || []).find((a) => a.name === decodeURIComponent(file));
    if (!asset) throw new Error(`Release "${tag}" bevat geen bestand "${decodeURIComponent(file)}"`);
    return downloadAsset(asset);
  }

  if (token) {
    const host = new URL(url).host;
    if (host === 'github.com' || host === 'api.github.com' || host.endsWith('.githubusercontent.com')) {
      args.push('-H', `Authorization: Bearer ${token}`);
    }
  }
  console.log('  downloaden...');
  run('curl', [...args, url]);
  return dest;
}

// alle videobestanden die aan een release hangen
function releaseJobs(tag) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY ontbreekt; deze mode hoort in GitHub Actions te draaien.');
  const rel = api(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  const videos = (rel.assets || []).filter((a) => VIDEO_EXT.has(path.extname(a.name).toLowerCase()));

  if (videos.length === 0) {
    const andere = (rel.assets || []).map((a) => a.name).join(', ') || 'geen';
    throw new Error(
      `Release "${tag}" bevat geen videobestand. Bijlagen gevonden: ${andere}. ` +
      `Sleep de mp4 bij "Attach binaries" en publiceer de release opnieuw.`
    );
  }
  return videos.map((a) => ({ asset: a, name: displayNameFromFile(a.name) }));
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

  let jobs = [];

  if (mode === 'release') {
    if (!args.tag) throw new Error('Gebruik: node tools/build.mjs release --tag <naam-van-de-release>');
    jobs = releaseJobs(args.tag);
    console.log(`Release "${args.tag}": ${jobs.length} video(s) gevonden.`);
  } else if (mode === 'add') {
    if (!args.video) throw new Error('Gebruik: node tools/build.mjs add --video <pad-of-url> [--name "Naam"]');
    const isUrl = /^https?:\/\//i.test(args.video);
    if (isUrl) {
      jobs = [{ url: args.video, name: args.name || displayNameFromFile(new URL(args.video).pathname) }];
    } else {
      const file = path.resolve(args.video);
      if (!fs.existsSync(file)) throw new Error(`Bestand niet gevonden: ${args.video}`);
      jobs = [{ file, name: args.name || displayNameFromFile(file) }];
    }
  } else if (mode === 'scan') {
    jobs = collectLooseVideos().map((v) => ({ ...v, opruimen: true }));
  } else if (mode === 'moment') {
    // de foto zelf wordt hieronder bij "bestaande previews bijwerken" gemaakt
    kiesMoment(args.preview, args.sec);
    jobs = collectLooseVideos().map((v) => ({ ...v, opruimen: true }));
  } else {
    throw new Error(`Onbekende mode "${mode}". Gebruik "release", "add", "scan" of "moment".`);
  }

  if (jobs.length === 0) console.log("Geen nieuwe video's gevonden.");

  for (const job of jobs) {
    console.log(`\n> ${job.name || path.basename(job.file || '')}`);
    let bestand = job.file;
    let tijdelijk = Boolean(job.opruimen);
    try {
      if (!bestand && job.asset) { bestand = downloadAsset(job.asset); tijdelijk = true; }
      if (!bestand && job.url)   { bestand = download(job.url);        tijdelijk = true; }
      makePreview(bestand, job.name);
    } catch (e) {
      errors.push(`${job.name || path.basename(bestand || '?')}: ${e.message}`);
      console.error(`  FOUT: ${e.message}`);
    } finally {
      // het bronbestand blijft nooit in de repository achter
      if (tijdelijk && bestand) fs.rmSync(bestand, { force: true });
    }
  }

  console.log('\nBestaande previews bijwerken...');
  bestaandeBijwerken();

  buildLanding();
  buildLinks(process.env.SITE_URL || 'https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/');

  if (errors.length) {
    console.error('\nNiet verwerkt:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
  }
}

main();
