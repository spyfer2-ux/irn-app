// Gera os arquivos da Bíblia usados pela tela /biblia: public/biblia/<versão>/<n>.json (um por livro, 1 a 66).
//
// Fontes (eBible.org, formato "VPL" — um versículo por linha):
//   livre → Bíblia Livre 2018 (BLIVRE), CC BY 4.0      https://ebible.org/Scriptures/porbr2018_vpl.zip
//   kjv   → King James Version 1769, domínio público   https://ebible.org/Scriptures/eng-kjv_vpl.zip
//
// Uso:  node scripts/make-bible.mjs                (baixa os dois arquivos do eBible.org)
//       node scripts/make-bible.mjs pasta/com/zips  (usa porbr2018_vpl.zip e eng-kjv_vpl.zip já baixados)
//
// Formato de cada arquivo: { "versao": "livre", "livro": 43, "capitulos": [["v1", "v2", ...], ...] }
// Na KJV ficam só os 66 livros (sem os apócrifos), o sinal de parágrafo ¶ é retirado e as palavras
// acrescentadas pelos tradutores continuam entre [colchetes] — o app mostra esses trechos em itálico.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'biblia');

const VERSIONS = [
  { id: 'livre', zip: 'porbr2018_vpl.zip', url: 'https://ebible.org/Scriptures/porbr2018_vpl.zip' },
  { id: 'kjv', zip: 'eng-kjv_vpl.zip', url: 'https://ebible.org/Scriptures/eng-kjv_vpl.zip' },
];

// Os 66 livros na ordem do app, com os códigos usados pelo eBible.org nos arquivos VPL.
const BOOKS = (
  'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SOL ISA JER LAM EZE DAN HOS JOE AMO ' +
  'OBA JON MIC NAH HAB ZEP HAG ZEC MAL MAT MAR LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL 1TH 2TH 1TI 2TI TIT PHM HEB JAM ' +
  '1PE 2PE 1JO 2JO 3JO JUD REV'
).split(' ');

/** Lê um arquivo de dentro de um .zip (sem bibliotecas externas). */
function unzipEntry(buf, test) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('arquivo .zip inválido');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('arquivo .zip inválido');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (test(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`compressão ${method} não suportada`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('texto VPL não encontrado no .zip');
}

async function getZip(v, dir) {
  if (dir) return readFile(join(dir, v.zip));
  console.log(`baixando ${v.url}`);
  const res = await fetch(v.url);
  if (!res.ok) throw new Error(`${v.url}: erro ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function clean(id, text) {
  let t = text;
  if (id === 'kjv') t = t.replace(/¶/g, '');
  return t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

async function build(v, dir) {
  const txt = unzipEntry(await getZip(v, dir), (n) => n.endsWith('_vpl.txt')).toString('utf8');
  /** @type {Map<string, string[][]>} */
  const books = new Map();
  for (const line of txt.split(/\r?\n/)) {
    const m = /^(\w{3}) (\d+):(\d+) (.*)$/.exec(line);
    if (!m) continue;
    const [, code, c, vs, text] = m;
    if (!BOOKS.includes(code)) continue; // KJV: fora os apócrifos
    const chapters = books.get(code) ?? [];
    books.set(code, chapters);
    const ci = Number(c) - 1;
    const vi = Number(vs) - 1;
    chapters[ci] ??= [];
    if (chapters[ci].length !== vi) throw new Error(`${v.id} ${code} ${c}:${vs} fora de ordem`);
    chapters[ci].push(clean(v.id, text));
  }
  await rm(join(OUT, v.id), { recursive: true, force: true });
  await mkdir(join(OUT, v.id), { recursive: true });
  let verses = 0;
  for (const [i, code] of BOOKS.entries()) {
    const chapters = books.get(code);
    if (!chapters || chapters.some((ch) => !ch?.length)) throw new Error(`${v.id}: livro ${code} incompleto`);
    verses += chapters.reduce((s, ch) => s + ch.length, 0);
    const json = JSON.stringify({ versao: v.id, livro: i + 1, capitulos: chapters });
    await writeFile(join(OUT, v.id, `${i + 1}.json`), json);
  }
  console.log(`${v.id}: 66 livros, ${verses} versículos → public/biblia/${v.id}/`);
}

const dir = process.argv[2];
for (const v of VERSIONS) await build(v, dir);
