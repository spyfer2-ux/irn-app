/**
 * Estrutura do banco de dados (D1).
 * O próprio app cria e atualiza as tabelas sozinho no primeiro acesso: ninguém precisa rodar comandos.
 * Para mudar a estrutura no futuro, acrescente uma NOVA posição no fim da lista MIGRATIONS (nunca edite as antigas).
 */
import { catalogInserts } from './scenesCatalog';
import { chosenSeedInserts } from './chosenSeed';

const V1 = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'membro',
    status TEXT NOT NULL DEFAULT 'pendente',
    phone TEXT,
    birthday TEXT,
    show_birthday INTEGER NOT NULL DEFAULT 1,
    neighborhood TEXT,
    baptized INTEGER,
    member_since TEXT,
    intro TEXT,
    notes TEXT,
    accepted_terms_at INTEGER,
    created_at INTEGER NOT NULL,
    approved_at INTEGER,
    approved_by INTEGER,
    last_seen_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER,
    updated_by INTEGER
  )`,

  // Arquivos (fotos, miniaturas, vídeos, comprovantes, capas, logo)
  `CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    storage TEXT NOT NULL,
    owner_id INTEGER,
    access TEXT NOT NULL DEFAULT 'members',
    status TEXT NOT NULL DEFAULT 'ready',
    used INTEGER NOT NULL DEFAULT 0,
    upload_id TEXT,
    parts INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    duration REAL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_media_status ON media(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_media_used ON media(used, created_at)`,
  `CREATE TABLE IF NOT EXISTS media_blobs (
    media_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (media_id, part)
  )`,
  `CREATE TABLE IF NOT EXISTS media_parts (
    media_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    etag TEXT NOT NULL,
    PRIMARY KEY (media_id, part)
  )`,

  // Biblioteca de fotos
  `CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    event_date TEXT,
    cover_thumb_id TEXT,
    photo_count INTEGER NOT NULL DEFAULT 0,
    members_can_upload INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER,
    media_id TEXT NOT NULL,
    thumb_id TEXT NOT NULL,
    caption TEXT,
    width INTEGER,
    height INTEGER,
    uploaded_by INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id, id DESC)`,

  // Vídeos (YouTube e enviados pelo app)
  `CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    youtube_id TEXT UNIQUE,
    media_id TEXT,
    poster_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    speaker TEXT,
    duration REAL,
    visibility TEXT NOT NULL DEFAULT 'public',
    auto INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER NOT NULL,
    created_by INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_videos_pub ON videos(hidden, published_at DESC)`,

  // Histórico de lives
  `CREATE TABLE IF NOT EXISTS lives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    title TEXT,
    youtube_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    started_by INTEGER,
    ended_by INTEGER
  )`,

  // Agenda
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER,
    location TEXT,
    cover_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    rsvp INTEGER NOT NULL DEFAULT 1,
    capacity INTEGER,
    canceled INTEGER NOT NULL DEFAULT 0,
    reminded INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at)`,
  `CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    guests INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  )`,

  // Mural de avisos
  `CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    image_id TEXT,
    link TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'members',
    expires_on TEXT,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // Palavra do dia
  `CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    title TEXT NOT NULL,
    reference TEXT,
    verse TEXT,
    body TEXT,
    author TEXT,
    image_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    notified INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_words_day ON words(day DESC)`,

  // Pedidos de oração
  `CREATE TABLE IF NOT EXISTS prayers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    body TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'igreja',
    anonymous INTEGER NOT NULL DEFAULT 0,
    answered INTEGER NOT NULL DEFAULT 0,
    answered_note TEXT,
    answered_at INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0,
    pray_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prayers_created ON prayers(hidden, id DESC)`,
  `CREATE TABLE IF NOT EXISTS prayer_marks (
    prayer_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (prayer_id, user_id)
  )`,

  // Testemunhos
  `CREATE TABLE IF NOT EXISTS testimonies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    body TEXT NOT NULL,
    image_id TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    amen_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    reviewed_by INTEGER,
    reviewed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS testimony_amens (
    testimony_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (testimony_id, user_id)
  )`,

  // Campanhas (ex.: 21 dias de oração, Quebra de maldições)
  `CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    daily_goal TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    cover_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'members',
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campaign_members (
    campaign_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (campaign_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS campaign_checkins (
    campaign_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (campaign_id, user_id, day)
  )`,

  // Células, Casa de Paz, Rede Jovem, Missões...
  `CREATE TABLE IF NOT EXISTS ministries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    leader_name TEXT,
    schedule_note TEXT,
    neighborhood TEXT,
    address TEXT,
    contact_phone TEXT,
    instagram TEXT,
    cover_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ministry_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ministry_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'novo',
    created_at INTEGER NOT NULL,
    UNIQUE (ministry_id, user_id)
  )`,

  // Dízimos e ofertas
  `CREATE TABLE IF NOT EXISTS contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    donor_name TEXT,
    type TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL,
    given_on TEXT NOT NULL,
    receipt_id TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'informado',
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    reviewed_by INTEGER,
    reviewed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contrib_date ON contributions(given_on)`,
  `CREATE INDEX IF NOT EXISTS idx_contrib_user ON contributions(user_id, given_on)`,

  // Cartão do visitante
  `CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    neighborhood TEXT,
    first_time INTEGER,
    how_found TEXT,
    prayer TEXT,
    wants_contact INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'novo',
    notes TEXT,
    created_at INTEGER NOT NULL
  )`,

  // Notificações no celular
  `CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_id INTEGER,
    topics TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    last_ok_at INTEGER,
    fail_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    audience TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    url TEXT,
    urgency TEXT NOT NULL DEFAULT 'normal',
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_done ON notifications(done, id)`,

  // Controles internos
  `CREATE TABLE IF NOT EXISTS marks (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  )`,

  // Ministérios iniciais (tudo pode ser editado pela liderança no app)
  `INSERT INTO ministries (type, name, description, schedule_note, instagram, sort, created_at, updated_at)
   SELECT 'ministerio', 'Rede Jovem', 'Encontro dos jovens da IRN para louvor, Palavra e comunhão.', 'Toda terça-feira', 'mprn_jovens', 1, 0, 0
   WHERE NOT EXISTS (SELECT 1 FROM ministries)`,
  `INSERT INTO ministries (type, name, description, schedule_note, sort, created_at, updated_at)
   SELECT 'celula', 'Células', 'Grupos que se reúnem nas casas durante a semana para oração, estudo da Palavra e comunhão.', 'Durante a semana', 2, 0, 0
   WHERE (SELECT COUNT(*) FROM ministries) = 1`,
  `INSERT INTO ministries (type, name, description, schedule_note, sort, created_at, updated_at)
   SELECT 'casa_de_paz', 'Casa de Paz', 'Lares que abrem as portas para receber vizinhos e amigos com a Palavra de Deus.', 'Durante a semana', 3, 0, 0
   WHERE (SELECT COUNT(*) FROM ministries) = 2`,
  `INSERT INTO ministries (type, name, description, instagram, sort, created_at, updated_at)
   SELECT 'missoes', 'Missões em Moçambique', 'A IRN também está na África, levando a Palavra a Moçambique.', 'mprn_am', 4, 0, 0
   WHERE (SELECT COUNT(*) FROM ministries) = 3`,
];

// V2: Mensagem do Pastor, pregações em áudio e mural de ajuda mútua.
const V2 = [
  `CREATE TABLE IF NOT EXISTS pastor_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    title TEXT NOT NULL,
    reference TEXT,
    verse TEXT,
    body TEXT,
    author TEXT,
    image_id TEXT,
    audio_id TEXT,
    media_url TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    notified INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pastor_day ON pastor_messages(day DESC)`,

  `CREATE TABLE IF NOT EXISTS sermons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    preacher TEXT,
    reference TEXT,
    description TEXT,
    preached_on TEXT NOT NULL,
    audio_id TEXT,
    audio_url TEXT,
    youtube_id TEXT,
    cover_id TEXT,
    duration REAL,
    visibility TEXT NOT NULL DEFAULT 'public',
    plays INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sermons_day ON sermons(preached_on DESC)`,

  `CREATE TABLE IF NOT EXISTS help_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    contact TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    review_note TEXT,
    reviewed_by INTEGER,
    reviewed_at INTEGER,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_help_status ON help_posts(status, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_help_user ON help_posts(user_id)`,
];

// V3: "Cenas que pregam" — trechos dos vídeos oficiais da série The Chosen (pelo player do YouTube,
// sem baixar nem recortar nada) ligados a uma passagem da Bíblia, com texto do pastor e perguntas.
const V3 = [
  `CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    youtube_id TEXT NOT NULL,
    start_s INTEGER NOT NULL DEFAULT 0,
    end_s INTEGER,
    title TEXT NOT NULL,
    episode TEXT,
    channel TEXT,
    bible_book INTEGER NOT NULL,
    bible_chapter INTEGER NOT NULL,
    bible_verse INTEGER,
    bible_verse_end INTEGER,
    pastor_text TEXT,
    questions TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'public',
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scenes_bible ON scenes(bible_book, bible_chapter)`,
];

// V4: já vem com as cenas oficiais de The Chosen (vídeos do canal oficial, com a passagem e perguntas).
const V4 = catalogInserts();

// V5: "Novidades de The Chosen" — Shorts e vídeos novos do canal oficial, lidos sozinhos do feed do YouTube.
const V5 = [
  `CREATE TABLE IF NOT EXISTS chosen_feed (
    youtube_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'short',
    ref TEXT,
    published_at INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chosen_feed ON chosen_feed(kind, hidden, published_at)`,
  ...chosenSeedInserts(),
];

export const MIGRATIONS: string[][] = [V1, V2, V3, V4, V5];

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = migrate(db).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function migrate(db: D1Database): Promise<void> {
  await db.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first<{ value: string }>();
  const current = row ? Number(row.value) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const stmts = MIGRATIONS[v].map((sql) => db.prepare(sql));
    stmts.push(
      db
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(String(v + 1)),
    );
    await db.batch(stmts);
  }
}
