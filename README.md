# App da IRN — Ministério Profético Restaurando as Nações

Aplicativo da igreja que instala no celular por link (Android e iPhone), sem loja e sem mensalidade.
Feito para a sede da Av. dos Nacionalistas, 530 — Jardim Tango, São Paulo/SP, com o Bispo Ronaldo Nogueira.

## O que o app faz

**Para todo mundo (sem login):** horários dos cultos com contagem regressiva e lembrete na agenda, endereço com mapa
(Google Maps, Waze e Uber), live do culto dentro do app, vídeos do canal do YouTube (importados sozinhos a cada hora), testemunhos publicados,
agenda de eventos, Palavra do dia, Bíblia com busca (Bíblia Livre e King James, funciona sem internet), cartão do
visitante e notificações no celular.

**Para membros (login com Google + aprovação da liderança):**

- Biblioteca de fotos com álbuns: qualquer membro aprovado envia várias fotos de uma vez (o app reduz o tamanho antes
  de enviar), vê em tela cheia, baixa e compartilha no WhatsApp.
- Dízimos e ofertas: PIX com QR Code e "copia e cola" (com valor e tipo: dízimo, oferta, missões…), dados da conta do
  Bispo Ronaldo e registro da contribuição com foto do comprovante. A tesouraria confere no painel.
- **Live pela câmera do celular:** qualquer membro aprovado conecta o YouTube da própria conta Google e transmite de
  dentro do app (não precisa da senha do canal da igreja nem de 50 inscritos). A live aparece em **Ao vivo** para todos,
  com notificação. Celular que não consegue transmitir pelo app usa o Larix Broadcaster (o app entrega a chave pronta).
- Pedidos de oração (mural da igreja ou só para a liderança, com opção anônima e botão "Orei"), testemunhos com
  foto e vídeo do YouTube (a liderança aprova antes de publicar; depois de publicado todo mundo vê, até quem
  não tem login), campanhas com diário (ex.: 21 dias de oração), confirmação de presença em
  eventos, células, Casa de Paz, Rede Jovem e Missões com "Quero participar", aniversariantes do mês.

**Equipe de mídia:** live por link do YouTube (quando já está ao vivo por outro canal ou programa), envio de vídeos
curtos, álbuns de fotos.

**Liderança e administração:** aprovação de cadastros, papéis (membro, mídia, liderança, administrador), avisos,
eventos, Palavra do dia agendada, campanhas, notificações para todos, visitantes, aniversariantes com botão de
WhatsApp, tesouraria (conferir contribuições, lançar ofertas em dinheiro, planilha), relatórios com gráficos,
histórico de ações e todas as configurações (logo, endereço, horários, PIX, transmissão).

**Automático (a cada 5 minutos):** lembrete antes de cada culto, lembrete dos eventos, notificação da Palavra do dia,
parabéns no aniversário (e aviso para a liderança), vídeos novos do YouTube, encerramento de live esquecida (inclusive
no YouTube, se o celular desligou no meio) e limpeza.

## Bíblia

A tela **Bíblia** (atalho no Início e em **Mais**) traz duas versões, com troca rápida no topo:

- **Bíblia Livre 2018 (BLIVRE)** — Copyright © Diego Santos, Mario Sérgio e Marco Teles, licença Creative Commons
  Atribuição 4.0. O crédito aparece na própria tela, como a licença pede.
- **King James 1769 (KJV)** — domínio público. Só os 66 livros; as palavras acrescentadas pelos tradutores (entre
  colchetes no original) aparecem em itálico.

Busca por palavra ou frase, sem diferença de acentos e maiúsculas (se a frase exata não existir, mostra os versículos
com todas as palavras), com filtro Antigo/Novo Testamento, ou por referência em português ou inglês: `jo 3:16`,
`john 3:16`, `sl 23`, `1 co 13:4-7`. Toque nos versículos para copiar ou mandar no WhatsApp. O tamanho da letra e a
última leitura ficam guardados no aparelho, e cada livro já aberto continua disponível sem internet.

Os textos ficam em `public/biblia/<versão>/<n>.json` (um arquivo por livro: 1 = Gênesis … 66 = Apocalipse). Para gerar
de novo a partir do eBible.org: `npm run biblia`.

## Quanto custa

| Item | Custo |
|---|---|
| Cloudflare Workers + banco D1 (plano grátis) | Grátis (100 mil acessos por dia) |
| Login com Google | Grátis |
| Notificações no celular | Grátis |
| Fotos sem R2 (ficam no banco) | Grátis, até cerca de 1.000–2.000 fotos (limite de 500 MB) |
| R2 para fotos e vídeos (opcional) | 10 GB grátis por mês, depois cerca de US$ 0,015 por GB |
| Live pelo YouTube (por link) | Grátis |
| Live pela câmera do app (Durable Objects, plano grátis) | Grátis: uma live de 3 horas usa cerca de 10% do limite diário |

## Publicar o app (passo a passo)

São quatro partes: GitHub (guarda o código), Cloudflare (onde o app roda), Google (login) e o primeiro acesso.

### 1. Colocar o código no GitHub

1. Em github.com, crie um repositório novo chamado `irn-app` (pode ser privado).
2. Na página do repositório vazio, clique em **uploading an existing file**.
3. Descompacte o arquivo `irn-app.zip` no computador e arraste **todo o conteúdo da pasta** (os arquivos e as pastas
   `src`, `worker`, `public`, `scripts`, `tests`) para a página. Clique em **Commit changes**.

### 2. Criar o app na Cloudflare

1. No painel da Cloudflare: **Workers & Pages → Create application → Import a repository**.
2. Conecte sua conta do GitHub e escolha o repositório `irn-app`.
3. O nome do projeto precisa ser **irn-app** (igual ao do arquivo `wrangler.jsonc`).
4. Comando de deploy: `npx wrangler deploy` (o próprio comando já monta as telas). Clique em **Save and Deploy**.
5. Na primeira publicação a Cloudflare cria sozinha o banco de dados. No fim aparece o endereço do app, algo como
   `https://irn-app.SEU-NOME.workers.dev`. Abra para conferir: a tela inicial já funciona.

A partir daqui, toda alteração salva no GitHub é publicada sozinha.

### 3. Ligar o login com Google

1. Abra o app e toque em **Entrar**: a tela mostra o "endereço de redirecionamento" exato. Copie.
2. Em console.cloud.google.com, crie um projeto chamado "App IRN".
3. Vá em **Google Auth Platform** (Tela de consentimento OAuth) → Começar: nome do app "App IRN", seu e-mail de
   suporte, público **Externo**. Não envie logo aqui (logo exige verificação do Google).
4. Em **Clientes → Criar cliente → Aplicativo da Web**. Em "URIs de redirecionamento autorizados", cole o endereço
   copiado no passo 1. Crie e copie o **ID do cliente** e a **chave secreta do cliente**.
5. Em **Público**, clique em **Publicar app** (sem isso, só contas de teste conseguem entrar).

### 4. Cadastrar as variáveis na Cloudflare

No Worker `irn-app` → **Settings → Variables and Secrets → Add**:

| Nome | Tipo | Valor |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Text | o ID do cliente (termina com `.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | Secret | a chave secreta do cliente |
| `ADMIN_EMAILS` | Text | os Gmails dos administradores, separados por vírgula |

Salve e clique em **Deploy** quando o painel pedir. Se `ADMIN_EMAILS` ficar vazio, **a primeira pessoa que entrar vira
administradora** — então entre você primeiro.

### 5. Primeiro acesso e configuração

1. Entre com o seu Google. Você cai direto como administrador.
2. Em **Mais → Configurações do app**:
   - **Igreja:** envie a logo oficial (vira o ícone do app), confira endereço, redes e o texto "Sobre a igreja".
   - **Horários:** confira os cultos (já vêm Domingo 18h30, Quarta 20h e Sexta 20h).
   - **Dízimos:** cadastre a chave PIX e a conta. Antes de divulgar, pague o código de teste de R$ 1,00 que aparece na
     tela e confira se caiu na conta certa.
3. Peça para a liderança entrar e mude o papel de cada um em **Membros**.

### 6. Divulgar para a igreja

Mande o link no grupo de WhatsApp e no Instagram (o link já gera uma prévia bonita). No celular:

- **Android (Chrome):** abre o link → aparece "Instalar o app" (ou menu ⋮ → Instalar app).
- **iPhone (Safari):** Compartilhar → Adicionar à Tela de Início. Depois de instalado, abra pelo ícone e ative as
  notificações em Perfil.

### Opcional: vídeos pelo app (R2)

1. Cloudflare → **Storage & databases → R2** → ativar (pede cartão, mas os primeiros 10 GB por mês são grátis).
2. No GitHub, abra `wrangler.jsonc`, apague as duas barras `//` antes da linha `"r2_buckets"` e salve.
3. A Cloudflare publica de novo sozinha e o botão "Enviar do celular" em Vídeos é liberado. As fotos antigas continuam
   funcionando.

### Lives pela câmera do app (YouTube de cada pessoa)

Qualquer membro aprovado faz live em **Ao vivo → Transmitir pelo celular**. A live é criada no canal do YouTube da
conta Google da própria pessoa, pela API do YouTube — por isso não depende da senha do canal da igreja e **não tem o
mínimo de 50 inscritos** (essa regra é só do botão "Transmitir" do aplicativo do YouTube). O celular codifica o vídeo
(H.264) e o áudio (AAC) e manda pelo protocolo RTMP até a "ponte" do app na Cloudflare (um Durable Object,
`worker/relay.ts`), que repassa para o servidor do YouTube com criptografia (RTMPS). Quando o vídeo chega, a live
aparece em **Ao vivo** para todos e sai a notificação. Se a internet oscilar, a qualidade baixa sozinha; se cair, o app
reconecta na mesma live.

**Ligar (uma vez, no Google Cloud do login — o mesmo projeto do passo 3):**

1. console.cloud.google.com → **APIs e serviços → Biblioteca** → procure **YouTube Data API v3** → **Ativar**.
2. **Google Auth Platform → Acesso a dados → Adicionar ou remover escopos** → marque
   `https://www.googleapis.com/auth/youtube` ("Gerenciar sua conta do YouTube") → Atualizar → Salvar.
   O app não é verificado pelo Google: na primeira vez, quem conectar o YouTube vê "O Google não verificou este app" e
   toca em **Avançado → Acessar**. Funciona para até 100 pessoas conectarem o YouTube.
3. A ponte (Durable Object `LiveRelay`) já vem no `wrangler.jsonc` e é criada sozinha na próxima publicação.

**Cada pessoa que for transmitir (uma vez):** precisa ter um canal no YouTube e as lives ativadas — em
youtube.com/verify confirmar o telefone e no YouTube Studio → Criar → Transmitir ao vivo aceitar a ativação (na
primeira vez o YouTube libera em até 24 horas). O app mostra esse passo a passo se faltar.

**Celular que não transmite pelo app** (iPhone com iOS anterior ao 26, por exemplo): na mesma tela, escolha
**Outro app (Larix)**. O app cria a live e mostra a chave, com um botão que já configura o Larix Broadcaster (grátis);
quando o vídeo chega ao YouTube, a live aparece no app do mesmo jeito.

**Live por link (equipe de mídia):** se alguém já está ao vivo no YouTube por outro canal ou programa, em **Ao vivo →
Já está ao vivo no YouTube por outro canal? Colar o link**, o app mostra o vídeo para todos e manda a notificação.

### Opcional: endereço próprio

Se a igreja tiver um domínio (ex.: `app.suaigreja.com.br`) na Cloudflare: Worker → Settings → Domains & Routes → Add
custom domain. Depois, acrescente o novo endereço de redirecionamento no Google.

## Problemas comuns

- **"Login com Google ainda não configurado":** faltam as variáveis do passo 4 (ou faltou o Deploy depois de salvar).
- **Erro do Google "redirect_uri_mismatch":** o endereço cadastrado no Google precisa ser exatamente o que aparece na
  tela Entrar (com `https://` e `/api/auth/google/callback`).
- **Ninguém além de mim consegue entrar:** publique o app no Google (passo 3.5).
- **A primeira publicação falhou falando do banco D1:** crie um banco D1 chamado `irn-app` no painel e acrescente no
  `wrangler.jsonc`: `"d1_databases": [{ "binding": "DB", "database_name": "irn-app", "database_id": "<id do banco>" }]`.
- **Notificação não chega no iPhone:** só funciona com o app instalado na Tela de Início (iOS 16.4 ou mais novo).
- **"A API do YouTube ainda não foi ativada":** falta o passo 1 de "Lives pela câmera do app" (YouTube Data API v3).
- **"Sua conta do YouTube ainda não está liberada para fazer lives":** a pessoa precisa ativar a live no YouTube
  (youtube.com/verify e YouTube Studio → Criar → Transmitir ao vivo); na primeira vez leva até 24 horas.
- **"Faltou marcar a permissão do YouTube":** na tela do Google, a caixinha do YouTube precisa ficar marcada.

## Estrutura do projeto

```
irn-app/
├── README.md                  este guia (publicação, estrutura e manutenção)
├── wrangler.jsonc             configuração da Cloudflare: nome do app, banco D1, R2 (opcional), tarefas a cada 5 min
├── package.json               bibliotecas e comandos (npm run dev, build, deploy, test, e2e, icons, biblia)
├── package-lock.json          versões exatas das bibliotecas
├── index.html                 página base do app (título, ícones, prévia para WhatsApp)
├── vite.config.ts             montagem das telas
├── tsconfig*.json             verificação de tipos (telas e servidor)
│
├── public/                    arquivos servidos como estão
│   ├── _headers               cabeçalhos de segurança (CSP) e cache
│   ├── live-pcm.js            captura o som do microfone para a live pela câmera do app
│   ├── sw.js                  service worker: funciona sem internet, guarda fotos e livros da Bíblia e recebe notificações
│   ├── biblia/                textos da Bíblia: livre/ e kjv/, um arquivo por livro (1.json = Gênesis … 66.json = Apocalipse)
│   └── icons/                 ícones padrão do app, logo provisória e imagem de compartilhamento
│
├── src/                       TELAS DO APP (React)
│   ├── main.tsx               endereços de cada tela (rotas)
│   ├── styles.css             visual: cores da IRN, fontes, modo escuro, gráficos
│   ├── components/
│   │   ├── Layout.tsx         barra de navegação de baixo e estado da live
│   │   ├── ui.tsx             botões, campos, janelas, avisos, "só para membros"
│   │   ├── cards.tsx          cartões de vídeo, evento, aviso e próximo culto
│   │   └── charts.tsx         gráficos dos relatórios (com versão em tabela)
│   ├── lib/
│   │   ├── api.ts             conversa com o servidor
│   │   ├── bible.ts           Bíblia: livros, versões, busca sem acentos e referências ("jo 3:16")
│   │   ├── session.tsx        quem está logado e qual o papel
│   │   ├── format.ts          datas no horário de São Paulo, reais, textos
│   │   ├── pix.ts             código PIX copia e cola (padrão do Banco Central)
│   │   ├── image.ts           reduz fotos no celular antes de enviar
│   │   ├── upload.ts          envio de fotos e de vídeos em partes
│   │   ├── push.ts            ativar e escolher notificações
│   │   ├── ics.ts             "Adicionar à agenda" e compartilhar
│   │   ├── rtmp.ts            protocolo RTMP (o mesmo do OBS/Larix) para mandar a live ao YouTube
│   │   ├── livecast.ts        live pela câmera: codifica vídeo H.264 e áudio AAC no celular e envia
│   │   └── types.ts           formatos dos dados
│   └── pages/
│       ├── Home.tsx           Início
│       ├── Live.tsx           Ao vivo (player, "Transmitir pelo celular", live por link) e histórico de lives
│       ├── Broadcast.tsx      Transmitir: conectar o YouTube, câmera, começar/encerrar, modo Larix
│       ├── Videos.tsx         Vídeos (YouTube e enviados pelo app)
│       ├── Photos.tsx         Biblioteca de fotos, álbuns, envio e visualizador
│       ├── Agenda.tsx         Agenda, evento e confirmação de presença
│       ├── Content.tsx        Avisos e Palavra do dia
│       ├── Bible.tsx          Bíblia: livros, capítulos, busca, tamanho da letra, copiar e WhatsApp (+ Bible.css)
│       ├── Care.tsx           Pedidos de oração e testemunhos
│       ├── Groups.tsx         Campanhas e células/grupos
│       ├── Giving.tsx         Dízimos e ofertas
│       ├── Church.tsx         A igreja, cartão do visitante e privacidade
│       ├── Account.tsx        Entrar, aguardando aprovação, perfil, notificações, menu Mais, aniversariantes
│       └── Admin.tsx          Painel, membros, visitantes, notificações, tesouraria, relatórios, configurações
│
├── worker/                    SERVIDOR (Cloudflare Worker)
│   ├── index.ts               entrada: segurança, sessão, rotas e tarefas automáticas
│   ├── schema.ts              tabelas do banco (o app cria e atualiza sozinho)
│   ├── auth.ts                login com Google, sessões, perfil, exclusão de conta e conexão do YouTube
│   ├── youtube.ts             conta do YouTube de cada pessoa (tokens criptografados) e API de lives do YouTube
│   ├── relay.ts               ponte da live (Durable Object): WebSocket do celular → servidor RTMPS do YouTube
│   ├── push.ts                notificações: chaves, criptografia e fila de envio
│   ├── storage.ts             fotos e vídeos no R2 (ou no D1 sem R2)
│   ├── settings.ts            dados padrão: igreja, horários, PIX, lembretes
│   ├── cron.ts                lembretes, Palavra do dia, aniversários, YouTube, limpeza
│   ├── util.ts                validações, permissões e datas de São Paulo
│   ├── types.ts               formatos do servidor
│   └── routes/
│       ├── app.ts             dados iniciais, tela de Início, logo e ícones
│       ├── photos.ts          álbuns e fotos
│       ├── videos.ts          vídeos e importação do canal do YouTube
│       ├── live.ts            lives: pela câmera do app (criar no YouTube, conferir, encerrar, ponte) e por link
│       ├── community.ts       agenda, avisos, Palavra do dia, campanhas, células e grupos
│       ├── care.ts            oração, testemunhos, cartão do visitante, aniversariantes
│       ├── giving.ts          dízimos e ofertas, tesouraria e planilha
│       └── admin.ts           membros, configurações, notificações, relatórios, histórico
│
├── scripts/make-icons.mjs     gera os ícones padrão do app
├── scripts/make-bible.mjs     gera public/biblia/ com os textos do eBible.org (npm run biblia)
└── tests/                     testes automáticos
    ├── unit.test.ts           criptografia das notificações, login, PIX, valores, datas
    ├── bible.test.ts          Bíblia: referências, busca, compartilhar e arquivos gerados
    ├── rtmp.test.ts           live: AMF0, chunks, handshake e publicação num servidor RTMP local (FFmpeg)
    ├── live-e2e.mjs           live pela câmera de ponta a ponta (celular simulado → ponte → servidor RTMP local)
    ├── e2e.mjs                o app inteiro num celular simulado (visitante, membro, admin, mídia)
    ├── e2e-r2.mjs             fotos e vídeos com o R2 ligado
    ├── fake-google.mjs        "Google de teste" (login e API de lives do YouTube) para os testes
    ├── run-e2e.sh             sobe o app local e roda os testes
    ├── stop-servers.py        desliga os servidores de teste
    ├── wrangler.r2.jsonc      configuração de teste com R2
    ├── dev.vars.example       variáveis do ambiente de teste
    └── fixtures/              fotos e comprovante de exemplo
```

### Telas do app

| Endereço | Tela | Quem vê |
|---|---|---|
| `/` | Início: live, próximo culto, atalhos, Palavra, avisos, eventos, fotos, vídeos, aniversariantes | Todos |
| `/ao-vivo` | Ao vivo (player, "Transmitir pelo celular" e live por link) | Todos |
| `/ao-vivo/transmitir` | Transmitir pela câmera do celular no YouTube da própria conta | Membros |
| `/videos`, `/videos/:id` | Vídeos (YouTube e enviados pelo app) | Todos (vídeos "só membros" para membros) |
| `/fotos`, `/fotos/album/:id` | Biblioteca de fotos | Membros |
| `/agenda`, `/agenda/:id` | Agenda e evento | Todos |
| `/avisos` | Mural de avisos | Todos (avisos "só membros" para membros) |
| `/palavra`, `/palavra/:id` | Palavra do dia | Todos |
| `/biblia`, `/biblia/:livro/:cap` | Bíblia (Bíblia Livre e King James): livros, capítulos, busca, copiar e compartilhar | Todos |
| `/oracao` | Pedidos de oração | Quem tem login |
| `/testemunhos` | Testemunhos (com vídeo do YouTube) | Todos; só membro conta o seu |
| `/campanhas`, `/campanhas/:id` | Campanhas com diário | Membros |
| `/grupos` | Células, Casa de Paz, Rede Jovem, Missões | Todos |
| `/dizimos` | Dízimos e ofertas | Membros (ou todos, se o admin liberar) |
| `/igreja`, `/visitante`, `/privacidade` | A igreja, cartão do visitante, privacidade | Todos |
| `/entrar`, `/aguardando`, `/perfil`, `/notificacoes`, `/mais`, `/aniversariantes` | Conta e menus | — |
| `/admin/...` | Painel, membros, visitantes, pedidos, notificar, contribuições, relatórios, configurações, histórico | Liderança e admin |

### Papéis

| Papel | Pode |
|---|---|
| Aguardando aprovação | Ver o que é público, completar o cadastro e pedir oração para a liderança |
| Membro | Fotos, oração, testemunhos, campanhas, presença em eventos, dízimos, grupos, live pela câmera do app |
| Equipe de mídia | Tudo do membro + live por link, encerrar qualquer live, envio de vídeos, álbuns, moderar fotos |
| Liderança | Tudo da mídia + avisos, eventos, Palavra, campanhas, grupos, testemunhos, visitantes, notificações |
| Administrador | Tudo + aprovar pessoas, mudar papéis, tesouraria, configurações e histórico |

### Banco de dados (D1)

`users` (pessoas e papéis) · `sessions` (logins) · `settings` (configurações) · `media`, `media_blobs`, `media_parts`
(arquivos) · `albums`, `photos` · `videos`, `lives`, `live_sessions` (lives criadas pelo app no YouTube), `yt_accounts` (YouTube conectado, tokens criptografados) · `events`, `event_rsvps` · `notices` · `words` · `prayers`,
`prayer_marks` · `testimonies`, `testimony_amens` · `campaigns`, `campaign_members`, `campaign_checkins` ·
`ministries`, `ministry_requests` · `contributions` · `visitors` · `push_subs`, `notifications` · `marks`, `rate`,
`audit`, `meta` (controles internos).

### Rotas do servidor (todas começam com `/api`)

`/boot`, `/home`, `/brand/*`, `/manifest.webmanifest` · `/auth/google/*`, `/auth/logout` · `/me` · `/push/*` ·
`/media/*` · `/fotos/*` · `/videos/*` · `/live/*` · `/eventos/*` · `/avisos/*` · `/palavra/*` · `/campanhas/*` ·
`/ministerios/*` · `/oracao/*` · `/testemunhos/*` · `/visitantes/*` · `/aniversariantes` · `/dizimos`,
`/contribuicoes/*` · `/admin/*`.

## Para quem programa

- Telas: React + Vite em `src/`. Servidor: Cloudflare Worker (Hono) em `worker/`. Banco D1 criado e atualizado pelo
  próprio app (`worker/schema.ts`). Arquivos no R2 ou, sem R2, no D1 em pedaços.
- Rodar local: `npm install`, copie `tests/dev.vars.example` para `.dev.vars` e rode `npm run dev`
  (`http://localhost:8787`, com login de teste).
- Testes: `npm test` (criptografia das notificações, login, PIX, datas e Bíblia), `npm run e2e` (usa o app inteiro num celular
  simulado: visitante, membro, administrador e mídia) e
  `WRANGLER_ARGS="-c tests/wrangler.r2.jsonc --persist-to .wrangler/state-r2" E2E=tests/e2e-r2.mjs npm run e2e`
  (fotos e vídeos no R2).
- Segurança: sessão em cookie HttpOnly, proteção contra CSRF, conteúdo de membros só para aprovados, comprovantes só
  para o dono e a administração, limite de tentativas, cabeçalhos de segurança (CSP) em `public/_headers`.
