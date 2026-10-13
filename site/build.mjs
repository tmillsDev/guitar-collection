// Builds docs/ (served by GitHub Pages) from guitars/: web-sized photos, compressed
// samples, and index.html with the guitar data (parsed from each guitar's .md) and the
// Supabase connection from site/supabase.json inlined.
// Usage: node site/build.mjs   (media already in docs/ is reused)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SITE, '..');
const GUITARS = join(ROOT, 'guitars');
const DIST = join(ROOT, 'docs');

const POSITIONS = ['neck', 'middle', 'bridge'];
const TONES = ['clean', 'dirt'];

// Minimal reader for our front matter: `key: value  # comment`, one nesting level.
function parseFrontMatter(text) {
  const head = text.split(/^---\s*$/m)[1] ?? '';
  const out = {};
  let section = null;
  for (const raw of head.split('\n')) {
    const m = raw.match(/^(\s*)([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, indent, key, rest] = m;
    const value = rest.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (indent.length === 0) {
      if (value === '' && (key === 'pickups' || key === 'sample_positions')) {
        section = out[key] = {};
      } else {
        section = null;
        out[key] = value;
      }
    } else if (section) {
      section[key] = value;
    }
  }
  return out;
}

// Every recording measures louder than this (quietest is about -13.6), so matching only ever
// turns samples down, with headroom left for the AAC encode.
const TARGET_LUFS = -15;
function measureLufs(file) {
  // ffmpeg writes the ebur128 summary to stderr.
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const lufs = Number(stderr.split('Summary:')[1]?.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  if (!Number.isFinite(lufs)) throw new Error(`Could not measure loudness of ${file}`);
  return lufs;
}

const newer = (src, dst) => !existsSync(dst) || statSync(src).mtimeMs > statSync(dst).mtimeMs;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });

const guitars = [];
for (const id of readdirSync(GUITARS).sort()) {
  const dir = join(GUITARS, id);
  const md = join(dir, `${id}.md`);
  if (!existsSync(md)) continue;
  const fm = parseFrontMatter(readFileSync(md, 'utf8'));
  const out = join(DIST, 'media', id);
  mkdirSync(out, { recursive: true });

  // Photos: full shot (tall strip) and body shot, plus a small body thumbnail.
  const photos = [
    ['full', `${id}-full.jpeg`, 900],
    ['body', `${id}-body.jpeg`, 1600],
    ['thumb', `${id}-body.jpeg`, 640],
  ];
  for (const [name, file, width] of photos) {
    const src = join(dir, file);
    const dst = join(out, `${name}.jpg`);
    if (newer(src, dst)) {
      run('magick', [src, '-auto-orient', '-resize', `${width}x>`, '-strip', '-quality', '82', '-interlace', 'Plane', dst]);
    }
  }

  // Samples: the recordings are effectively mono, so mono AAC keeps them small. aac_at is macOS's
  // AudioToolbox encoder; ffmpeg's built-in aac overshoots clean transients by up to 3 dB.
  const samples = {};
  for (const tone of TONES) {
    for (const pos of POSITIONS) {
      const key = `${tone}-${pos}`;
      const src = join(dir, 'sound', `${key}.wav`);
      if (!existsSync(src)) continue;
      const dst = join(out, `${key}.mp4`);
      if (newer(src, dst)) {
        // Loudness-match: a plain gain change to TARGET_LUFS so the blind test isn't won by volume.
        const gain = TARGET_LUFS - measureLufs(src);
        run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-af', `volume=${gain.toFixed(2)}dB`,
          '-c:a', 'aac_at', '-b:a', '112k', '-movflags', '+faststart', dst]);
      }
      samples[key] = `media/${id}/${key}.mp4`;
    }
  }

  guitars.push({
    id,
    nickname: fm.nickname || '',
    make: fm.make || '',
    model: fm.model || id,
    series: fm.series || '',
    year: fm.year || '',
    country: fm.country || '',
    color: fm.color || '',
    finish: fm.finish_type || '',
    pickups: fm.pickups || {},
    positions: fm.sample_positions || {},
    samples,
  });
  console.log(`✓ ${id}`);
}

const template = readFileSync(join(SITE, 'src', 'index.html'), 'utf8');
const json = JSON.stringify(guitars).replace(/</g, '\\u003c');
// The project URL and anon key are public by design; row-level security guards the table.
const configPath = join(SITE, 'supabase.json');
const supabase = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
if (!supabase) console.warn('No site/supabase.json: votes will not be saved.');
writeFileSync(join(DIST, 'index.html'), template
  .replace('/*GUITAR_DATA*/[]', json)
  .replace('/*SUPABASE_CONFIG*/null', JSON.stringify(supabase)));
// Serve files as-is (no Jekyll processing).
writeFileSync(join(DIST, '.nojekyll'), '');
console.log(`Built ${guitars.length} guitars → ${DIST}`);
