import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { Banknote, FileImage, HandCoins, Landmark, Plus, QrCode, Receipt, Trash2 } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Contribution, GivingInfo } from '../lib/types';
import { money, shortDate, todayYmd } from '../lib/format';
import { parseCents, pixPayload } from '../lib/pix';
import { prepareReceipt } from '../lib/image';
import { uploadImage } from '../lib/upload';
import {
  Button,
  Chips,
  confirmDialog,
  CopyButton,
  Empty,
  ErrorBox,
  LoadingList,
  LoginPrompt,
  mediaUrl,
  Page,
  Section,
  SelectField,
  Sheet,
  TextField,
  toastError,
  useAction,
} from '../components/ui';

const KEY_LABEL: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  telefone: 'Celular',
  email: 'E-mail',
  aleatoria: 'Chave aleatória',
};
const METHOD_LABEL: Record<string, string> = {
  pix: 'PIX',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  boleto: 'Boleto',
};
const STATUS: Record<string, { label: string; tone: string }> = {
  informado: { label: 'Informado', tone: 'warn' },
  conferido: { label: 'Conferido', tone: 'ok' },
  recusado: { label: 'Não localizado', tone: 'danger' },
};

function prettyKey(type: string, key: string) {
  if (type === 'cpf' && key.length === 11) return `${key.slice(0, 3)}.${key.slice(3, 6)}.${key.slice(6, 9)}-${key.slice(9)}`;
  if (type === 'cnpj' && key.length === 14) return `${key.slice(0, 2)}.${key.slice(2, 5)}.${key.slice(5, 8)}/${key.slice(8, 12)}-${key.slice(12)}`;
  if (type === 'telefone') {
    const d = key.replace(/\D/g, '').replace(/^55/, '');
    return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : key;
  }
  return key;
}

function KvRow({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="kv-row">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small muted">{label}</div>
        <div style={{ fontWeight: 620, overflowWrap: 'anywhere' }}>{value}</div>
      </div>
      {copy && <CopyButton text={copy} label="Copiar" />}
    </div>
  );
}

export function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <div className="qr">
      <svg viewBox={`-2 -2 ${svg.n + 4} ${svg.n + 4}`} shapeRendering="crispEdges" role="img" aria-label="QR Code PIX">
        <rect x={-2} y={-2} width={svg.n + 4} height={svg.n + 4} fill="#fff" />
        <path d={svg.d} fill="#0b1d3f" />
      </svg>
    </div>
  );
}

export default function Giving() {
  const { isMember, isAdmin } = useSession();
  const { data, error, loading, reload } = useApi<GivingInfo>('/dizimos');
  const [type, setType] = useState('');
  const [amount, setAmount] = useState('');
  const [registering, setRegistering] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const types = data?.types?.length ? data.types : ['Dízimo', 'Oferta'];
  const current = type || types[0];
  const cents = parseCents(amount);
  const payload =
    data?.pix_key && data.pix_key_type
      ? pixPayload({ key: data.pix_key, name: data.pix_name ?? '', city: data.pix_city ?? '', amountCents: cents, txid: current, description: `${current} IRN` })
      : '';

  return (
    <Page title="Dízimos e ofertas">
      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data ? (
        <LoadingList n={2} h={200} />
      ) : data?.restricted ? (
        <LoginPrompt text="Os dados para contribuir ficam na área dos membros. Entre com sua conta Google." />
      ) : data && !data.configured ? (
        <div className="card card-pad">
          <Empty
            icon={<HandCoins />}
            title="Dados de contribuição ainda não cadastrados"
            text={isAdmin ? 'Cadastre a chave PIX e a conta bancária para os membros contribuírem pelo app.' : 'A administração ainda vai cadastrar a chave PIX e a conta da igreja.'}
            action={
              isAdmin ? (
                <Link className="btn btn-primary" to="/admin/config?aba=dizimos">
                  Cadastrar agora
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : data ? (
        <div className="stack-lg">
          <div className="word-card">
            <div className="kicker">Fidelidade e gratidão</div>
            {data.message && <p className="verse mt-2">{data.message}</p>}
            <p className="small mt-2" style={{ color: 'var(--ink-2)' }}>
              Sua contribuição sustenta a obra, os projetos e as missões da igreja. Contribua com alegria!
            </p>
          </div>

          {payload && (
            <section className="card card-pad stack">
              <div className="row">
                <div className="icon-tile gold">
                  <QrCode />
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>PIX</div>
                  <div className="small muted">
                    Favorecido: {[data.holder_title, data.holder_name].filter(Boolean).join(' ')}
                  </div>
                </div>
              </div>
              <Chips wrap value={current} onChange={setType} options={types.map((t) => ({ value: t, label: t }))} />
              <TextField
                label="Valor (opcional)"
                value={amount}
                onChange={(v) => setAmount(v.replace(/[^\d,.]/g, ''))}
                placeholder="Ex.: 100,00"
                inputMode="decimal"
                hint={cents ? `O código já vai com ${money(cents)}.` : 'Sem valor, você digita no app do banco.'}
              />
              <Qr text={payload} />
              <CopyButton text={payload} label="Copiar código PIX (copia e cola)" done="Código PIX copiado!" variant="primary" size="md" block />
              <div className="pix-code" aria-label="Código PIX">
                {payload}
              </div>
              <div className="divider" />
              <KvRow label={`Chave PIX (${KEY_LABEL[data.pix_key_type!] ?? 'PIX'})`} value={prettyKey(data.pix_key_type!, data.pix_key!)} copy={data.pix_key!} />
              <p className="tiny muted">No app do seu banco: PIX → Pagar com QR Code (ou "Pix Copia e Cola") e cole o código.</p>
            </section>
          )}

          {data.account && (
            <section className="card card-pad stack">
              <div className="row">
                <div className="icon-tile">
                  <Landmark />
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>Transferência bancária</div>
                  <div className="small muted">TED ou depósito</div>
                </div>
              </div>
              <div>
                {data.bank_name && <KvRow label="Banco" value={[data.bank_code, data.bank_name].filter(Boolean).join(' – ')} />}
                {data.agency && <KvRow label="Agência" value={data.agency} copy={data.agency} />}
                <KvRow
                  label={data.account_type === 'poupanca' ? 'Conta poupança' : data.account_type === 'pagamento' ? 'Conta de pagamento' : 'Conta corrente'}
                  value={data.account}
                  copy={data.account}
                />
                <KvRow label="Titular" value={[data.holder_title, data.holder_name].filter(Boolean).join(' ')} />
                {data.holder_doc && <KvRow label="CPF/CNPJ" value={data.holder_doc} copy={data.holder_doc.replace(/\D/g, '')} />}
              </div>
            </section>
          )}

          {isMember ? (
            <Section
              title="Minhas contribuições"
              action={
                <button className="link-btn row" style={{ gap: 4 }} onClick={() => setRegistering(true)}>
                  <Plus size={16} /> Registrar
                </button>
              }
            >
              <MyContributions key={historyKey} onAdd={() => setRegistering(true)} />
            </Section>
          ) : null}
        </div>
      ) : null}
      {registering && data && (
        <RegisterSheet
          types={types}
          initialType={current}
          initialAmount={amount}
          onClose={() => setRegistering(false)}
          onDone={() => setHistoryKey((k) => k + 1)}
        />
      )}
    </Page>
  );
}

function MyContributions({ onAdd }: { onAdd: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, reload, mutate } = useApi<{ year: number; contributions: Contribution[]; total_cents: number }>(`/contribuicoes/minhas?ano=${year}`);
  return (
    <div className="stack">
      <div className="row-between">
        <Chips
          value={String(year)}
          onChange={(v) => setYear(Number(v))}
          options={[0, 1, 2].map((i) => {
            const y = new Date().getFullYear() - i;
            return { value: String(y), label: String(y) };
          })}
        />
        {data && <div style={{ fontWeight: 700 }}>{money(data.total_cents)}</div>}
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {data && data.contributions.length ? (
        <div className="card">
          <div className="list">
            {data.contributions.map((c) => (
              <div key={c.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="icon-tile gold">
                  <Banknote />
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 620 }}>
                    {c.type} · {money(c.amount_cents)}
                  </div>
                  <div className="small muted">
                    {shortDate(c.given_on)} · {METHOD_LABEL[c.method] ?? c.method}
                    {c.receipt_id && (
                      <>
                        {' · '}
                        <a href={mediaUrl(c.receipt_id)} target="_blank" rel="noopener noreferrer">
                          comprovante
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <span className={`badge ${STATUS[c.status]?.tone ?? ''}`}>{STATUS[c.status]?.label ?? c.status}</span>
                {c.status === 'informado' && (
                  <button
                    className="icon-btn"
                    aria-label="Apagar registro"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'Apagar este registro?', confirmLabel: 'Apagar', danger: true }))) return;
                      try {
                        await api(`/contribuicoes/${c.id}`, { method: 'DELETE' });
                        mutate((d) => ({ ...d, contributions: d.contributions.filter((x) => x.id !== c.id), total_cents: d.total_cents - c.amount_cents }));
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : data ? (
        <div className="card card-pad">
          <Empty
            icon={<Receipt />}
            title="Nenhum registro neste ano"
            text="Depois de contribuir, registre aqui (com o comprovante, se quiser). A tesouraria confere e você acompanha seu histórico."
            action={
              <Button variant="secondary" icon={<Plus />} onClick={onAdd}>
                Registrar contribuição
              </Button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function RegisterSheet({ types, initialType, initialAmount, onClose, onDone }: { types: string[]; initialType: string; initialAmount: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState(initialType);
  const [amount, setAmount] = useState(initialAmount);
  const [date, setDate] = useState(todayYmd());
  const [method, setMethod] = useState('pix');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();

  const pickReceipt = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try {
      setReceipt(await uploadImage(await prepareReceipt(f), 'receipt'));
    } catch (e) {
      toastError(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet
      open
      title="Registrar contribuição"
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api('/contribuicoes', { method: 'POST', body: { type, amount, given_on: date, method, note, receipt_id: receipt } });
              onDone();
              onClose();
            }, 'Registrado! Obrigado pela sua fidelidade.')
          }
        >
          Registrar
        </Button>
      }
    >
      <div className="stack">
        <SelectField label="Tipo" value={type} onChange={setType} options={[...types, 'Outro'].map((t) => ({ value: t, label: t }))} />
        <div className="form-grid">
          <TextField label="Valor (R$)" value={amount} onChange={(v) => setAmount(v.replace(/[^\d,.]/g, ''))} placeholder="100,00" inputMode="decimal" />
          <TextField label="Data" type="date" value={date} onChange={setDate} max={todayYmd()} />
        </div>
        <SelectField label="Forma" value={method} onChange={setMethod} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
        <div className="field">
          <span className="field-label">Comprovante (opcional)</span>
          <button type="button" className="dropzone" onClick={() => input.current?.click()} disabled={uploading}>
            <FileImage />
            <span className="small">{uploading ? 'Enviando…' : receipt ? 'Comprovante anexado ✓ (toque para trocar)' : 'Anexar print do comprovante'}</span>
          </button>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pickReceipt(e.target.files?.[0])} />
          <div className="hint">Só você e a administração veem o comprovante.</div>
        </div>
        <TextField label="Observação (opcional)" value={note} onChange={setNote} maxLength={300} />
      </div>
    </Sheet>
  );
}
