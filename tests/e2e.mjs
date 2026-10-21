// Teste de ponta a ponta: abre o app num celular simulado e usa como visitante, membro, administrador e equipe de mídia.
// Pré-requisito: `npm run build` e `npx wrangler dev` rodando em http://127.0.0.1:8787 com DEV_LOGIN=1.
// Uso: node tests/e2e.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
for (const p of [process.cwd(), '/opt/npm-tools']) {
  try {
    playwright = require(require.resolve('playwright', { paths: [p, `${p}/node_modules`] }));
    break;
  } catch {
    /* próximo */
  }
}
const { chromium } = playwright;
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = resolve(process.cwd(), 'tests/.out');
const FIX = resolve(process.cwd(), 'tests/fixtures');
mkdirSync(OUT, { recursive: true });

const errors = [];
const failures = [];
let step = 0;
const log = (...a) => console.log(`[${String(++step).padStart(2, '0')}]`, ...a);

const pages = [];
async function check(name, fn) {
  try {
    await fn();
    log('ok   ', name);
  } catch (e) {
    failures.push(`${name}: ${e.message.split('\n')[0]}`);
    log('FALHA', name, '-', e.message.split('\n')[0]);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: resolve(OUT, `falha-${step}-${i}.png`) }).catch(() => undefined);
  }
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function newPhone(name, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    ...opts,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // A rede do ambiente de teste não acessa YouTube/Google Maps/Cloudflare Stream de verdade.
    if (/youtube|ytimg|google\.com|cloudflarestream|ERR_|net::|Failed to load resource|CSP|frame|permissions policy/i.test(t)) return;
    errors.push(`[${name}] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] erro na página: ${e.message}`));
  page.setDefaultTimeout(12000);
  pages.push(page);
  return page;
}

async function devLogin(page, email, name, role) {
  await page.goto(`${BASE}/privacidade`);
  const r = await page.request.post(`${BASE}/api/auth/dev`, {
    headers: { 'x-irn': '1', 'content-type': 'application/json' },
    data: { email, name, ...(role ? { role, status: 'aprovado' } : {}) },
  });
  if (!r.ok()) throw new Error(`login de teste falhou: ${r.status()}`);
}

const shot = (page, file, full = false) => page.screenshot({ path: resolve(OUT, file), fullPage: full });
const toast = (page, text) => page.locator('.toast', { hasText: text }).first().waitFor();
const dialog = (page) => page.getByRole('dialog').last();
const nextWeek = new Date(Date.now() + 7 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// dispara as tarefas automáticas (importa os vídeos do YouTube etc.)
await fetch(`${BASE}/cdn-cgi/local/scheduled?cron=*/5+*+*+*+*`).catch(() => undefined);

// O primeiro login vira administrador (quando ADMIN_EMAILS está vazio): entra o admin primeiro.
const a = await newPhone('admin');
await check('admin: primeiro login vira administrador', async () => {
  await devLogin(a, 'bispo@irn.test', 'Ronaldo Nogueira');
  await a.goto(BASE + '/mais');
  await a.getByText('Painel da liderança').waitFor();
});

// ======================= VISITANTE =======================
const v = await newPhone('visitante');
await check('visitante: tela inicial com nome da igreja e próximo culto', async () => {
  await v.goto(BASE + '/');
  await v.getByRole('heading', { name: 'Ministério Profético Restaurando as Nações' }).waitFor();
  await v.getByText('Próximo culto').waitFor();
  await v.waitForTimeout(600);
  await shot(v, '01-inicio-visitante.png');
  await shot(v, '01b-inicio-visitante-inteiro.png', true);
});
await check('visitante: página da igreja com endereço e horários', async () => {
  await v.goto(BASE + '/igreja');
  await v.getByText('Av. dos Nacionalistas, 530').first().waitFor();
  await v.getByText('Culto de Domingo').waitFor();
  await shot(v, '02-igreja.png', true);
});
await check('visitante: ao vivo sem transmissão', async () => {
  await v.goto(BASE + '/ao-vivo');
  await v.getByText('Nenhuma transmissão agora').waitFor();
});
await check('visitante: vídeos importados do canal do YouTube', async () => {
  await v.goto(BASE + '/videos');
  await v.locator('.video-card').first().waitFor();
  await shot(v, '03-videos.png');
});
const addVideo = async (page, url, title) => {
  await page.goto(BASE + '/videos');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const d = dialog(page);
  await d.getByLabel(/Link do vídeo/).fill(url);
  await d.getByLabel(/Título/).fill(title);
  await d.getByRole('button', { name: 'Adicionar' }).click();
  await page.waitForURL(/\/videos\/\d+$/);
};

await check('admin: publica vídeo em pé pelo link de Short do YouTube', async () => {
  await addVideo(a, 'https://www.youtube.com/shorts/aBcDeFgHiJk', 'Louvor da Rede Jovem');
  // Link de Short entra marcado como vídeo em pé, e o player fica na vertical.
  await a.locator('.player.vertical iframe').waitFor();
});
await check('vídeo novo aparece em destaque e com o selo "Novo"', async () => {
  await addVideo(a, 'https://youtu.be/XyZ12345678', 'Coral da igreja');
  await a.goto(BASE + '/videos');
  await a.locator('.video-highlight').getByText('Novo vídeo publicado').waitFor();
  await a.locator('.video-highlight').getByText('Coral da igreja').waitFor();
  // O outro vídeo de hoje fica na grade com o selo; os antigos do canal, não.
  await a.locator('.video-grid .thumb .novo').first().waitFor();
  if (await a.locator('.video-grid .thumb .novo').count() !== 1) throw new Error('selo "Novo" em vídeo que não é de hoje');
  await v.goto(BASE + '/');
  await v.locator('.video-highlight').getByText('Novo vídeo publicado').waitFor();
  if (!(await v.locator('.thumb .novo').count())) throw new Error('o selo "Novo" não apareceu na capa');
  await shot(a, '03b-videos-destaque.png', true);
  await shot(v, '03c-inicio-destaque.png', true);
});
await check('visitante: dados de dízimo só para membros', async () => {
  await v.goto(BASE + '/dizimos');
  await v.getByText('área dos membros', { exact: false }).first().waitFor();
});
await check('visitante: fotos pedem login', async () => {
  await v.goto(BASE + '/fotos');
  await v.getByText('Área dos membros').waitFor();
});
await check('visitante: cartão do visitante', async () => {
  await v.goto(BASE + '/visitante');
  await v.getByLabel('Seu nome').fill('Joana Visitante');
  await v.getByLabel('WhatsApp (opcional)').fill('(11) 98888-7777');
  await v.getByLabel('Como conheceu a igreja? (opcional)').fill('Convite de uma amiga');
  await v.getByRole('switch', { name: /Autorizo/ }).check();
  await shot(v, '04-cartao-visitante.png');
  await v.getByRole('button', { name: 'Enviar cartão' }).click();
  await v.getByText('Que alegria ter você aqui!').waitFor();
});

// ======================= MEMBRO (ainda pendente) =======================
const m = await newPhone('membro');
await check('membro: cadastro novo fica aguardando aprovação', async () => {
  await devLogin(m, 'maria@irn.test', 'Maria Souza');
  await m.goto(BASE + '/aguardando');
  await m.getByText('Aguardando aprovação').waitFor();
  await m.getByLabel('Celular / WhatsApp').fill('(11) 97777-6666');
  await m.getByLabel('Aniversário', { exact: true }).fill(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(/^\d{4}/, '1990'));
  await m.getByLabel('Bairro').fill('Penha');
  await m.getByRole('switch', { name: /política de privacidade/ }).check();
  await m.getByRole('button', { name: 'Salvar' }).click();
  await toast(m, 'Dados salvos.');
  await shot(m, '05-aguardando-aprovacao.png');
});
await check('membro pendente: não vê a biblioteca de fotos', async () => {
  await m.goto(BASE + '/fotos');
  await m.getByText('Cadastro em análise').waitFor();
});

// ======================= ADMINISTRADOR =======================
await check('admin: aprova o cadastro da Maria', async () => {
  await a.goto(BASE + '/admin/membros?status=pendente');
  await a.getByText('Maria Souza').waitFor();
  await shot(a, '06-admin-aprovacoes.png');
  await a.getByRole('button', { name: 'Aprovar', exact: true }).first().click();
  await toast(a, 'foi aprovado');
});
await check('admin: cadastra PIX e conta para dízimos (dados de teste)', async () => {
  await a.goto(BASE + '/admin/config?aba=dizimos');
  await a.getByLabel('Tipo de chave').selectOption('email');
  await a.getByLabel('Chave PIX').fill('pix@exemplo.com');
  await a.getByLabel('Nome no PIX (até 25 letras)').fill('RONALDO NOGUEIRA');
  await a.getByLabel('Cidade (até 15 letras)').fill('SAO PAULO');
  await a.getByLabel('Banco', { exact: true }).fill('Banco Exemplo');
  await a.getByLabel('Agência').fill('0001');
  await a.getByLabel('Conta', { exact: true }).fill('12345-6');
  await a.locator('.qr svg').waitFor();
  await a.getByRole('button', { name: 'Salvar dados de contribuição' }).click();
  await toast(a, 'Configuração salva.');
  await shot(a, '07-admin-config-dizimos.png');
});
await check('admin: texto "Sobre a igreja"', async () => {
  await a.goto(BASE + '/admin/config?aba=igreja');
  await a.getByLabel('Sobre a igreja').fill('Uma igreja que crê na restauração de vidas, famílias e nações pelo poder de Deus.');
  await a.getByRole('button', { name: 'Salvar dados da igreja' }).click();
  await toast(a, 'Configuração salva.');
});
await check('admin: cria álbum de fotos', async () => {
  await a.goto(BASE + '/fotos');
  await a.getByRole('button', { name: 'Novo álbum' }).click();
  await dialog(a).getByLabel('Nome do álbum').fill('Culto de Domingo');
  await dialog(a).getByRole('button', { name: 'Salvar' }).click();
  await toast(a, 'Álbum criado.');
});
await check('admin: cria evento com notificação', async () => {
  await a.goto(BASE + '/agenda');
  await a.getByRole('button', { name: 'Evento' }).click();
  const d = dialog(a);
  await d.getByLabel('Nome do evento').fill('Conferência Restaurando Nações');
  await d.getByLabel('Tipo').selectOption('Conferência');
  await d.getByLabel('Data', { exact: true }).fill(nextWeek);
  await d.getByLabel('Horário', { exact: true }).fill('19:30');
  await d.getByLabel('Descrição').fill('Três noites de culto, Palavra e oração. Traga sua família!');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast(a, 'Evento criado!');
});
await check('admin: publica aviso fixado', async () => {
  await a.goto(BASE + '/avisos');
  await a.getByRole('button', { name: 'Aviso' }).click();
  const d = dialog(a);
  await d.getByLabel('Título').fill('Ensaio do louvor no sábado');
  await d.getByLabel('Texto').fill('Ensaio às 15h na sede. Músicos e cantores, não faltem!');
  await d.getByRole('switch', { name: 'Fixar no topo' }).check();
  await d.getByRole('button', { name: 'Publicar' }).click();
  await toast(a, 'Aviso publicado.');
});
await check('admin: publica a Palavra do dia', async () => {
  await a.goto(BASE + '/palavra');
  await a.getByRole('button', { name: 'Nova' }).click();
  const d = dialog(a);
  await d.getByLabel('Título').fill('Deus restaura');
  await d.getByLabel('Referência bíblica').fill('Joel 2.25');
  await d.getByLabel('Versículo (texto)').fill('O Senhor promete restituir os anos que foram perdidos.');
  await d.getByLabel('Mensagem').fill('Não importa o que foi perdido: Deus é especialista em restaurar.');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast(a, 'Palavra salva.');
});
await check('admin: cria campanha', async () => {
  await a.goto(BASE + '/campanhas');
  await a.getByRole('button', { name: 'Campanha' }).click();
  const d = dialog(a);
  await d.getByLabel('Nome').fill('21 dias de oração');
  await d.getByLabel('Propósito de cada dia').fill('Oração às 6h e leitura de um Salmo');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast(a, 'Campanha salva.');
});
await check('mídia: avisa que está ao vivo pelo YouTube', async () => {
  await a.goto(BASE + '/ao-vivo');
  await a.getByRole('tab', { name: 'Pelo YouTube' }).click();
  await a.getByLabel('Título').fill('Culto de Sexta');
  await a.getByLabel('Link da live no YouTube (opcional)').fill('https://youtu.be/lkpfxNXXI3I');
  await a.getByRole('button', { name: 'Estamos ao vivo' }).click();
  await toast(a, 'Live no ar no app!');
  await a.locator('.player iframe').waitFor();
  await shot(a, '08-ao-vivo-controle.png');
});

// ======================= MEMBRO APROVADO =======================
await check('membro: início com saudação e aviso de live', async () => {
  await m.goto(BASE + '/');
  await m.getByRole('heading', { name: /Maria!/ }).waitFor();
  await m.getByText('Toque para assistir agora').waitFor();
  await m.waitForTimeout(500);
  await shot(m, '09-inicio-membro.png');
  await shot(m, '09b-inicio-membro-inteiro.png', true);
});
await check('membro: envia 6 fotos para o álbum', async () => {
  await m.goto(BASE + '/fotos');
  await m.getByRole('button', { name: 'Enviar', exact: true }).click();
  const d = dialog(m);
  await m.locator('input[type=file][multiple]').setInputFiles([1, 2, 3, 4, 5, 6].map((i) => resolve(FIX, `foto${i}.jpg`)));
  await d.getByLabel('Álbum').selectOption({ label: 'Culto de Domingo' });
  await d.getByRole('switch', { name: /concordam/ }).check();
  await shot(m, '10-enviar-fotos.png');
  await d.getByRole('button', { name: 'Enviar 6 fotos' }).click();
  await d.getByRole('button', { name: /Pronto! 6 fotos enviadas/ }).waitFor({ timeout: 40000 });
  await d.getByRole('button', { name: /Pronto!/ }).click();
  await m.locator('.photo-grid button').nth(5).waitFor();
  await m.waitForTimeout(800);
  await shot(m, '11-biblioteca-fotos.png');
});
await check('membro: abre a foto e passa para a próxima', async () => {
  await m.locator('.photo-grid button').first().click();
  await m.locator('.viewer').waitFor();
  await m.getByText('1 de 6').waitFor();
  await m.keyboard.press('ArrowRight');
  await m.getByText('2 de 6').waitFor();
  await m.waitForTimeout(700);
  await shot(m, '12-foto-aberta.png');
  await m.keyboard.press('Escape');
});
await check('membro: álbum mostra as 6 fotos e a capa', async () => {
  await m.goto(BASE + '/fotos');
  await m.getByText('6 fotos').first().waitFor();
});
await check('membro: pede oração e alguém ora', async () => {
  await m.goto(BASE + '/oracao');
  await m.getByRole('button', { name: 'Pedir' }).click();
  await dialog(m).getByLabel('Pelo que podemos orar?').fill('Pela saúde da minha mãe, que vai fazer uma cirurgia.');
  await dialog(m).getByRole('button', { name: 'Enviar pedido' }).click();
  await toast(m, 'Pedido enviado');
  await m.getByText('Pela saúde da minha mãe').waitFor();
  await a.goto(BASE + '/oracao');
  await a.getByRole('button', { name: /Orei por isso/ }).first().click();
  await a.getByRole('button', { name: /Orei · 1/ }).waitFor();
  await shot(a, '13-mural-oracao.png');
});
await check('membro: confirma presença no evento', async () => {
  await m.goto(BASE + '/agenda');
  await m.getByText('Conferência Restaurando Nações').click();
  await m.getByRole('button', { name: 'Vou', exact: true }).click();
  await toast(m, 'Presença confirmada!');
  await m.getByText('1 confirmado').waitFor();
  await shot(m, '14-evento.png');
});
await check('membro: dízimos com QR Code PIX e copia e cola', async () => {
  await m.goto(BASE + '/dizimos');
  await m.locator('.qr svg').waitFor();
  await m.getByLabel('Valor (opcional)').fill('150,00');
  await m.getByText('O código já vai com').waitFor();
  const code = await m.locator('.pix-code').textContent();
  if (!code?.includes('pix@exemplo.com') || !code.includes('5406150.00')) throw new Error(`código PIX inesperado: ${code}`);
  await m.getByRole('button', { name: 'Copiar código PIX (copia e cola)' }).click();
  await toast(m, 'Código PIX copiado!');
  await shot(m, '15-dizimos.png');
  await shot(m, '15b-dizimos-inteiro.png', true);
});
await check('membro: registra contribuição com comprovante', async () => {
  await m.getByRole('button', { name: 'Registrar' }).first().click();
  const d = dialog(m);
  await d.locator('input[type=file]').setInputFiles(resolve(FIX, 'comprovante.jpg'));
  await d.getByText('Comprovante anexado').waitFor();
  await d.getByRole('button', { name: 'Registrar' }).click();
  await toast(m, 'Registrado!');
  await m.getByText('Informado').first().waitFor();
});
await check('membro: participa da campanha e marca o dia', async () => {
  await m.goto(BASE + '/campanhas');
  await m.getByText('21 dias de oração').click();
  await m.getByRole('button', { name: 'Quero participar' }).click();
  await m.getByRole('button', { name: 'Marcar o dia de hoje' }).click();
  await m.getByRole('button', { name: 'Hoje cumprido!' }).waitFor();
  await shot(m, '16-campanha.png');
});
await check('membro: pede para participar de uma célula', async () => {
  await m.goto(BASE + '/grupos');
  await m.getByRole('button', { name: 'Quero participar' }).first().click();
  await dialog(m).getByRole('button', { name: 'Enviar pedido' }).click();
  await toast(m, 'Pedido enviado!');
  await shot(m, '17-grupos.png');
});
await check('membro: envia testemunho com vídeo do Drive e a liderança publica', async () => {
  await m.goto(BASE + '/testemunhos');
  await m.getByRole('button', { name: 'Contar' }).click();
  await dialog(m).getByLabel('Título (opcional)').fill('Deus abriu uma porta de emprego');
  await dialog(m).getByLabel('Seu testemunho').fill('Depois de meses procurando, fui contratada nesta semana. Glória a Deus!');
  await dialog(m).getByLabel(/Vídeo do Google Drive/).fill('https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv/view?usp=sharing');
  await dialog(m).getByRole('button', { name: 'Enviar para publicação' }).click();
  await toast(m, 'Enviado!');
  await a.goto(BASE + '/testemunhos?status=pendente');
  await a.getByRole('button', { name: 'Publicar' }).click();
  await toast(a, 'Testemunho publicado.');
});
await check('visitante: vê o testemunho publicado e o vídeo do Drive, sem login', async () => {
  await v.goto(BASE + '/testemunhos');
  await v.getByText('Deus abriu uma porta de emprego').waitFor();
  // Com foto e vídeo, o testemunho mostra uma mídia só: a foto vira a capa do vídeo.
  if (await v.locator('.cover').count()) throw new Error('o testemunho mostrou a foto e o vídeo separados');
  const src = await v.locator('.player video, .player iframe').first().getAttribute('src');
  if (!src || !src.includes('1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv'))
    throw new Error('o vídeo do Drive não entrou no player do testemunho: ' + src);
  if (await v.getByRole('button', { name: 'Contar' }).count()) throw new Error('visitante não deveria poder contar testemunho');
  await shot(v, '17b-testemunhos.png');
});
await check('membro: aniversário aparece na semana', async () => {
  await m.goto(BASE + '/');
  await m.getByText('Aniversariantes da semana').waitFor();
});

// ======================= ADMIN: tesouraria, painel, relatórios =======================
await check('admin: confere a contribuição informada', async () => {
  await a.goto(BASE + '/admin/contribuicoes?status=informado');
  await a.getByText('Maria Souza · R$ 150,00').waitFor();
  await a.getByRole('button', { name: 'Conferir', exact: true }).click();
  await a.getByText('Conferido').first().waitFor();
  await a.goto(BASE + '/admin/contribuicoes');
  await a.waitForTimeout(500);
  await shot(a, '18-admin-contribuicoes.png', true);
});
await check('admin: painel da liderança', async () => {
  await a.goto(BASE + '/admin');
  await a.getByText('Membros aprovados').waitFor();
  await shot(a, '19-admin-painel.png', true);
});
await check('admin: relatórios com gráficos e tabela', async () => {
  await a.goto(BASE + '/admin/relatorios');
  await a.getByText('Novos cadastros no app').waitFor();
  await a.locator('.viz-col').first().hover();
  await a.getByRole('button', { name: 'Tabela' }).first().click();
  await a.locator('.viz-table').first().waitFor();
  await shot(a, '20-admin-relatorios.png', true);
});
await check('admin: envia notificação manual', async () => {
  await a.goto(BASE + '/admin/notificar');
  await a.getByLabel('Título').fill('Culto especial hoje!');
  await a.getByLabel('Mensagem').fill('Hoje às 20h, com a presença do Bispo Ronaldo.');
  await a.getByRole('button', { name: 'Enviar notificação' }).click();
  await dialog(a).getByRole('button', { name: 'Enviar' }).click();
  await toast(a, 'Notificação enviada!');
});
await check('mídia: encerra a live', async () => {
  await a.goto(BASE + '/ao-vivo');
  await a.getByRole('button', { name: 'Encerrar live' }).click();
  await dialog(a).getByRole('button', { name: 'Encerrar' }).click();
  await toast(a, 'Live encerrada.');
  await a.getByText('Nenhuma transmissão agora').waitFor();
});
await check('mídia: tela de transmissão abre a câmera', async () => {
  await a.goto(BASE + '/admin/config?aba=transmissao');
  await a.getByLabel(/URL de transmissão/).fill('https://customer-teste.cloudflarestream.com/segredo123/webRTC/publish');
  await a.getByLabel('URL de reprodução (WHEP)').fill('https://customer-teste.cloudflarestream.com/abc123/webRTC/play');
  await a.getByRole('button', { name: 'Salvar' }).click();
  await toast(a, 'Configuração salva.');
  await a.goto(BASE + '/transmitir');
  await a.waitForFunction(() => {
    const vid = document.querySelector('.broadcast-stage video');
    return vid && vid.videoWidth > 0;
  });
  await shot(a, '21-transmitir.png');
  await a.getByRole('button', { name: 'Iniciar transmissão' }).click();
  // a rede do teste não alcança a Cloudflare: o app tem que mostrar o erro com calma
  await a.getByText(/Não consegui iniciar a transmissão|conexão com o servidor/).waitFor({ timeout: 20000 });
});
await check('visitante: mapa de navegação "Mais"', async () => {
  await v.goto(BASE + '/mais');
  await v.getByText('Cartão do visitante').waitFor();
  await shot(v, '22-mais-visitante.png');
});
await check('membro: perfil e notificações', async () => {
  await m.goto(BASE + '/perfil');
  await m.getByText('Meus dados').waitFor();
  await shot(m, '23-perfil.png');
});

// ======================= MENSAGEM DO PASTOR, PREGAÇÕES, AJUDA MÚTUA E BÍBLIA =======================
await check('admin: publica a Mensagem do Pastor', async () => {
  await a.goto(BASE + '/mensagem');
  await a.getByRole('button', { name: 'Nova' }).click();
  const d = dialog(a);
  await d.getByLabel('Título').fill('Não temas, eu estou contigo');
  await d.getByLabel('Referência bíblica').fill('Isaías 41.10');
  await d.getByLabel('Versículo (texto)').fill('Não temas, porque eu sou contigo; não te assombres, porque eu sou teu Deus.');
  await d.getByLabel('Mensagem').fill('Bom dia, igreja! Hoje o Senhor te lembra: você não está sozinho.');
  await d.getByLabel('Vídeo do YouTube (opcional)').fill('https://youtu.be/dQw4w9WgXcQ');
  await d.getByRole('switch', { name: /Avisar agora/ }).check();
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast(a, 'Mensagem salva.');
  await a.getByText('Não temas, eu estou contigo').first().click();
  await a.locator('.player iframe').waitFor();
  await shot(a, '26-mensagem-pastor.png');
});
await check('visitante: início com Mensagem do Pastor e atalhos novos', async () => {
  await v.goto(BASE + '/');
  await v.locator('.pastor-card', { hasText: 'Não temas, eu estou contigo' }).waitFor();
  const quick = await v.locator('nav.quick').innerText();
  if (!/Mensagem do Pastor/.test(quick)) throw new Error('atalho Mensagem do Pastor faltando');
  if (/Células e grupos/.test(quick)) throw new Error('atalho Células e grupos ainda na tela inicial');
  if (/^Palavra$/m.test(quick)) throw new Error('atalho Palavra ainda na tela inicial');
  await shot(v, '27-inicio-mensagem.png');
  await v.goto(BASE + '/mais');
  await v.getByText('Células e grupos').waitFor();
  await v.getByText('Palavra do dia').waitFor();
});
await check('admin: grava áudio da Mensagem do Pastor (estilo WhatsApp)', async () => {
  await a.goto(BASE + '/mensagem');
  await a.getByRole('button', { name: 'Nova' }).click();
  const d = dialog(a);
  await d.getByLabel('Título').fill('Palavra em áudio');
  await d.getByLabel('Dia').fill(nextWeek);
  await d.getByRole('button', { name: 'Gravar áudio' }).click();
  await d.locator('.voice-rec.recording').waitFor();
  await a.waitForTimeout(2500);
  await shot(a, '26b-gravando.png');
  await d.getByRole('button', { name: 'Terminar e salvar o áudio' }).click();
  await d.locator('.voice-note').waitFor({ timeout: 15000 });
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast(a, 'Mensagem salva.');
  await a.getByText('Palavra em áudio').first().click();
  await a.locator('.voice-note').waitFor();
  const info = await a.evaluate(async () => {
    const r = await fetch(location.pathname.replace('/mensagem/', '/api/mensagens/')).then((x) => x.json());
    const res = await fetch(`/api/media/${r.message.audio_id}`, { headers: { range: 'bytes=0-99' } });
    return { status: res.status, type: res.headers.get('content-type'), len: (await res.arrayBuffer()).byteLength, dur: r.message.audio_duration };
  });
  if (info.status !== 206 || info.len !== 100 || !/^audio\//.test(info.type) || !(info.dur >= 2)) throw new Error(JSON.stringify(info));
  await a.getByRole('button', { name: /Ouvir/ }).click();
  await a.waitForFunction(() => {
    const el = document.querySelector('.voice-note audio');
    return el && el.currentTime > 0.3;
  });
  await shot(a, '26c-audio-pastor.png');
});
await check('admin: publica pregação pelo link do YouTube', async () => {
  await a.goto(BASE + '/pregacoes');
  await a.getByRole('button', { name: 'Pregação' }).click();
  const d = dialog(a);
  await d.getByLabel('Título').fill('O poder da fé');
  await d.getByLabel('Texto bíblico').fill('Hebreus 11.1-6');
  await d.getByLabel(/Link do vídeo no YouTube/).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await a.waitForURL(/\/pregacoes\/\d+$/);
  await a.locator('.player iframe').waitFor();
});
await check('visitante: lista e busca pregações', async () => {
  await v.goto(BASE + '/pregacoes');
  await v.getByText('O poder da fé').waitFor();
  await v.getByLabel('Buscar pregações').fill('Hebreus');
  await v.getByText('O poder da fé').waitFor();
  await v.getByLabel('Buscar pregações').fill('zzzz');
  await v.getByText('Nada encontrado').waitFor();
  await shot(v, '28-pregacoes.png');
});
await check('visitante: mural de ajuda é só para membros', async () => {
  await v.goto(BASE + '/ajuda');
  await v.getByText('Área dos membros').waitFor();
});
await check('membro: publica no mural de ajuda e a liderança aprova', async () => {
  await m.goto(BASE + '/ajuda');
  await m.getByRole('button', { name: 'Publicar no mural' }).click();
  const d = dialog(m);
  await d.getByRole('tab', { name: 'Quero ajudar' }).click();
  await d.getByRole('button', { name: 'Serviços' }).click();
  await d.getByLabel('Título').fill('Sou eletricista, posso ajudar irmãos');
  await d.getByLabel('Contato').fill('(11) 98765-4321');
  await d.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await toast(m, 'A liderança vai aprovar');
  await m.getByText('Aguardando aprovação').waitFor();
  await a.goto(BASE + '/');
  await a.getByText(/no mural de ajuda/).waitFor();
  await a.goto(BASE + '/ajuda?filtro=pendentes');
  await a.locator('.help-card', { hasText: 'Sou eletricista' }).getByRole('button', { name: 'Aprovar', exact: true }).click();
  await toast(a, 'Aprovado');
  await a.goto(BASE + '/ajuda');
  const card = a.locator('.help-card', { hasText: 'Sou eletricista' });
  await card.getByRole('link', { name: /WhatsApp/ }).waitFor();
  await card.getByText('(só a liderança vê)').waitFor();
});
await check('outro membro: mural anônimo e "Tenho interesse" avisa a liderança', async () => {
  const j = await newPhone('irmao');
  await devLogin(j, 'joao@irn.test', 'João Pereira', 'membro');
  await j.goto(BASE + '/');
  const quick = await j.locator('nav.quick').innerText();
  if (!/Ajuda mútua/.test(quick) || /Pregações/.test(quick)) throw new Error('atalhos: ' + quick.replace(/\n/g, ' | '));
  await j.goto(BASE + '/ajuda');
  await j.getByText('O mural é anônimo').waitFor();
  const card = j.locator('.help-card', { hasText: 'Sou eletricista' });
  await card.getByText('Anônimo').waitFor();
  if (await card.getByText('Maria').count()) throw new Error('nome de quem publicou aparece para outro membro');
  if (await card.getByRole('link', { name: /WhatsApp/ }).count()) throw new Error('contato aparece para outro membro');
  const api = await j.evaluate(() => fetch('/api/ajuda').then((r) => r.json()));
  if (api.posts.some((p) => p.author_name || p.contact || p.user_id)) throw new Error('API vaza autor/contato: ' + JSON.stringify(api.posts[0]));
  await card.getByRole('button', { name: 'Tenho interesse' }).click();
  await dialog(j).getByLabel('Recado (opcional)').fill('Preciso trocar a fiação da cozinha');
  await dialog(j).getByRole('button', { name: 'Avisar a liderança' }).click();
  await toast(j, 'A liderança vai entrar em contato');
  await shot(j, '29-ajuda-mutua.png');
  await a.goto(BASE + '/ajuda?filtro=interesses');
  await a.getByText('João Pereira').waitFor();
  await a.getByText(/fiação da cozinha/).waitFor();
  await shot(a, '29b-ajuda-interesses.png');
});
await check('membro: marca versículo, anota e vê em Meus versículos', async () => {
  await m.goto(BASE + '/biblia/joao/3?v=16');
  await m.locator('#v16').click();
  await m.getByRole('button', { name: 'Marcar e anotar' }).click();
  const d = dialog(m);
  await d.getByRole('radio', { name: 'Amarelo' }).click();
  await d.getByLabel('Minha anotação').fill('Versículo da minha conversão');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast(m, 'Salvo em Meus versículos.');
  await m.locator('#v16.hl').waitFor();
  await m.locator('#v16 .note-dot').waitFor();
  await m.goto(BASE + '/biblia/marcados');
  await m.getByText('Versículo da minha conversão').waitFor();
  await m.getByText(/Porque Deus amou o mundo|Deus amou/).first().waitFor();
  await shot(m, '30-meus-versiculos.png');
});
await check('membro: versículo em imagem com a logo', async () => {
  await m.goto(BASE + '/biblia/salmos/23?v=1');
  await m.locator('#v1').click();
  await m.getByRole('button', { name: 'Versículo em imagem' }).click();
  const img = dialog(m).locator('.art-preview img');
  await img.waitFor();
  await m.waitForFunction(() => {
    const el = document.querySelector('.art-preview img');
    return el && el.naturalWidth === 1080 && el.naturalHeight === 1350;
  });
  await dialog(m).getByRole('tab', { name: 'Status / Stories' }).click();
  await m.waitForFunction(() => document.querySelector('.art-preview img')?.naturalHeight === 1920);
  await shot(m, '31-versiculo-imagem.png');
  const download = m.waitForEvent('download');
  await dialog(m).getByRole('button', { name: 'Baixar' }).click();
  const file = await download;
  if (!/\.png$/.test(file.suggestedFilename())) throw new Error(file.suggestedFilename());
});

// ======================= MODO ESCURO E COMPUTADOR =======================
const dark = await newPhone('escuro', { colorScheme: 'dark' });
await check('modo escuro: início', async () => {
  await devLogin(dark, 'maria@irn.test', 'Maria Souza');
  await dark.goto(BASE + '/');
  await dark.getByText('Próximo culto').waitFor();
  await dark.waitForTimeout(500);
  await shot(dark, '24-inicio-escuro.png');
});
const desk = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
await check('computador: início', async () => {
  await desk.goto(BASE + '/');
  await desk.getByText('Próximo culto').waitFor();
  await desk.waitForTimeout(500);
  await shot(desk, '25-inicio-computador.png');
});

await browser.close();
console.log('\n================ RESULTADO ================');
console.log(`Falhas: ${failures.length}`);
failures.forEach((f) => console.log(' -', f));
console.log(`Erros no console: ${errors.length}`);
errors.slice(0, 30).forEach((e) => console.log(' -', e));
process.exit(failures.length || errors.length ? 1 : 0);
