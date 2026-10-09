import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  /** Armazenamento R2 (opcional). Sem ele, as fotos ficam no próprio banco D1 e o envio de vídeos fica desligado. */
  BUCKET?: R2Bucket;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** E-mails que entram direto como administradores (separados por vírgula). */
  ADMIN_EMAILS?: string;
  /** Só para desenvolvimento local: libera o login de teste sem Google. Só funciona em localhost. */
  DEV_LOGIN?: string;
  /** Só para testes automatizados: troca os endereços do Google por um provedor de mentira. */
  OIDC_AUTH_URL?: string;
  OIDC_TOKEN_URL?: string;
  OIDC_JWKS_URL?: string;
  OIDC_ISSUER?: string;
}

export type Role = 'membro' | 'midia' | 'lider' | 'admin';
export type Status = 'pendente' | 'aprovado' | 'bloqueado';

export interface User {
  id: number;
  google_sub: string | null;
  email: string;
  name: string;
  picture: string | null;
  role: Role;
  status: Status;
  phone: string | null;
  birthday: string | null;
  show_birthday: number;
  neighborhood: string | null;
  baptized: number | null;
  member_since: string | null;
  intro: string | null;
  notes: string | null;
  accepted_terms_at: number | null;
  created_at: number;
  approved_at: number | null;
  approved_by: number | null;
  last_seen_at: number | null;
}

export type Vars = { user: User | null };
export type AppEnv = { Bindings: Env; Variables: Vars };
export type Ctx = Context<AppEnv>;
