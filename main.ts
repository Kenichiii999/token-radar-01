// token-radar-01: the entrypoint for the comps-2 launch radar.
//
// Pipeline, in order:
//   1. locate the sealed snapshot (--input, a file or a directory; /input by default)
//   2. score it with lib/model.ts and refuse any board the gate would refuse
//   3. write board.json and data.js into the output directory
//      (--output, MAKEFUN_OUTPUT_DIR, or /output)
//   4. mirror this repo's dashboard/ and screenshots/ into the output
//   5. build dossier.json from the finished output with the vendored library
//
// Node 22 or newer, standard library only, nothing fetched from the network.
// Outside the grader's sandbox, run it the way the README shows:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The repository's own directory: dashboard/ and screenshots/ live beside this file. */
const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** The gate's dossier limits: the text cap, and the refuse-only caps for shots and the page. */
const dossierLimits = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

/** A screenshot name the dossier accepts: letters, digits and . _ -, 1 to 128 long. */
const shotNameOk = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The smallest number of screenshots a hand-in carries: board, detail, filtered. */
const minShots = 3;

/** Print a message to stderr and leave with the given status. */
function die(message: string, status: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(status);
}

/**
 * The value of a --name flag: `--name value` wins over `--name=value`,
 * and the fallback wins when neither form is given (or --name is last).
 */
function readFlag(name: string, fallback: string): string {
  const argv = process.argv;
  const spaced = argv.indexOf(`--${name}`);
  if (spaced >= 0 && spaced + 1 < argv.length) return argv[spaced + 1]!;
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Where the snapshot file lives: the flag itself when it names a .json file, else snapshot.json under it. */
function snapshotFile(inputFlag: string): string {
  return inputFlag.endsWith('.json') ? inputFlag : path.join(inputFlag, 'snapshot.json');
}

/**
 * Mirror one directory's top-level regular files into another, skipping names
 * that start with a dot. A missing source mirrors nothing and creates nothing.
 * Returns the names that were copied.
 */
function mirror(sourceDir: string, targetDir: string): string[] {
  if (!fs.existsSync(sourceDir)) return [];
  fs.mkdirSync(targetDir, { recursive: true });
  const copied: string[] = [];
  for (const name of fs.readdirSync(sourceDir)) {
    if (name.startsWith('.')) continue;
    const from = path.join(sourceDir, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(targetDir, name));
    copied.push(name);
  }
  return copied;
}

function main(): void {
  const input = snapshotFile(readFlag('input', '/input'));
  if (!fs.existsSync(input)) {
    die(
      `token-radar: cannot find the snapshot at ${input} — pass --input <snapshot.json|directory>, or mount the sealed /input`,
      2,
    );
  }
  const outDir = readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(fs.readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const refused = boardIssue(board, snapshot);
  if (refused !== null) die(`token-radar: refusing a board the gate would refuse: ${refused}`, 1);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  fs.writeFileSync(path.join(outDir, 'data.js'), dataScript(radar));

  const pageFiles = mirror(path.join(repoDir, 'dashboard'), path.join(outDir, 'dashboard'));
  const shots = mirror(path.join(repoDir, 'screenshots'), path.join(outDir, 'screenshots'));
  if (shots.length < minShots) {
    die(
      `token-radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'} — hand in ${minShots}: the board, a detail view and a filtered view`,
      1,
    );
  }
  for (const name of shots) {
    if (!shotNameOk.test(name)) die(`token-radar: screenshots/${name} is not a plain name of letters, digits and . _ -`, 1);
  }

  // Last, so the dossier is built from the finished output and matches it byte for byte.
  fs.writeFileSync(path.join(outDir, 'dossier.json'), buildDossier(outDir, dossierLimits));

  process.stdout.write(
    `token-radar: scored ${snapshot.protocols.length} protocols (${snapshot.watchlist.length} watchlist) into ${board.length} rows ` +
      `(${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token-radar: wrote ${path.join(outDir, 'board.json')}, ${path.join(outDir, 'data.js')}, ` +
      `${path.join(outDir, 'dashboard')} (${pageFiles.length} files), ${path.join(outDir, 'screenshots')} (${shots.length} images), ` +
      `and ${path.join(outDir, 'dossier.json')}\n`,
  );
}

main();
