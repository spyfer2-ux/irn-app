// Testes da Bíblia: referências, busca sem acentos, textos para compartilhar e os arquivos gerados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  BOOKS,
  findBook,
  findRanges,
  fold,
  formatRef,
  matcher,
  parseReference,
  plain,
  segments,
  shareText,
} from '../src/lib/bible';

const ref = (s: string) => {
  const r = parseReference(s);
  return r && `${r.book.pt} ${r.chapter}${r.verse ? `:${r.verse}` : ''}${r.verseEnd ? `-${r.verseEnd}` : ''}`;
};

test('livros: 66, 39 no Antigo e 27 no Novo Testamento, endereços únicos', () => {
  assert.equal(BOOKS.length, 66);
  assert.equal(BOOKS.filter((b) => !b.nt).length, 39);
  assert.equal(new Set(BOOKS.map((b) => b.slug)).size, 66);
  assert.equal(findBook('joao')?.slug, 'joao');
  assert.equal(findBook('1-corintios')?.pt, '1 Coríntios');
  assert.equal(findBook('43')?.pt, 'João');
});

test('referências em português e inglês', () => {
  assert.equal(ref('jo 3:16'), 'João 3:16');
  assert.equal(ref('john 3:16'), 'João 3:16');
  assert.equal(ref('Jo 3.16'), 'João 3:16');
  assert.equal(ref('joão 3,16-18'), 'João 3:16-18');
  assert.equal(ref('jó 1:1'), 'Jó 1:1');
  assert.equal(ref('job 1'), 'Jó 1');
  assert.equal(ref('sl 23'), 'Salmos 23');
  assert.equal(ref('Psalm 23:1'), 'Salmos 23:1');
  assert.equal(ref('1 co 13:4-7'), '1 Coríntios 13:4-7');
  assert.equal(ref('1co13'), '1 Coríntios 13');
  assert.equal(ref('II Reis 2'), '2 Reis 2');
  assert.equal(ref('1 john 4:8'), '1 João 4:8');
  assert.equal(ref('gn 1:1'), 'Gênesis 1:1');
  assert.equal(ref('genesis'), 'Gênesis 1');
  assert.equal(ref('Apocalipse 22:21'), 'Apocalipse 22:21');
  assert.equal(ref('rev 22'), 'Apocalipse 22');
  assert.equal(ref('jn 2'), 'Jonas 2');
  assert.equal(ref('mt 5:3'), 'Mateus 5:3');
  assert.equal(ref('efe 2:8'), 'Efésios 2:8');
  // não são referências
  assert.equal(ref('amor'), null);
  assert.equal(ref('Deus amou o mundo'), null);
  assert.equal(ref('jo 22:1'), null); // João tem 21 capítulos
});

test('busca ignora acentos, maiúsculas e pontuação', () => {
  assert.equal(fold('ÁÉÍÓÚ Çç Ãõ'), 'aeiou cc ao');
  const text = 'Porque Deus amou ao mundo de tal maneira, que deu o seu Filho unigênito;';
  const re = matcher('deus AMOU')!;
  assert.deepEqual(findRanges(text, re), [[7, 16]]);
  assert.equal(text.slice(7, 16), 'Deus amou');
  const u = text.indexOf('unigênito');
  assert.deepEqual(findRanges(text, matcher('UNIGENITO')!), [[u, u + 9]]);
  assert.equal(findRanges(text, matcher('maneira que')!).length, 1);
  assert.equal(findRanges(text, matcher('nada disso')!).length, 0);
  assert.equal(matcher('  ...  '), null);
  // começo de palavra: "amou" não acha "chamou"
  assert.equal(findRanges('E chamou Deus à luz Dia', matcher('amou')!).length, 0);
  assert.equal(findRanges('Deus amou ao mundo', matcher('amou')!).length, 1);
});

test('KJV: [colchetes] em itálico e fora do texto copiado', () => {
  const t = 'And the earth was without form, and void; and darkness [was] upon the face of the deep.';
  assert.deepEqual(
    segments(t, 'kjv').map((s) => (s.it ? `<${s.t}>` : s.t)).join(''),
    'And the earth was without form, and void; and darkness <was> upon the face of the deep.',
  );
  assert.equal(plain(t, 'kjv').includes('['), false);
  assert.equal(segments(t, 'livre').length, 1);
});

test('referência e texto para compartilhar', () => {
  const jo = findBook('jo')!;
  assert.equal(formatRef(jo, 3, [16], 'livre'), 'João 3:16');
  assert.equal(formatRef(jo, 3, [17, 16, 18, 20], 'livre'), 'João 3:16-18,20');
  assert.equal(formatRef(jo, 3, [16], 'kjv'), 'John 3:16');
  assert.equal(shareText(jo, 3, [{ n: 16, text: 'Texto.' }], 'livre'), '“Texto.”\n— João 3:16 (BLIVRE)');
  assert.equal(shareText(jo, 3, [{ n: 17, text: 'B' }, { n: 16, text: 'A [x]' }], 'kjv'), '“16 A x 17 B”\n— John 3:16-17 (KJV)');
});

test('arquivos gerados: 66 livros por versão, capítulos certos, sem ¶', () => {
  for (const v of ['livre', 'kjv']) {
    const dir = `public/biblia/${v}`;
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.json')).length, 66);
    let verses = 0;
    for (const b of BOOKS) {
      const raw = readFileSync(`${dir}/${b.n}.json`, 'utf8');
      const d = JSON.parse(raw) as { versao: string; livro: number; capitulos: string[][] };
      assert.equal(d.versao, v);
      assert.equal(d.livro, b.n);
      assert.equal(d.capitulos.length, b.chapters, `${v} ${b.pt}`);
      assert.equal(raw.includes('¶'), false);
      verses += d.capitulos.reduce((s, c) => s + c.length, 0);
    }
    assert.equal(verses, 31102);
  }
  const jo = JSON.parse(readFileSync('public/biblia/livre/43.json', 'utf8')) as { capitulos: string[][] };
  assert.match(jo.capitulos[2][15], /^Porque Deus amou ao mundo/);
  const gn = JSON.parse(readFileSync('public/biblia/kjv/1.json', 'utf8')) as { capitulos: string[][] };
  assert.equal(gn.capitulos[0][0], 'In the beginning God created the heaven and the earth.');
});
