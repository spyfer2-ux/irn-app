import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface Opts {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  contentType?: string;
  signal?: AbortSignal;
}

/** Chamada ao servidor do app. Erros viram ApiError com a mensagem em português vinda do servidor. */
export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-irn': '1' };
  let payload: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  } else if (opts.raw !== undefined) {
    payload = opts.raw;
    if (opts.contentType) headers['content-type'] = opts.contentType;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (payload !== undefined ? 'POST' : 'GET'),
      headers,
      body: payload,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Sem conexão com a internet. Verifique e tente de novo.', 0);
  }
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError((data as { error?: string } | null)?.error ?? `Erro ${res.status}`, res.status);
  return data as T;
}

const cache = new Map<string, unknown>();

export function clearApiCache() {
  cache.clear();
}

/** Busca dados e guarda em memória: ao voltar para uma tela, ela aparece na hora e atualiza em seguida. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path && !cache.has(path));
  const current = useRef(path);
  current.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (current.current !== path) return;
      cache.set(path, d);
      setData(d);
      setError(null);
    } catch (e) {
      if (current.current !== path) return;
      setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }
    setData(cache.get(path) as T | undefined);
    setError(null);
    void load();
  }, [path, load]);

  const mutate = useCallback(
    (fn: (d: T) => T) => {
      setData((d) => {
        if (d === undefined) return d;
        const next = fn(d);
        if (path) cache.set(path, next);
        return next;
      });
    },
    [path],
  );

  return { data, error, loading, reload: load, mutate };
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Algo deu errado.';
}
