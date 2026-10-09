import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, ImagePlus, Loader2, LogIn, Clock, X } from 'lucide-react';
import { initials } from '../lib/format';
import { useSession } from '../lib/session';
import { prepareCover } from '../lib/image';
import { uploadImage } from '../lib/upload';
import { errMsg } from '../lib/api';

// ---------------- avisos rápidos (toasts) ----------------

type ToastKind = 'info' | 'ok' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}
let toastListener: ((t: ToastItem) => void) | null = null;
let toastSeq = 0;

export function toast(text: string, kind: ToastKind = 'info') {
  toastListener?.({ id: ++toastSeq, text, kind });
}
export const toastError = (e: unknown) => toast(errMsg(e), 'error');

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    toastListener = (t) => {
      setItems((l) => [...l.slice(-2), t]);
      setTimeout(() => setItems((l) => l.filter((x) => x.id !== t.id)), t.kind === 'error' ? 5200 : 3200);
    };
    return () => {
      toastListener = null;
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' && <Check size={18} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- confirmação ----------------

interface ConfirmReq {
  title: string;
  text?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}
let confirmListener: ((r: ConfirmReq) => void) | null = null;

export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmListener) return resolve(false);
    confirmListener({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    confirmListener = setReq;
    return () => {
      confirmListener = null;
    };
  }, []);
  if (!req) return null;
  const close = (v: boolean) => {
    req.resolve(v);
    setReq(null);
  };
  return (
    <Sheet open title={req.title} onClose={() => close(false)} small top>
      {req.text && <p className="pre" style={{ color: 'var(--ink-2)' }}>{req.text}</p>}
      <div className="row mt-3">
        <button className="btn btn-secondary grow" onClick={() => close(false)}>
          Voltar
        </button>
        <button className={`btn grow ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
          {req.confirmLabel ?? 'Confirmar'}
        </button>
      </div>
    </Sheet>
  );
}

// ---------------- estrutura de página ----------------

export function Page({
  title,
  back,
  actions,
  children,
  wide,
}: {
  title: string;
  back?: string | boolean;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    document.title = `${title} · IRN`;
  }, [title]);
  const goBack = () => {
    if (typeof back === 'string') navigate(back);
    else if (window.history.length > 1 && loc.key !== 'default') navigate(-1);
    else navigate('/');
  };
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in" style={wide ? { maxWidth: 1100 } : undefined}>
          {back && (
            <button className="icon-btn" onClick={goBack} aria-label="Voltar" style={{ marginLeft: -8 }}>
              <ArrowLeft />
            </button>
          )}
          <h1>{title}</h1>
          {actions}
        </div>
      </header>
      <main className="wrap page" style={wide ? { maxWidth: 1100 } : undefined}>
        {children}
      </main>
    </>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="section-title">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------- botões ----------------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'navy' | 'gold' | 'live' | 'ok' | 'white' | 'glass';
  size?: 'sm' | 'md';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'primary', size = 'md', block, loading, icon, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="spin" /> : icon}
      {children}
    </button>
  );
}

/** Executa uma ação assíncrona mostrando "carregando" e o erro, se houver. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      if (okText) toast(okText, 'ok');
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function CopyButton({ text, label = 'Copiar', done = 'Copiado!', variant = 'soft', size = 'sm', block }: {
  text: string;
  label?: string;
  done?: string;
  variant?: BtnProps['variant'];
  size?: 'sm' | 'md';
  block?: boolean;
}) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setOk(true);
    toast(done, 'ok');
    setTimeout(() => setOk(false), 2000);
  };
  return (
    <Button variant={variant} size={size} block={block} onClick={copy} icon={ok ? <Check /> : <Copy />} type="button">
      {ok ? done : label}
    </Button>
  );
}

// ---------------- formulários ----------------

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  maxLength,
  multiline,
  rows,
  inputMode,
  autoComplete,
  min,
  max,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  rows?: number;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url';
  autoComplete?: string;
  min?: string;
  max?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      {multiline ? (
        <textarea
          id={id}
          className="textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          maxLength={maxLength}
          rows={rows}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          maxLength={maxLength}
          inputMode={inputMode}
          autoComplete={autoComplete}
          min={min}
          max={max}
        />
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
  wrap,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  wrap?: boolean;
}) {
  return (
    <div className="chips" style={wrap ? { flexWrap: 'wrap', overflow: 'visible' } : undefined}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- janela (sheet) ----------------

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  small,
  top,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  small?: boolean;
  top?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    // No computador, já deixa o cursor no primeiro campo (só uma vez, ao abrir).
    const first = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]), textarea, select');
    const t = first && window.matchMedia('(hover: hover) and (pointer: fine)').matches ? window.setTimeout(() => first.focus(), 50) : undefined;
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="backdrop" style={top ? { zIndex: 120 } : undefined} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={small ? { maxWidth: 440 } : undefined}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- estados ----------------

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon-tile gray">{icon}</div>
      <h3>{title}</h3>
      {text && <p className="small" style={{ maxWidth: 340 }}>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 80, r }: { h?: number; r?: number }) {
  return <div className="skeleton" style={{ height: h, borderRadius: r }} />;
}

export function LoadingList({ n = 3, h = 74 }: { n?: number; h?: number }) {
  return (
    <div className="stack">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} h={h} r={18} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="alert danger">
      <X />
      <div className="grow">
        <div>{errMsg(error)}</div>
        {retry && (
          <button className="link-btn mt-1" onClick={retry}>
            Tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- imagens e pessoas ----------------

export function mediaUrl(id: string) {
  return `/api/media/${id}`;
}

export function MediaImg({ id, alt = '', className, style }: { id: string; alt?: string; className?: string; style?: React.CSSProperties }) {
  return <img src={mediaUrl(id)} alt={alt} className={className} style={style} loading="lazy" decoding="async" />;
}

export function Avatar({ name, picture, size = 36 }: { name: string | null; picture?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (picture && !broken)
    return (
      <img
        className="avatar"
        src={picture}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials(name || '?')}
    </span>
  );
}

export const ROLE_LABEL: Record<string, string> = {
  membro: 'Membro',
  midia: 'Equipe de mídia',
  lider: 'Liderança',
  admin: 'Administrador',
};

/** Escolher imagem de capa: reduz no celular, envia e devolve o id do arquivo. */
export function CoverPicker({
  value,
  onChange,
  access,
  label = 'Imagem (opcional)',
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  access: 'public' | 'members';
  label?: string;
}) {
  const { features } = useSession();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const img = await prepareCover(file, features.storage);
      onChange(await uploadImage(img, 'cover', access));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {value ? (
        <div className="stack" style={{ gap: 8 }}>
          <MediaImg id={value} className="cover" />
          <div className="row">
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()} loading={busy} type="button">
              Trocar imagem
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onChange(null)} type="button">
              Remover
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="dropzone" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="spin" /> : <ImagePlus />}
          <span className="small">{busy ? 'Enviando…' : 'Toque para escolher uma imagem'}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

// ---------------- acesso ----------------

export function LoginPrompt({ text }: { text?: string }) {
  const loc = useLocation();
  return (
    <div className="card card-pad">
      <Empty
        icon={<LogIn />}
        title="Área dos membros"
        text={text ?? 'Entre com sua conta Google. Depois que a liderança aprovar seu cadastro, você vê tudo por aqui.'}
        action={
          <Link className="btn btn-primary" to={`/entrar?voltar=${encodeURIComponent(loc.pathname + loc.search)}`}>
            <LogIn /> Entrar com Google
          </Link>
        }
      />
    </div>
  );
}

export function PendingBox() {
  return (
    <div className="card card-pad">
      <Empty
        icon={<Clock />}
        title="Cadastro em análise"
        text="A liderança ainda vai aprovar o seu acesso. Assim que aprovar, esta área é liberada."
        action={
          <Link className="btn btn-secondary" to="/aguardando">
            Ver meu cadastro
          </Link>
        }
      />
    </div>
  );
}

/** Mostra o conteúdo só para membros aprovados. */
export function MembersOnly({ children, text }: { children: ReactNode; text?: string }) {
  const { user, isMember } = useSession();
  if (!user) return <LoginPrompt text={text} />;
  if (user.status === 'bloqueado') return <div className="alert danger">Seu acesso foi bloqueado pela liderança.</div>;
  if (!isMember) return <PendingBox />;
  return <>{children}</>;
}

export function RoleOnly({ need, children }: { need: 'media' | 'leader' | 'admin'; children: ReactNode }) {
  const s = useSession();
  const ok = need === 'admin' ? s.isAdmin : need === 'leader' ? s.isLeader : s.isMedia;
  if (!s.user) return <LoginPrompt />;
  if (!ok)
    return (
      <div className="alert warn">
        <X />
        <span>Esta área é só para {need === 'admin' ? 'administradores' : need === 'leader' ? 'a liderança' : 'a equipe de mídia'}.</span>
      </div>
    );
  return <>{children}</>;
}
