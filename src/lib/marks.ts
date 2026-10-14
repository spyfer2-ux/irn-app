/**
 * Versículos marcados e anotações — ficam guardados só neste aparelho (não vão para o servidor).
 * Chave: "livro:capítulo:versículo" (vale para todas as versões, porque a numeração é a mesma).
 */
import { useEffect, useState } from 'react';

export type MarkColor = 'amarelo' | 'verde' | 'azul' | 'rosa' | 'laranja';

export const MARK_COLORS: { id: MarkColor; label: string; css: string }[] = [
  { id: 'amarelo', label: 'Amarelo', css: '#ffe27a' },
  { id: 'verde', label: 'Verde', css: '#a8e6b0' },
  { id: 'azul', label: 'Azul', css: '#a9d4ff' },
  { id: 'rosa', label: 'Rosa', css: '#ffb8d2' },
  { id: 'laranja', label: 'Laranja', css: '#ffc58f' },
];

export interface Mark {
  c?: MarkColor;
  note?: string;
  t: number;
}

export interface MarkEntry extends Mark {
  book: number;
  chapter: number;
  verse: number;
}

const LS = 'irn-marcas-v1';
const EVENT = 'irn-marcas';
let cache: Record<string, Mark> | null = null;

export const markKey = (book: number, chapter: number, verse: number) => `${book}:${chapter}:${verse}`;

function load(): Record<string, Mark> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(LS);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Mark>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(all: Record<string, Mark>) {
  cache = all;
  try {
    localStorage.setItem(LS, JSON.stringify(all));
  } catch {
    /* sem armazenamento local: fica só enquanto o app estiver aberto */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function getMark(book: number, chapter: number, verse: number): Mark | undefined {
  return load()[markKey(book, chapter, verse)];
}

/** Aplica cor e/ou anotação a vários versículos. `c: null` tira a cor; `note: ''` apaga a anotação. */
export function setMarks(book: number, chapter: number, verses: number[], patch: { c?: MarkColor | null; note?: string }) {
  const all = { ...load() };
  const t = Date.now();
  for (const v of verses) {
    const k = markKey(book, chapter, v);
    const cur: Mark = { ...(all[k] ?? { t }) };
    if (patch.c !== undefined) {
      if (patch.c) cur.c = patch.c;
      else delete cur.c;
    }
    if (patch.note !== undefined) {
      const n = patch.note.trim().slice(0, 2000);
      if (n) cur.note = n;
      else delete cur.note;
    }
    cur.t = t;
    if (!cur.c && !cur.note) delete all[k];
    else all[k] = cur;
  }
  save(all);
}

export function removeMark(book: number, chapter: number, verse: number) {
  const all = { ...load() };
  delete all[markKey(book, chapter, verse)];
  save(all);
}

export function allMarks(): MarkEntry[] {
  return Object.entries(load())
    .map(([k, m]) => {
      const [book, chapter, verse] = k.split(':').map(Number);
      return { ...m, book, chapter, verse };
    })
    .filter((m) => m.book >= 1 && m.book <= 66 && m.chapter >= 1 && m.verse >= 1)
    .sort((a, b) => b.t - a.t);
}

/** Re-renderiza quando as marcas mudam (inclusive em outra aba). */
export function useMarksVersion(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN((x) => x + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS) {
        cache = null;
        bump();
      }
    };
    window.addEventListener(EVENT, bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return n;
}

/** Para exportar/levar para outro aparelho. */
export function exportMarks(): string {
  return JSON.stringify(load());
}

export function importMarks(json: string): number {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Arquivo inválido.');
  const all = { ...load() };
  let n = 0;
  for (const [k, v] of Object.entries(parsed as Record<string, Mark>)) {
    if (!/^\d{1,2}:\d{1,3}:\d{1,3}$/.test(k) || !v || typeof v !== 'object') continue;
    const m: Mark = { t: typeof v.t === 'number' ? v.t : Date.now() };
    if (v.c && MARK_COLORS.some((c) => c.id === v.c)) m.c = v.c;
    if (typeof v.note === 'string' && v.note.trim()) m.note = v.note.slice(0, 2000);
    if (m.c || m.note) {
      all[k] = m;
      n++;
    }
  }
  save(all);
  return n;
}
