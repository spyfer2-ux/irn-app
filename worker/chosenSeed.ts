/**
 * Primeiros Shorts de "Novidades de The Chosen", já conferidos no canal oficial (@TheChosenSeries).
 * Depois disso o app busca os novos sozinho no feed do canal (ver routes/chosen.ts).
 * "ref" é a passagem bíblica do Short, quando dá para saber com certeza.
 */
const SHORTS: [id: string, title: string, ref?: string][] = [
  ['X2eOFzeOp2U', 'Também humanos...'],
  ['zfZph8VG3J4', 'Precisamos desse lembrete mais vezes do que gostaríamos de admitir...'],
  ['XUe39Ebthaw', 'Seu lembrete diário para não jogar a toalha.'],
  ['guzf8NY1rkE', 'Essa frase nos faz parar tudo toda vez.'],
  ['3rQkhmgiGWI', 'Da cegueira à visão. Da morte à vida.'],
  ['519EZODONZM', 'Um encontro momentâneo pode mudar o curso da vida para sempre.'],
  ['hJMPtEEd6VI', 'Pedro, "a Rocha"', 'mt 16:18'],
  ['FOORUTVQl4o', 'Essa é uma pergunta que vale a pena refletir.'],
  ['6LczXw2Z2xM', 'O que parece o fim é só o começo.'],
  ['cc3jBuUKFNg', 'O caminho do Senhor está preparado.', 'mt 3:3'],
  ['x8XhToe9SG4', 'Pronto? Com certeza. Fácil? Jamais.'],
  ['5izy4qz8in0', 'Uma das nossas falas mais marcantes...'],
  ['Rg8hDrWoIbs', 'A última conversa de André e João.'],
  ['F6XV8LnjL1Y', 'Jesus se revela a Fótina, a mulher que se sentia assombrada pelo passado.', 'jo 4:1-42'],
  ['83oDWQ8rh0Y', 'Fótina era assombrada pelo seu passado...', 'jo 4:1-42'],
  ['4-cT1AN4ZX0', 'Este não é só mais um rabino.'],
  ['q-DR0l2s-n8', 'São estes os dias…'],
  ['tyEwjqU5bWY', 'Ela abriu o telhado de um estranho só para o amigo ser curado.', 'mc 2:1-12'],
  ['_yyIc2X62MI', 'Te seguir? Nem precisa pedir.'],
  ['UkMxixn1s9A', 'Simão tem o que chamaríamos de "um passado".'],
  ['ait92Jj72Zk', 'Um momento que não tem volta.'],
  ['y-eFuNmdh7s', 'Não precisa ser complicado.'],
  ['1YpJ55IK8LU', 'AQUELA cena da 5ª temporada, episódio dois.'],
  ['IOPRlvc1m6Y', 'Pedro só está tentando acompanhar o ritmo.'],
  ['4JcQOSvq6DI', 'Quer saber o que ela pediu?'],
  ['_tPmsWMn-Wo', 'Ainda bem que Jesus não aceita sugestões.'],
  ['btDvCEFfKAU', 'Este pai não estava pronto para desistir. (1/3)', 'mc 5:21-24'],
  ['HEd2yHYW2No', 'Quanta fé... e ele nem conhecia Jesus ainda. (2/3)', 'mc 5:21-24'],
  ['wsbHoXaeLAk', '"Menina, levante-se." (3/3)', 'mc 5:35-43'],
  ['6U_1qIcY6co', 'Não é o primeiro milagre "errado" que Ele faz... e não será o último.'],
];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** SQL que coloca os Shorts iniciais no banco (do mais novo para o mais antigo). */
export function chosenSeedInserts(newest = Date.UTC(2026, 9, 12, 21)): string[] {
  return SHORTS.map(
    ([id, title, ref], i) =>
      `INSERT INTO chosen_feed (youtube_id, title, kind, ref, published_at, hidden, created_at)
       VALUES (${q(id)}, ${q(title)}, 'short', ${ref ? q(ref) : 'NULL'}, ${newest - i * 86400000}, 0, ${newest})
       ON CONFLICT(youtube_id) DO NOTHING`,
  );
}

export const CHOSEN_SEED_COUNT = SHORTS.length;
