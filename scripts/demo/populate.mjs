#!/usr/bin/env node
// Popula um WebChat em execução com dados de demonstração realistas.
//
// Tudo passa pelas interfaces públicas (HTTP + socket.io), do mesmo modo que o widget e o console:
// nada é inserido direto no banco. Assim os painéis (supervisão, qualidade, auditoria) mostram
// valores calculados de verdade pelo servidor.
//
// Uso:
//   node scripts/demo/populate.mjs [--base-url=http://localhost:3000] [--no-keep-alive] [--fast]
//
// Opções:
//   --base-url=URL    endereço do servidor (padrão http://localhost:3000, ou WEBCHAT_URL)
//   --site=ID         identificador público do site (padrão site_a)
//   --origin=URL      origem do site embutidor, precisa estar autorizada (padrão http://localhost:8090)
//   --password=SENHA  senha da demo (padrão demo-pass-123, ou DEMO_PASSWORD)
//   --keep-alive      mantém sockets e batimentos até Ctrl+C (padrão)
//   --no-keep-alive   encerra ao terminar (agentes ficam offline; visitantes saem do socket)
//   --fast            reduz as pausas entre mensagens (para testes)
//   --only-keep-alive só reconecta os agentes (presença e batimentos), sem criar conversas nem atividades;
//                     útil depois de reiniciar o servidor ou de revogar sessões pelo painel
//
// Rodar de novo adiciona mais conversas; catálogos (nome da empresa e do site, classificações, setor,
// atividade, permissão e histórico de atividades da Ana, SLA e comunicados) são reaproveitados quando
// já existem.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFromConsole = createRequire(join(root, 'apps/console/package.json'));
const { io } = requireFromConsole('socket.io-client');

// ---------------------------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const baseUrl = opt('base-url', process.env.WEBCHAT_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const sitePublicId = opt('site', 'site_a');
const parentOrigin = opt('origin', 'http://localhost:8090');
const password = opt('password', process.env.DEMO_PASSWORD ?? 'demo-pass-123');
const keepAlive = !flag('no-keep-alive');
const fast = flag('fast');
const onlyKeepAlive = flag('only-keep-alive');
const domain = '@tenant-a.local';
const heartbeatMs = 15_000;
const companyName = 'ViaVoip';
const siteName = 'Site ViaVoip';
const siteWelcome = 'Olá! Bem-vindo ao atendimento da ViaVoip.';
const pidFile = join(tmpdir(), 'webchat-demo-populate.pid');

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Pausa em segundos (com variação aleatória entre min e max). */
const pause = (min, max = min) => sleep((min + Math.random() * (max - min)) * 1000 * (fast ? 0.05 : 1));
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
const failures = [];
const created = {
  closed: 0,
  transfers: 0,
  abandoned: 0,
  active: 0,
  waiting: 0,
  surveys: 0,
  internalMessages: 0,
  announcements: 0,
  dispositions: 0,
  sla: 0,
  activities: 0,
  renamed: 0,
  authorities: 0,
  sectors: 0,
};

async function http(path, { method = 'GET', token, body } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        origin: parentOrigin,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    const code = payload?.error?.code;
    if (code === 'rate_limited' && attempt < 4) {
      log(`  limite de requisições em ${path}; aguardando 20 s`);
      await sleep(20_000);
      continue;
    }
    throw new Error(`${method} ${path}: ${response.status} ${payload?.error?.message ?? ''}`.trim());
  }
  throw new Error(`${method} ${path}: sem resposta`);
}

function connect(namespace, token) {
  return new Promise((resolveSocket, reject) => {
    const socket = io(`${baseUrl}${namespace}`, {
      auth: { token },
      transports: ['websocket'],
      withCredentials: false,
      extraHeaders: { origin: parentOrigin },
    });
    const timer = setTimeout(() => reject(new Error(`timeout ao conectar ${namespace}`)), 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolveSocket(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${namespace}: ${error.message}`));
    });
  });
}

/** Emite com ack e falha com a mensagem do servidor quando `ok` é falso. */
function call(socket, event, payload = {}) {
  return new Promise((resolveAck, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event}: timeout`)), 15_000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (ack && ack.ok === false) {
        reject(new Error(`${event}: ${ack.error?.code ?? 'erro'} ${ack.error?.message ?? ''}`.trim()));
      } else resolveAck(ack);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Pessoal (login + socket de longa duração)
// ---------------------------------------------------------------------------------------------

const staff = new Map();
const liveSockets = [];

async function staffSession(name) {
  const known = staff.get(name);
  if (known) return known;
  const login = await http('/auth/login', {
    method: 'POST',
    body: { email: `${name}${domain}`, password },
  });
  const me = await http('/auth/me', { token: login.token });
  const namespace = login.role === 'agent' ? '/agent' : '/supervisor';
  const socket = await connect(namespace, login.token);
  liveSockets.push(socket);
  const session = {
    name,
    role: login.role,
    token: login.token,
    id: me.selfId,
    displayName: me.name,
    socket,
    maxConcurrent: me.maxConcurrentAssignments,
    dispositions: me.dispositions,
    queues: me.queues,
    slots: null,
    waiters: [],
  };
  staff.set(name, session);
  log(`  ${name} conectado (${login.role})`);
  return session;
}

/** Semáforo por agente: respeita o limite de atendimentos simultâneos da empresa. */
async function acquire(agent) {
  if (agent.slots > 0) {
    agent.slots -= 1;
    return;
  }
  await new Promise((release) => agent.waiters.push(release));
}
function release(agent) {
  const next = agent.waiters.shift();
  if (next) next();
  else agent.slots += 1;
}

// ---------------------------------------------------------------------------------------------
// Visitantes
// ---------------------------------------------------------------------------------------------

async function newVisitor(displayName) {
  const session = await http('/visitor/sessions', {
    method: 'POST',
    body: { sitePublicId, parentOrigin },
  });
  const socket = await connect('/visitor', session.token);
  liveSockets.push(socket);
  const visitor = { displayName, socket, queues: session.queues, conversationId: null, lastMessageId: null };
  return visitor;
}

async function visitorStart(visitor, queueId) {
  const ack = await call(visitor.socket, 'conversation.start', {
    queueId,
    ...(visitor.displayName ? { displayName: visitor.displayName } : {}),
  });
  visitor.conversationId = ack.conversation.id;
  return ack.conversation;
}

async function say(actor, body) {
  const ack = await call(actor.socket, 'message.send', {
    conversationId: actor.conversationId,
    requestId: randomUUID(),
    body,
  });
  actor.lastMessageId = ack.messageId;
  return ack.messageId;
}

// ---------------------------------------------------------------------------------------------
// Catálogos (administração)
// ---------------------------------------------------------------------------------------------

async function command(admin, cmd) {
  return http('/company/commands', {
    method: 'POST',
    token: admin.token,
    body: { requestId: randomUUID(), command: cmd },
  });
}

async function prepareCompany(admin) {
  let desk = await http('/company/desk', { token: admin.token });

  // Nomes de demonstração. O seed usa "Tenant A"/"Site A"; a apresentação mostra a marca da ViaVoip.
  if (desk.company.name !== companyName) {
    desk = (await command(admin, { kind: 'company.rename', name: companyName })).desk;
    created.renamed += 1;
    log(`  empresa renomeada para ${companyName}`);
  }
  const site = desk.sites.find((item) => item.publicId === sitePublicId);
  if (site && (site.name !== siteName || site.appearance.welcomeMessage !== siteWelcome)) {
    desk = (
      await command(admin, {
        kind: 'site.appearance_replace',
        siteId: site.siteId,
        name: siteName,
        appearance: { ...site.appearance, welcomeMessage: siteWelcome },
      })
    ).desk;
    created.renamed += 1;
    log(`  site ${sitePublicId} renomeado para ${siteName}`);
  }

  // A Ana pode registrar as próprias pausas (a Diana já vem assim do seed). A mudança derruba as sessões
  // dela, então precisa acontecer antes de os agentes entrarem.
  const ana = desk.agents.find((agent) => agent.email === `ana${domain}`);
  if (ana?.placement.role === 'agent' && ana.placement.activityAuthority.kind !== 'self_service') {
    desk = (
      await command(admin, {
        kind: 'agent.activity_authority',
        agentId: ana.agentId,
        activityAuthority: { kind: 'self_service' },
      })
    ).desk;
    created.authorities += 1;
    log('  Ana autorizada a registrar a própria atividade');
  }

  for (const name of ['Dúvida comercial', 'Encaminhado ao técnico']) {
    if (desk.dispositions.some((item) => item.name === name && item.publication.status === 'active')) continue;
    desk = (await command(admin, { kind: 'disposition.create', name })).desk;
    created.dispositions += 1;
    log(`  classificação criada: ${name}`);
  }

  // SLA publicado só quando a fila ainda não tem política ativa. A vigência não pode ser retroativa.
  for (const queue of desk.queues) {
    const has = desk.slaPolicies.some((policy) => policy.queueId === queue.id && policy.life.status === 'active');
    if (has) continue;
    const effectiveFrom = new Date(Date.now() + 3_000).toISOString();
    const [wait, response] = queue.name === 'Vendas' ? [45, 120] : [30, 90];
    desk = (
      await command(admin, {
        kind: 'sla.publish',
        queueId: queue.id,
        effectiveFrom,
        queueWaitThresholdSeconds: wait,
        firstResponseThresholdSeconds: response,
      })
    ).desk;
    created.sla += 1;
    log(`  SLA publicado para ${queue.name}: espera ${wait}s, primeira resposta ${response}s`);
  }
  return desk;
}

async function prepareStaffCatalogs(admin, desk) {
  const idOf = (email) => desk.agents.find((agent) => agent.email === `${email}${domain}`)?.agentId;

  // Setor Comercial: faz a Diana (fila Vendas) aparecer na supervisão de Sofia e Helena.
  const sectors = (await call(admin.socket, 'sector.list')).sectors;
  let comercial = sectors.find((sector) => sector.name === 'Comercial');
  if (!comercial) {
    comercial = (
      await call(admin.socket, 'sector.save', {
        name: 'Comercial',
        description: 'Vendas e relacionamento com clientes',
        supervisorIds: [idOf('helena'), idOf('sofia')].filter(Boolean),
      })
    ).sector;
    created.sectors += 1;
    log('  setor criado: Comercial');
  }
  for (const member of ['diana', 'ana']) {
    const agentId = idOf(member);
    if (agentId && !comercial.members.some((person) => person.agentId === agentId)) {
      comercial = (await call(admin.socket, 'sector.member.add', { sectorId: comercial.id, agentId })).sector;
    }
  }

  // Tipos de atividade
  const catalog = await call(admin.socket, 'activity.catalog');
  if (!catalog.types.some((type) => type.name === 'Pausa café')) {
    await call(admin.socket, 'activity.type.save', { name: 'Pausa café' });
    log('  tipo de atividade criado: Pausa café');
  }
  return { sectors: [...sectors.filter((s) => s.id !== comercial.id), comercial], idOf };
}

// ---------------------------------------------------------------------------------------------
// Roteiros de atendimento
// ---------------------------------------------------------------------------------------------

const first = (name) => name.split(' ')[0];

const closedScenarios = [
  {
    visitor: 'Marcos Vieira',
    queue: 'Suporte',
    agent: 'bruno',
    disposition: 'Resolvido',
    score: 5,
    comment: 'Resolveram o áudio do ramal em poucos minutos. Obrigado!',
    startAfter: 0,
    claimAfter: [6, 10],
    turns: [
      ['v', 'Bom dia! O ramal 2104 da recepção está sem áudio nas chamadas recebidas. A pessoa fala e eu não escuto nada.'],
      ['a', 'Bom dia, Marcos! Aqui é o {agent} do suporte da ViaVoip. Vou ajudar. As chamadas feitas por esse ramal têm áudio nos dois sentidos?'],
      ['v', 'As feitas funcionam. Só as recebidas ficam mudas.'],
      ['a', 'Isso costuma ser NAT no roteador. Você tem a opção "SIP ALG" ativada nele? Se tiver, desative e reinicie o telefone.'],
      ['v', 'Tinha ativada mesmo. Desativei e reiniciei o aparelho. Vou testar.'],
      ['v', 'Funcionou! Recebi uma ligação agora e o áudio está perfeito.'],
      ['a', 'Ótimo! Registrei o ajuste no seu cadastro. Posso ajudar em mais alguma coisa?'],
      ['v', 'Era só isso, muito obrigado.'],
    ],
  },
  {
    visitor: 'Fernanda Albuquerque',
    queue: 'Suporte',
    agent: 'ana',
    disposition: 'Encaminhado ao técnico',
    score: 4,
    comment: 'Atendimento educado, aguardando o retorno do técnico.',
    startAfter: 4,
    claimAfter: [14, 22],
    turns: [
      ['v', 'Olá, pedi a portabilidade do número 11 4003-0123 há 5 dias e o status continua em análise. Tem previsão?'],
      ['a', 'Olá, Fernanda! Sou a {agent}. Deixe-me consultar o protocolo da portabilidade.'],
      ['a', 'A operadora doadora pediu a correção do CNPJ no termo. O prazo regulamentar é de até 3 dias úteis após o reenvio.'],
      ['v', 'Posso reenviar o termo por aqui?'],
      ['a', 'Por aqui não, mas vou abrir um chamado para o time técnico reenviar com o CNPJ correto e avisar você por e-mail.'],
      ['v', 'Perfeito, fico no aguardo.'],
    ],
  },
  {
    visitor: 'Rodrigo Teixeira',
    queue: 'Suporte',
    agent: 'ana',
    transferTo: { queue: 'Vendas', agent: 'diana' },
    disposition: 'Dúvida comercial',
    score: 5,
    comment: 'Fui transferido para o time certo sem precisar repetir tudo.',
    startAfter: 8,
    claimAfter: [10, 18],
    turns: [
      ['v', 'Boa tarde. Quero contratar mais 12 ramais para a minha operação e saber se o plano atual comporta.'],
      ['a', 'Boa tarde, Rodrigo! Sou a {agent}. Essa análise é feita pelo time comercial; vou transferir você agora com o histórico.'],
      ['@transfer'],
      ['a', 'Oi, Rodrigo! {agent} do comercial. Vi que você quer adicionar 12 ramais. Quantos atendentes simultâneos?'],
      ['v', 'Hoje são 18 ramais e uns 14 atendendo ao mesmo tempo.'],
      ['a', 'Com 30 ramais o melhor é o plano Call Center, com URA e gravação inclusas. Envio a proposta por e-mail ainda hoje.'],
      ['v', 'Pode enviar. Obrigado pela agilidade.'],
    ],
  },
  {
    visitor: 'Camila Ferraz',
    queue: 'Vendas',
    agent: 'diana',
    disposition: 'Dúvida comercial',
    score: 3,
    comment: 'Gostei da proposta, mas demorou um pouco para começar o atendimento.',
    startAfter: 12,
    claimAfter: [34, 44],
    turns: [
      ['v', 'Oi! Vocês têm plano para call center com 40 posições de atendimento? Preciso de gravação e relatórios.'],
      ['a', 'Olá, Camila! Aqui é a {agent}, do comercial. Sim: o plano Call Center inclui gravação de chamadas, relatórios em tempo real e URA.'],
      ['v', 'E dá para integrar com o nosso CRM?'],
      ['a', 'Dá sim, por API e webhooks. Posso agendar uma demonstração com o time técnico nesta semana?'],
      ['v', 'Pode ser na quinta, à tarde.'],
      ['a', 'Combinado, envio o convite para o seu e-mail. Obrigada!'],
    ],
  },
  {
    visitor: 'Paulo Henrique Duarte',
    queue: 'Suporte',
    agent: 'bruno',
    disposition: 'Sem solução',
    score: 2,
    comment: 'O problema da URA continua. Preciso de uma solução definitiva.',
    startAfter: 16,
    claimAfter: [20, 28],
    turns: [
      ['v', 'A URA não reconhece os dígitos que o cliente digita. Aperta 2 e cai sempre no menu principal.'],
      ['a', 'Olá, Paulo! Sou o {agent}. Os telefones dos clientes enviam DTMF por RFC 2833 ou por SIP INFO?'],
      ['v', 'Não sei dizer, quem configura é o provedor de telefonia dos clientes.'],
      ['a', 'Nesse caso preciso de uma chamada de teste com captura. Pode abrir um chamado com o horário de uma ligação que falhou?'],
      ['v', 'Já abri dois chamados e ninguém resolveu.'],
      ['a', 'Entendo a frustração. Vou registrar este atendimento como sem solução imediata e escalar o caso ao time de rede.'],
    ],
  },
  {
    visitor: 'Juliana Matos',
    queue: 'Suporte',
    agent: 'ana',
    disposition: 'Resolvido',
    score: 5,
    comment: 'Rápida e objetiva.',
    startAfter: 20,
    claimAfter: [8, 14],
    turns: [
      ['v', 'Preciso da segunda via da fatura de outubro, não chegou no e-mail do financeiro.'],
      ['a', 'Oi, Juliana! {agent} aqui. Vou reenviar agora para o e-mail cadastrado. Pode confirmar o CNPJ da empresa?'],
      ['v', '12.345.678/0001-90'],
      ['a', 'Pronto, a segunda via foi enviada para financeiro@empresa.example. Chega em até 5 minutos.'],
      ['v', 'Chegou! Obrigada.'],
    ],
  },
];

const activeScenarios = [
  {
    visitor: 'Ricardo Nogueira',
    queue: 'Suporte',
    agent: 'ana',
    unread: true,
    turns: [
      ['v', 'Boa tarde, as chamadas estão caindo sempre depois de 30 segundos. Começou hoje de manhã.'],
      ['a', 'Boa tarde, Ricardo! Aqui é a {agent}. Isso acontece em todos os ramais ou só em alguns?'],
      ['v', 'Em todos que ligam para fora.'],
      ['a', 'Vou verificar o registro do tronco SIP. Um instante.'],
    ],
    after: [
      'Consegue me dizer se está com o IP fixo ainda?',
      'O roteador reiniciou por volta das 8h, pode ter mudado o IP.',
    ],
  },
  {
    visitor: 'Luciana Barros',
    queue: 'Suporte',
    agent: 'bruno',
    turns: [
      ['v', 'Minha fatura veio com o ramal 3305 cobrado duas vezes. Podem verificar?'],
      ['a', 'Olá, Luciana! Sou o {agent}. Estou conferindo o detalhamento da fatura agora.'],
      ['a', 'Realmente há uma duplicidade. Vou pedir o estorno ao financeiro e já te passo o protocolo.'],
    ],
  },
  {
    visitor: 'Thiago Moreira',
    queue: 'Vendas',
    agent: 'diana',
    turns: [
      ['v', 'Gostaria de um orçamento de SIP trunk com 10 canais e numeração 0800.'],
      ['a', 'Olá, Thiago! Aqui é a {agent}. Para 0800 preciso do volume mensal de minutos. Tem uma estimativa?'],
      ['v', 'Mais ou menos 8 mil minutos por mês.'],
      ['a', 'Perfeito, vou montar a proposta com franquia de 10 mil minutos e retorno ainda hoje.'],
    ],
  },
];

const waitingScenarios = [
  { visitor: 'Patrícia Gomes', queue: 'Suporte', body: 'A URA não está transferindo as ligações para o ramal do financeiro. Cai na caixa postal.' },
  { visitor: 'André Lopes', queue: 'Vendas', body: 'Boa tarde, quero migrar meu PABX para a nuvem. Vocês atendem 40 ramais?' },
  { visitor: 'Sérgio Cunha', queue: 'Suporte', body: 'A portabilidade da minha linha está travada há 3 dias. Preciso de um posicionamento.' },
];

const firstNames = ['Eduarda', 'Gustavo', 'Larissa', 'Bruna', 'Felipe', 'Aline', 'Renato', 'Vanessa', 'Cláudio', 'Mariana', 'Leandro', 'Beatriz', 'Otávio', 'Priscila', 'Vinícius', 'Tatiana'];
const lastNames = ['Prado', 'Ribeiro', 'Campos', 'Siqueira', 'Andrade', 'Cardoso', 'Farias', 'Lima', 'Azevedo', 'Tavares', 'Moraes', 'Rocha', 'Pinheiro', 'Barbosa', 'Medeiros', 'Fonseca'];

/** Evita repetir o nome de um visitante que já aparece nas conversas (re-execuções). */
function uniqueName(name, taken) {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  for (let step = 0; step < firstNames.length * lastNames.length; step += 1) {
    const candidate = `${firstNames[step % firstNames.length]} ${lastNames[(step * 7 + Math.floor(step / firstNames.length)) % lastNames.length]}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  const fallback = `${name} ${taken.size}`;
  taken.add(fallback);
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Execução dos roteiros
// ---------------------------------------------------------------------------------------------

let queueIds = {};
let dispositionIds = {};

async function converse(visitor, agent, turns, { transfer, onTransfer } = {}) {
  let current = agent;
  for (const turn of turns) {
    if (turn[0] === '@transfer') {
      await call(current.socket, 'conversation.transfer', {
        conversationId: visitor.conversationId,
        queueId: queueIds[transfer.queue],
      });
      created.transfers += 1;
      release(current);
      log(`  ${visitor.displayName}: transferido para ${transfer.queue}`);
      current = await onTransfer();
      continue;
    }
    await pause(2, 4);
    if (turn[0] === 'v') {
      await say(visitor, turn[1]);
    } else {
      if (visitor.lastMessageId) {
        await call(current.socket, 'message.read', {
          conversationId: visitor.conversationId,
          messageId: visitor.lastMessageId,
        }).catch(() => undefined);
      }
      const text = turn[1].replaceAll('{agent}', first(current.displayName));
      await call(current.socket, 'message.send', {
        conversationId: visitor.conversationId,
        requestId: randomUUID(),
        body: text,
      });
    }
  }
  return current;
}

async function claimWhenFree(visitor, agent) {
  await acquire(agent);
  try {
    await call(agent.socket, 'conversation.claim', { conversationId: visitor.conversationId });
  } catch (error) {
    release(agent);
    throw error;
  }
}

async function runClosed(scenario) {
  const label = `${scenario.visitor} (${scenario.queue})`;
  await pause(scenario.startAfter);
  const visitor = await newVisitor(scenario.visitor);
  await visitorStart(visitor, queueIds[scenario.queue]);
  const [firstTurn, ...rest] = scenario.turns;
  await say(visitor, firstTurn[1]);
  log(`  na fila: ${label}`);
  await pause(...scenario.claimAfter);

  const agent = await staffSession(scenario.agent);
  await claimWhenFree(visitor, agent);
  const finisher = await converse(visitor, agent, rest, {
    transfer: scenario.transferTo,
    onTransfer: async () => {
      const next = await staffSession(scenario.transferTo.agent);
      await pause(6, 10);
      await claimWhenFree(visitor, next);
      return next;
    },
  });

  await pause(2, 3);
  const closed = await call(finisher.socket, 'conversation.close', {
    conversationId: visitor.conversationId,
    dispositionId: dispositionIds[scenario.disposition],
  });
  release(finisher);
  await pause(2, 5);
  await call(visitor.socket, 'survey.submit', {
    conversationId: visitor.conversationId,
    score: Math.min(scenario.score, closed.survey.scale),
    ...(scenario.comment && closed.survey.commentEnabled ? { comment: scenario.comment } : {}),
  });
  created.closed += 1;
  created.surveys += 1;
  log(`  encerrada: ${label} -> ${scenario.disposition}, nota ${scenario.score}`);
  return visitor;
}

async function runAbandoned() {
  await pause(18);
  const visitor = await newVisitor(null);
  await visitorStart(visitor, queueIds.Vendas);
  await say(visitor, 'Alguém aí? Preciso falar sobre um orçamento.');
  await pause(20, 26);
  await call(visitor.socket, 'conversation.leave', { conversationId: visitor.conversationId });
  created.abandoned += 1;
  log('  visitante desistiu da fila (Vendas)');
  visitor.socket.disconnect();
}

async function runActive(scenario) {
  const label = `${scenario.visitor} (${scenario.queue})`;
  const visitor = await newVisitor(scenario.visitor);
  await visitorStart(visitor, queueIds[scenario.queue]);
  const [firstTurn, ...rest] = scenario.turns;
  await say(visitor, firstTurn[1]);
  await pause(5, 9);
  const agent = await staffSession(scenario.agent);
  await call(agent.socket, 'conversation.claim', { conversationId: visitor.conversationId });
  await converse(visitor, agent, rest);
  if (scenario.after) {
    for (const text of scenario.after) {
      await pause(3, 5);
      await say(visitor, text); // sem leitura do agente: aparece como não lida
    }
  }
  created.active += 1;
  log(`  em atendimento: ${label} com ${scenario.agent}${scenario.after ? ' (mensagens não lidas)' : ''}`);
  return visitor;
}

async function runWaiting(scenario, delay) {
  await pause(delay);
  const visitor = await newVisitor(scenario.visitor);
  await visitorStart(visitor, queueIds[scenario.queue]);
  await say(visitor, scenario.body);
  created.waiting += 1;
  log(`  aguardando na fila ${scenario.queue}: ${scenario.visitor}`);
  return visitor;
}

// ---------------------------------------------------------------------------------------------
// Chat interno, comunicados e atividade
// ---------------------------------------------------------------------------------------------

async function internalChat(ana, bruno, diana, sofia, helena) {
  const send = async (who, conversationId, body) => {
    await pause(1.5, 3);
    await call(who.socket, 'internal.message.send', { conversationId, requestId: randomUUID(), body });
    created.internalMessages += 1;
  };

  const direct = (await call(ana.socket, 'internal.open', { peerId: sofia.id })).conversation;
  const marker = 'Posso escalar para o técnico?';
  const earlier = await call(ana.socket, 'internal.history', { conversationId: direct.id, limit: 100 });
  if (earlier.messages.some((message) => message.body.includes(marker))) {
    log('  chat interno já populado; mantido');
    return;
  }
  await send(ana, direct.id, 'Sofia, o cliente da portabilidade pediu prioridade. Posso escalar para o técnico?');
  await send(sofia, direct.id, 'Pode sim, Ana. Abre o chamado como urgente e me passa o protocolo.');
  await send(ana, direct.id, 'Aberto! Protocolo 48213.');
  await send(sofia, direct.id, 'Perfeito. Obrigada. Depois me conta como foi o retorno.');

  const groups = (await call(sofia.socket, 'internal.list')).conversations.filter((item) => item.kind === 'group');
  const suporte = groups.find((item) => item.title === 'Suporte Técnico');
  if (suporte) {
    await send(sofia, suporte.id, 'Pessoal, lembrete: manutenção da URA no sábado às 22h. Quem tiver cliente em operação avisa antes.');
    await send(bruno, suporte.id, 'Anotado. Vou avisar os clientes do plantão.');
    await send(ana, suporte.id, 'Eu aviso os que ligaram hoje sobre a URA.');
  }
  const comercial = groups.find((item) => item.title === 'Comercial');
  if (comercial) {
    await send(helena, comercial.id, 'Time, novo plano Call Center com gravação inclusa a partir de segunda.');
    await send(diana, comercial.id, 'Ótimo, já tenho dois clientes esperando por isso.');
  }
}

async function announcements(admin, sofia, sectorIdOf) {
  const existing = (await call(admin.socket, 'announcement.list', {})).announcements.map((item) => item.title);
  const plan = [
    {
      by: admin,
      title: 'Manutenção programada da URA no sábado às 22h',
      body: 'A URA ficará indisponível por cerca de 40 minutos no sábado, a partir das 22h, para atualização de plataforma. Avisem os clientes com operação noturna.',
      pinned: true,
      audience: 'tenant',
    },
    {
      by: admin,
      title: 'Meta de satisfação do mês: nota 4,5',
      body: 'Estamos com 4,3 de média nas pesquisas. Quem encerrar o atendimento já com a classificação correta ajuda a manter os relatórios confiáveis.',
      audience: 'tenant',
    },
    {
      by: sofia,
      title: 'Novo roteiro para portabilidade de número',
      body: 'Antes de abrir chamado, confirme CNPJ do termo, número a portar e operadora doadora. Isso evita o reenvio e reduz o prazo em 2 dias.',
      audience: 'sectors',
      sectorIds: [sectorIdOf('Suporte Técnico')].filter(Boolean),
    },
  ];
  for (const item of plan) {
    if (existing.includes(item.title)) continue;
    if (item.audience === 'sectors' && item.sectorIds.length === 0) continue;
    await call(item.by.socket, 'announcement.publish', {
      title: item.title,
      body: item.body,
      pinned: item.pinned ?? false,
      audience: item.audience,
      ...(item.sectorIds ? { sectorIds: item.sectorIds } : {}),
    });
    created.announcements += 1;
    log(`  comunicado: ${item.title}`);
    await pause(1);
  }
}

async function assignActivity(lead, eduardoId) {
  const catalog = await call(lead.socket, 'activity.catalog');
  const cafe = catalog.types.find((type) => type.name === 'Pausa café');
  if (!cafe) return;
  const history = await call(lead.socket, 'activity.history', { agentId: eduardoId });
  if (history.assignments.some((item) => item.status === 'active' && item.activityName === 'Pausa café')) return;
  await call(lead.socket, 'activity.assign', { agentId: eduardoId, activityTypeId: cafe.id });
  created.activities += 1;
  log('  Eduardo em "Pausa café"');
}

/** A Ana registra a própria pausa e depois um treinamento, deixando histórico e atividade atual. */
async function ownActivity(agent) {
  const catalog = await call(agent.socket, 'activity.catalog');
  const byName = (name) => catalog.types.find((type) => type.name === name && type.active);
  const cafe = byName('Pausa café');
  const training = catalog.types.find((type) => type.active && type.name !== 'Pausa café' && type.name !== 'Atendimento');
  if (!cafe || !training) return;
  const history = await call(agent.socket, 'activity.history', {});
  if (history.assignments.some((item) => item.activityName === 'Pausa café')) return;
  await call(agent.socket, 'activity.assign', { agentId: agent.id, activityTypeId: cafe.id });
  await pause(20, 30);
  await call(agent.socket, 'activity.finish', { agentId: agent.id });
  await pause(2);
  await call(agent.socket, 'activity.assign', { agentId: agent.id, activityTypeId: training.id });
  created.activities += 2;
  log(`  Ana registrou "Pausa café" e iniciou "${training.name}"`);
}

// ---------------------------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------------------------

async function guarded(label, work) {
  try {
    return await work();
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    log(`  FALHA em ${label}: ${error.message}`);
    return null;
  }
}

async function main() {
  if (existsSync(pidFile)) {
    const other = Number(readFileSync(pidFile, 'utf8'));
    try {
      process.kill(other, 0);
      log(`Atenção: já existe uma execução com keep-alive (PID ${other}). Os agentes ficam duplicados até ela ser encerrada.`);
    } catch {
      /* processo antigo já encerrado */
    }
  }
  log(`Populando ${baseUrl} (site ${sitePublicId}, origem ${parentOrigin})`);
  await http('/health');

  log('1/6 Administração: classificações, SLA, setor, tipos de atividade');
  const admin = await staffSession('otavio');
  let desk = await prepareCompany(admin);
  const catalogs = await prepareStaffCatalogs(admin, desk);
  desk = await http('/company/desk', { token: admin.token });
  queueIds = Object.fromEntries(desk.queues.map((queue) => [queue.name, queue.id]));
  dispositionIds = Object.fromEntries(desk.dispositions.map((item) => [item.name, item.id]));
  const concurrency = desk.company.concurrencyLimit;
  log(`  limite de atendimentos simultâneos por agente: ${concurrency}`);
  const sectorIdOf = (name) => catalogs.sectors.find((sector) => sector.name === name)?.id;
  const sectorsNow = (await call(admin.socket, 'sector.list')).sectors;
  catalogs.sectors = sectorsNow;

  log('2/6 Agentes entram e definem presença');
  const [ana, bruno, diana, eduardo, sofia, helena] = await Promise.all(
    ['ana', 'bruno', 'diana', 'eduardo', 'sofia', 'helena'].map((name) => staffSession(name)),
  );
  for (const agent of [ana, bruno, diana, eduardo]) {
    const queue = await call(agent.socket, 'queue.subscribe');
    const mine = queue.conversations.filter((item) => item.agentId === agent.id && item.status === 'assigned').length;
    // Reserva uma vaga para a conversa ativa do roteiro; Ana nunca passa de 1 ativa, para poder assumir da fila.
    const reserve = agent.name === 'ana' ? (mine >= 1 ? 0 : 1) : 1;
    agent.slots = Math.max(1, agent.maxConcurrent - mine - reserve);
    agent.alreadyActive = mine;
  }
  await call(ana.socket, 'presence.set', { status: 'available' });
  await call(bruno.socket, 'presence.set', { status: 'available' });
  await call(diana.socket, 'presence.set', { status: 'available' });
  await call(eduardo.socket, 'presence.set', { status: 'away' });

  // Batimentos desde já: a execução passa de 45 s e o servidor descarta conexões sem batimento.
  const beat = setInterval(() => {
    for (const agent of [ana, bruno, diana, eduardo]) {
      if (agent.socket.connected) agent.socket.emit('presence.heartbeat', {});
    }
  }, heartbeatMs);

  if (onlyKeepAlive) {
    log('Somente keep-alive: nenhuma conversa nova será criada');
    await holdOpen(beat, [sofia, helena, admin]);
    return;
  }

  log('3/6 Atendimentos (fila, em andamento e encerrados)');
  if (created.sla > 0) await sleep(4_000); // deixa o SLA recém-publicado entrar em vigor
  const everyone = (await call(admin.socket, 'conversation.list')).conversations;
  const takenNames = new Set(everyone.map((item) => item.visitorDisplayName).filter(Boolean));
  const openNames = new Set(
    everyone
      .filter((item) => item.status === 'queued' || item.status === 'assigned')
      .map((item) => item.visitorDisplayName)
      .filter(Boolean),
  );
  const keep = [];
  const track = (promise) => promise.then((visitor) => visitor && keep.push(visitor));
  const jobs = [];
  for (const scenario of activeScenarios) {
    if (openNames.has(scenario.visitor) || (scenario.agent === 'ana' && ana.alreadyActive >= 1)) {
      log(`  já existe atendimento em andamento de ${scenario.visitor}; mantido`);
      continue;
    }
    jobs.push(track(guarded(`ativa ${scenario.visitor}`, () => runActive(scenario))));
  }
  waitingScenarios.forEach((scenario, index) => {
    if (openNames.has(scenario.visitor)) {
      log(`  ${scenario.visitor} já está na fila; mantido`);
      return;
    }
    jobs.push(track(guarded(`fila ${scenario.visitor}`, () => runWaiting(scenario, index * 3))));
  });
  for (const scenario of closedScenarios) {
    const named = { ...scenario, visitor: uniqueName(scenario.visitor, takenNames) };
    jobs.push(track(guarded(`encerrada ${named.visitor}`, () => runClosed(named))));
  }
  jobs.push(guarded('desistência', runAbandoned));

  log('4/6 Chat interno, comunicados e atividade (em paralelo)');
  jobs.push(guarded('chat interno', () => internalChat(ana, bruno, diana, sofia, helena)));
  jobs.push(guarded('comunicados', () => announcements(admin, sofia, sectorIdOf)));
  jobs.push(guarded('atividade', () => assignActivity(sofia, eduardo.id)));
  jobs.push(guarded('atividade da Ana', () => ownActivity(ana)));

  await Promise.all(jobs);

  log('5/6 Resumo');
  console.log(JSON.stringify({ created, failures }, null, 2));

  log('6/6 Conferência');
  const snapshot = await call(sofia.socket, 'supervisor.snapshot', {});
  console.log(JSON.stringify(snapshot.snapshot.metrics, null, 2));

  if (!keepAlive) {
    clearInterval(beat);
    for (const socket of liveSockets) socket.disconnect();
    return;
  }

  await holdOpen(beat, [sofia, helena, admin]);
}

/** Mantém sockets e batimentos até Ctrl+C; quem só serviu aos comandos (supervisão e admin) é desconectado. */
async function holdOpen(beat, commandOnly) {
  // Sofia, Helena e Otávio só serviam aos comandos; o navegador do usuário faz o login deles.
  for (const person of commandOnly) person.socket.disconnect();
  writeFileSync(pidFile, String(process.pid));
  log(`Keep-alive ativo (PID ${process.pid}). Agentes: ana, bruno, diana, eduardo. Ctrl+C encerra.`);
  const shutdown = () => {
    clearInterval(beat);
    for (const socket of liveSockets) socket.disconnect();
    try {
      unlinkSync(pidFile);
    } catch {
      /* já removido */
    }
    log('Encerrado.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Mantém o processo vivo mesmo sem outros handles ativos.
  setInterval(() => undefined, 60_000);
}

main().catch((error) => {
  console.error('Falha ao popular:', error.message);
  process.exit(1);
});
