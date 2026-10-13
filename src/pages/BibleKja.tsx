/** Atalho para ler o mesmo capítulo na King James Atualizada (KJA).
 *  O texto da KJA tem direitos autorais (Abba Press), por isso não fica dentro do app:
 *  o botão abre o capítulo no site Bíblia Online (bibliaonline.com.br). */
import { ExternalLink } from 'lucide-react';
import type { Book } from '../lib/bible';

/** Abreviações do site, na ordem dos 66 livros (1 = Gênesis … 66 = Apocalipse). */
const ABBR = [
  'gn', 'ex', 'lv', 'nm', 'dt', 'js', 'jz', 'rt', '1sm', '2sm', '1rs', '2rs', '1cr', '2cr', 'ed', 'ne', 'et', 'jó', 'sl', 'pv', 'ec', 'ct',
  'is', 'jr', 'lm', 'ez', 'dn', 'os', 'jl', 'am', 'ob', 'jn', 'mq', 'na', 'hc', 'sf', 'ag', 'zc', 'ml',
  'mt', 'mc', 'lc', 'jo', 'atos', 'rm', '1co', '2co', 'gl', 'ef', 'fp', 'cl', '1ts', '2ts', '1tm', '2tm', 'tt', 'fm', 'hb', 'tg',
  '1pe', '2pe', '1jo', '2jo', '3jo', 'jd', 'ap',
];

export function kjaUrl(book: Book, chapter: number, verse?: number): string {
  const abbr = ABBR[book.n - 1] ?? 'gn';
  return `https://www.bibliaonline.com.br/kja/${encodeURIComponent(abbr)}/${chapter}${verse ? `/${verse}` : ''}`;
}

/** Botão "Ler na King James Atualizada". Se houver versículos escolhidos, abre no primeiro deles. */
export function KjaLink({ book, chapter, verse }: { book: Book; chapter: number; verse?: number }) {
  return (
    <a className="btn btn-secondary kja-link" href={kjaUrl(book, chapter, verse)} target="_blank" rel="noopener noreferrer">
      <ExternalLink size={18} /> Ler na King James Atualizada (KJA)
    </a>
  );
}
