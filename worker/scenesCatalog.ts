/**
 * Catálogo inicial de "Cenas que pregam": vídeos do canal OFICIAL da série The Chosen no YouTube
 * (youtube.com/@TheChosenSeries), cada um com a passagem bíblica da cena e perguntas para a célula.
 *
 * Todos os vídeos foram conferidos no YouTube (existem, são do canal "The Chosen" e podem tocar fora do YouTube).
 * O app só guarda o código do vídeo: quem toca é o player do YouTube.
 * Livros: 1 = Gênesis … 19 = Salmos, 23 = Isaías, 40 = Mateus, 41 = Marcos, 42 = Lucas, 43 = João.
 */

export interface CatalogScene {
  yt: string;
  title: string;
  /** [livro, capítulo, versículo inicial?, versículo final?] */
  ref: [number, number, number?, number?];
  questions: string[];
}

export const SCENES_CATALOG: CatalogScene[] = [
  {
    yt: '3cPIMHnPOzc',
    title: 'Não há lugar na hospedaria',
    ref: [42, 2, 1, 7],
    questions: ['Por que Deus escolheu um lugar tão simples para Jesus nascer?', 'Onde você tem "deixado sem lugar" para Jesus na sua rotina?'],
  },
  {
    yt: 'Xz_QEYwerkw',
    title: 'No princípio era o Verbo',
    ref: [43, 1, 1, 14],
    questions: ['O que significa Jesus ser "o Verbo que se fez carne"?', 'Como a luz de Jesus já brilhou numa área escura da sua vida?'],
  },
  {
    yt: 'mDrV2ghPcoA',
    title: 'Eu te chamei pelo nome',
    ref: [23, 43, 1],
    questions: ['Como Maria Madalena estava antes de Jesus chamá-la pelo nome?', 'Você crê que Deus conhece e chama você pelo nome? O que isso muda hoje?'],
  },
  {
    yt: 'MhjvAAkXbj0',
    title: 'Jesus transforma água em vinho',
    ref: [43, 2, 1, 11],
    questions: ['O que a atitude de Maria ("façam tudo o que ele mandar") nos ensina?', 'Em que área da sua casa está "faltando vinho" e você precisa levar a Jesus?'],
  },
  {
    yt: '_p2XIUK9VgA',
    title: 'Jesus e Nicodemos: João 3:16',
    ref: [43, 3, 1, 21],
    questions: ['O que Jesus quis dizer com "nascer de novo"?', 'O que mais toca você em João 3:16?', 'Por que Nicodemos foi procurar Jesus à noite?'],
  },
  {
    yt: 'hWGCkovAUWM',
    title: 'O milagre da pesca',
    ref: [42, 5, 1, 11],
    questions: ['Pedro obedeceu mesmo achando que não ia dar certo. Já passou por isso?', 'Por que Pedro disse "afasta-te de mim, que sou pecador"?', 'O que significa ser "pescador de homens" hoje?'],
  },
  {
    yt: 'ordhsDeAt60',
    title: 'Jesus e a mulher junto ao poço',
    ref: [43, 4, 1, 42],
    questions: ['Por que era tão surpreendente Jesus falar com aquela mulher?', 'O que é a "água viva" que Jesus oferece?', 'Depois do encontro, ela foi contar para a cidade. Para quem você pode contar?'],
  },
  {
    yt: 'JMj1ggINLe4',
    title: 'Jesus cura no tanque de Betesda',
    ref: [43, 5, 1, 15],
    questions: ['Por que Jesus perguntou "você quer ser curado?"', 'Em que você tem esperado "alguém te colocar na água" em vez de olhar para Jesus?'],
  },
  {
    yt: 'gxT8N0uJJs8',
    title: 'Jesus alimenta os cinco mil',
    ref: [43, 6, 1, 14],
    questions: ['O que o menino tinha era pouco. O que você tem nas mãos para entregar a Jesus?', 'Como os discípulos reagiram ao problema? E como Jesus reagiu?'],
  },
  {
    yt: 'x9tTdR7WS7E',
    title: 'Eu sou a ressurreição e a vida',
    ref: [43, 11, 25, 26],
    questions: ['Jesus perguntou a Marta: "Você crê nisso?" Como você responderia?', 'Que esperança essa palavra traz diante da perda e do luto?'],
  },
  {
    yt: 'e-OXgunuz_4',
    title: 'Jesus ressuscita Lázaro',
    ref: [43, 11, 38, 44],
    questions: ['Por que Jesus chorou, se ia ressuscitar Lázaro?', 'Qual "pedra" precisa ser tirada para Deus agir na sua vida?'],
  },
  {
    yt: '__khPizm4j8',
    title: 'Maria de Betânia unge Jesus',
    ref: [43, 12, 1, 8],
    questions: ['Por que Judas criticou a atitude de Maria?', 'O que significa adorar a Jesus sem medir o custo?'],
  },
  {
    yt: 'VL8DThllZAY',
    title: 'Jesus cura o leproso',
    ref: [40, 8, 1, 4],
    questions: ['O leproso disse: "se quiseres, podes me purificar". O que essa frase mostra?', 'Jesus tocou quem ninguém tocava. Quem precisa do nosso toque hoje?'],
  },
  {
    yt: 'dlBOmQ1PaMY',
    title: 'Jesus cura o paralítico',
    ref: [40, 9, 1, 8],
    questions: ['Os amigos abriram o telhado. Por quem você tem "aberto caminho" até Jesus?', 'Por que Jesus perdoou os pecados antes de curar o corpo?'],
  },
  {
    yt: '7IUL9yq0We8',
    title: 'Jesus chama Mateus, o cobrador de impostos',
    ref: [40, 9, 9, 13],
    questions: ['Por que os outros discípulos estranharam o chamado de Mateus?', 'Jesus disse que veio chamar pecadores. Quem nós temos excluído?'],
  },
  {
    yt: 'o5OnF3sg0cY',
    title: 'Jesus ensina as bem-aventuranças',
    ref: [40, 5, 1, 12],
    questions: ['Qual bem-aventurança mais fala com você neste momento?', 'Por que Jesus chama de "felizes" pessoas que choram e são perseguidas?'],
  },
  {
    yt: 'uDJTRC6LIOk',
    title: 'O Sermão do Monte',
    ref: [40, 5],
    questions: ['Qual ensino do sermão é o mais difícil de viver para você?', 'O que é ser "sal da terra e luz do mundo" no trabalho e em casa?'],
  },
  {
    yt: 'vnpcrpfvKR8',
    title: 'Jesus vai além: a segunda milha',
    ref: [40, 5, 38, 42],
    questions: ['O que significa "andar a segunda milha" na prática?', 'Com quem Deus está pedindo que você vá além do que é obrigado?'],
  },
  {
    yt: 'uxuVOVrBaHg',
    title: 'Jesus ensina os discípulos a orar',
    ref: [40, 6, 9, 13],
    questions: ['Qual parte do Pai Nosso você mais precisa orar hoje?', 'Como está a sua vida de oração no dia a dia?'],
  },
  {
    yt: 'QjQftj3ggms',
    title: 'Quando Simão se tornou Pedro',
    ref: [40, 10, 2],
    questions: ['O que muda quando Jesus dá um novo nome a alguém?', 'Que nome Jesus tem dado a você, no lugar dos nomes que o mundo te deu?'],
  },
  {
    yt: 'omrZFLlrLDU',
    title: 'És tu aquele que havia de vir?',
    ref: [40, 11, 2, 6],
    questions: ['Até João Batista teve dúvidas na prisão. O que isso nos ensina?', 'O que fazer quando Deus não age do jeito que esperamos?'],
  },
  {
    yt: 'kepfqB9mpKg',
    title: 'A morte de João Batista',
    ref: [40, 14, 1, 12],
    questions: ['Por que Herodes cedeu, mesmo sabendo que estava errado?', 'Qual é o preço de ser fiel à verdade?'],
  },
  {
    yt: 'O7WWi65gb14',
    title: 'Jesus anda sobre as águas e salva Pedro',
    ref: [40, 14, 22, 33],
    questions: ['O que fez Pedro afundar?', 'Qual "tempestade" tem tirado seus olhos de Jesus?', 'Como Jesus respondeu quando Pedro gritou por socorro?'],
  },
  {
    yt: 'q5NhJ_3xNOo',
    title: 'Perdoar setenta vezes sete',
    ref: [40, 18, 21, 22],
    questions: ['Por que perdoar é tão difícil?', 'Há alguém que você precisa perdoar de novo?'],
  },
  {
    yt: 'kf6K3NbOOyg',
    title: 'A entrada triunfal em Jerusalém',
    ref: [40, 21, 1, 11],
    questions: ['O povo esperava um rei de guerra e veio um rei num jumentinho. O que isso revela?', 'Jesus é rei de verdade na sua vida, ou só nos dias de festa?'],
  },
  {
    yt: 'HVyBKRj3X_U',
    title: 'Jesus fala do fim (Monte das Oliveiras)',
    ref: [40, 24, 1, 14],
    questions: ['Como devemos viver esperando a volta de Jesus?', 'O que Jesus diz para não nos deixarmos enganar?'],
  },
  {
    yt: 'p0H8sXNW2BA',
    title: 'A Última Ceia (completa)',
    ref: [40, 26, 17, 30],
    questions: ['O que o pão e o vinho representam?', 'Como você se prepara para a Santa Ceia?', 'O que mais chamou sua atenção na reação dos discípulos?'],
  },
  {
    yt: 'ywNvWU9ZsTA',
    title: 'Jesus cura a sogra de Simão',
    ref: [41, 1, 29, 31],
    questions: ['Depois de curada, ela começou a servir. O que isso nos ensina?', 'Você tem levado as necessidades da sua família a Jesus?'],
  },
  {
    yt: 'YWoTGzlefq8',
    title: 'Jesus cura a mão atrofiada',
    ref: [41, 3, 1, 6],
    questions: ['Por que os fariseus se importavam mais com a regra do que com o homem?', 'O que Jesus pede quando diz "estenda a mão"?'],
  },
  {
    yt: 'oI9AHBcW1Fg',
    title: 'Os doze descobrem que são os doze apóstolos',
    ref: [41, 3, 13, 19],
    questions: ['Por que Jesus escolheu pessoas tão diferentes entre si?', 'Para que Jesus chamou os doze, segundo o texto?'],
  },
  {
    yt: 'enwt-3kQsu4',
    title: 'Nascem os "filhos do trovão"',
    ref: [41, 3, 17],
    questions: ['Por que Jesus deu esse apelido a Tiago e João?', 'Como Jesus transforma o nosso temperamento?'],
  },
  {
    yt: 'pLbIaA5u3gY',
    title: 'Jesus ressuscita a filha de Jairo',
    ref: [41, 5, 21, 43],
    questions: ['Jesus disse a Jairo: "não tenha medo, apenas creia". Onde você precisa ouvir isso?', 'Como lidar com a demora de Deus?'],
  },
  {
    yt: 'ZxEDi-ygAdU',
    title: 'Dois a dois: Jesus envia os discípulos',
    ref: [41, 6, 7, 13],
    questions: ['Por que Jesus enviou os discípulos de dois em dois?', 'Quem pode ir com você levar o evangelho no seu bairro?'],
  },
  {
    yt: 'RNtUJsYmhtI',
    title: 'Jesus ama as criancinhas',
    ref: [41, 10, 13, 16],
    questions: ['O que significa receber o Reino como uma criança?', 'Como a nossa família e a igreja podem levar as crianças até Jesus?'],
  },
  {
    yt: '7Yi0_FS9zBs',
    title: 'Jesus purifica o templo',
    ref: [41, 11, 15, 18],
    questions: ['Por que Jesus ficou tão indignado no templo?', 'O que precisa ser "purificado" no templo do nosso coração?'],
  },
  {
    yt: 'pYEmdFyWBq8',
    title: 'Curada ao tocar a orla do manto',
    ref: [42, 8, 43, 48],
    questions: ['O que levou aquela mulher a enfrentar a multidão?', 'Jesus parou por uma pessoa. O que isso diz sobre como ele vê você?'],
  },
  {
    yt: 'cFkndVBk8GQ',
    title: 'O rei Davi e o Salmo 77',
    ref: [19, 77],
    questions: ['O salmista lembrou o que Deus já fez. Que lembranças fortalecem a sua fé?', 'Como orar quando parece que Deus está em silêncio?'],
  },
];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const n = (x: number | undefined) => (x === undefined ? 'NULL' : String(Math.trunc(x)));

/** SQL que coloca no banco as cenas do catálogo (pula vídeo que já estiver lá). */
export function catalogInserts(at = 1792800000000): string[] {
  return SCENES_CATALOG.map(
    (s) =>
      `INSERT INTO scenes (youtube_id, start_s, end_s, title, episode, channel, bible_book, bible_chapter, bible_verse, bible_verse_end,
         pastor_text, questions, visibility, created_by, created_at, updated_at)
       SELECT ${q(s.yt)}, 0, NULL, ${q(s.title)}, NULL, 'The Chosen', ${n(s.ref[0])}, ${n(s.ref[1])}, ${n(s.ref[2])}, ${n(s.ref[3])},
         NULL, ${q(JSON.stringify(s.questions))}, 'public', NULL, ${at}, ${at}
       WHERE NOT EXISTS (SELECT 1 FROM scenes WHERE youtube_id = ${q(s.yt)})`,
  );
}
