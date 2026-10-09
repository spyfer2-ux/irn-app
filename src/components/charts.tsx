/**
 * Gráfico de colunas por mês (uma ou mais séries empilhadas), com dica ao passar o dedo/mouse,
 * legenda para 2+ séries e a opção "Ver tabela" (os mesmos números, sem depender de cor).
 */
import { useId, useMemo, useState } from 'react';
import { Table2, BarChart3 } from 'lucide-react';

export interface ChartSeries {
  key: string;
  label: string;
  color: string; // variável CSS, ex.: var(--series-1)
}
export interface ChartRow {
  label: string; // rótulo curto no eixo (ex.: "jan")
  full: string; // rótulo completo na dica/tabela (ex.: "janeiro de 2026")
  values: Record<string, number>;
}

function niceMax(v: number, integer: boolean) {
  if (integer) {
    // contagens: escala com números inteiros e marca do meio também inteira (2, 4, 10, 20, 40, 100…)
    const val = Math.max(v, 2);
    const exp = Math.pow(10, Math.floor(Math.log10(val)));
    for (const m of [1, 2, 4, 5, 10]) if (m * exp >= val && (m * exp) % 2 === 0) return m * exp;
    return 10 * exp;
  }
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

export function ColumnChart({
  title,
  subtitle,
  rows,
  series,
  format = (n) => n.toLocaleString('pt-BR'),
  height = 150,
  integer = true,
}: {
  title: string;
  subtitle?: string;
  rows: ChartRow[];
  series: ChartSeries[];
  format?: (n: number) => string;
  height?: number;
  integer?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const totals = useMemo(() => rows.map((r) => series.reduce((s, x) => s + (r.values[x.key] ?? 0), 0)), [rows, series]);
  const max = niceMax(Math.max(0, ...totals), integer);
  const peak = totals.indexOf(Math.max(...totals));
  let lastNonZero = -1;
  totals.forEach((t, i) => {
    if (t > 0) lastNonZero = i;
  });
  const labelled = new Set([peak, lastNonZero].filter((i) => i >= 0 && totals[i] > 0));
  const empty = totals.every((t) => t === 0);

  return (
    <figure className="card card-pad viz" style={{ margin: 0 }} aria-labelledby={`${id}-t`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <figcaption>
          <div id={`${id}-t`} style={{ fontWeight: 650 }}>
            {title}
          </div>
          {subtitle && <div className="small muted">{subtitle}</div>}
        </figcaption>
        <button className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? <BarChart3 /> : <Table2 />}
          {table ? 'Gráfico' : 'Tabela'}
        </button>
      </div>

      {series.length > 1 && (
        <div className="viz-legend" aria-hidden={table}>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {table ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="viz-table">
            <thead>
              <tr>
                <th>Mês</th>
                {series.length > 1 && series.map((s) => <th key={s.key}>{s.label}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.full}>
                  <td>{r.full}</td>
                  {series.length > 1 && series.map((s) => <td key={s.key}>{format(r.values[s.key] ?? 0)}</td>)}
                  <td style={{ fontWeight: 650 }}>{format(totals[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : empty ? (
        <div className="small muted" style={{ padding: '28px 0', textAlign: 'center' }}>
          Ainda não há dados neste período.
        </div>
      ) : (
        <div className="viz-plot" style={{ height: height + 22 }} onPointerLeave={() => setHover(null)}>
          <div className="viz-grid" style={{ height }}>
            <span style={{ bottom: '100%' }}>{format(max)}</span>
            <span style={{ bottom: '50%' }}>{format(max / 2)}</span>
          </div>
          <div className="viz-cols" style={{ height: height + 22 }}>
            {rows.map((r, i) => {
              const h = (totals[i] / max) * height;
              const shown = series.filter((s) => (r.values[s.key] ?? 0) > 0);
              return (
                <div
                  key={r.full}
                  className={`viz-col ${hover === i ? 'on' : ''}`}
                  tabIndex={0}
                  role="img"
                  aria-label={`${r.full}: ${format(totals[i])}`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <div className="viz-slot" style={{ height }}>
                    {labelled.has(i) && hover !== i && (
                      <span className="viz-val" style={{ bottom: h + 4 }}>
                        {format(totals[i])}
                      </span>
                    )}
                    <div className="viz-bar" style={{ height: Math.max(h, totals[i] > 0 ? 2 : 0) }}>
                      {[...shown].reverse().map((s) => (
                        <div key={s.key} style={{ flex: r.values[s.key], background: s.color }} />
                      ))}
                    </div>
                  </div>
                  <span className="viz-x">{r.label}</span>
                  {hover === i && (
                    <div className={`viz-tip ${i > rows.length / 2 ? 'left' : ''}`} style={{ bottom: Math.min(h, height - 20) + 30 }}>
                      <div className="viz-tip-h">{r.full}</div>
                      {series.length > 1 ? (
                        series.map((s) => (
                          <div key={s.key} className="viz-tip-r">
                            <i style={{ background: s.color }} />
                            <strong>{format(r.values[s.key] ?? 0)}</strong>
                            <span>{s.label}</span>
                          </div>
                        ))
                      ) : (
                        <div className="viz-tip-r">
                          <strong>{format(totals[i])}</strong>
                        </div>
                      )}
                      {series.length > 1 && (
                        <div className="viz-tip-r" style={{ borderTop: '1px solid var(--line)', paddingTop: 4, marginTop: 2 }}>
                          <strong>{format(totals[i])}</strong>
                          <span>Total</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </figure>
  );
}

/** Número de destaque com rótulo (sem gráfico). */
export function StatTile({ label, value, hint, to }: { label: string; value: string | number; hint?: string; to?: string }) {
  const inner = (
    <>
      <div className="n">{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</div>
      <div className="l">{label}</div>
      {hint && <div className="tiny muted mt-1">{hint}</div>}
    </>
  );
  return to ? (
    <a href={to} className="card stat card-link">
      {inner}
    </a>
  ) : (
    <div className="card stat">{inner}</div>
  );
}
