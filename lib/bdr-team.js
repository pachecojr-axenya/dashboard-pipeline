'use strict';
/**
 * Módulo canônico de time de BDRs da Axenya.
 * Fonte única para todos os endpoints que precisam filtrar por owner.
 * 
 * Uso:
 *   const { BDR_TEAM, HS_ALIAS, norm, resolveTeamIds } = require('../lib/bdr-team');
 * 
 * Atualizado: 2026-07-20
 */

const BDR_TEAM = [
  'Anderson Souza', 'Cintia Rodrigues', 'Gabriele Almeida', 'Priscilla Feliciello',
  'Leticia Romão', 'Allan Valença', 'Bruna Reis', 'Emanuelle Braga', 'Felipe Andrade',
  'Giovana Nunes', 'Marcelli Netto', 'Thauan Pontes', 'Yokyko Muramoto',
];

const HS_ALIAS = {
  'gabriele de almeida silva': 'Gabriele Almeida',
  'bruna cristina dos reis silva': 'Bruna Reis',
  'giovana rocha': 'Giovana Nunes',
};

/**
 * SAÍDAS DO TIME | data do PRIMEIRO dia em que o BDR não deve mais aparecer.
 *
 * Por que data e não remover do BDR_TEAM: apagar o nome da lista faria o
 * trabalho REAL de julho sumir do gráfico e o total do time de julho cair sem
 * ninguém ter trabalhado menos — a mesma família de defeito de "quebra de série
 * sem premissa declarada". O corte é POR DATA DA LINHA: o que o BDR fez antes
 * de sair continua contando; o que aparece com o nome dele depois da saída, não.
 *
 * O que aparecia depois da saída (medido em 14/08/2026, 01–14/08): 30
 * atividades e 10 movimentos de CRM nos quatro — quase tudo reunião de agenda
 * herdada e e-mail automático em contato que continuou com eles como dono. É
 * pouco em volume e muito em leitura: são 4 nomes a mais dividindo a média do
 * time e ocupando o seletor de BDR.
 *
 * Mesma régua de `api/bdr-leads.js` (BDR_TEAM_EFFECTIVE_FROM), que já fazia
 * isso sozinho para leads desde 08/2026 — agora os dois leem daqui.
 */
const BDR_EXITS = {
  'Anderson Souza': '2026-08-01',
  'Cintia Rodrigues': '2026-08-01',
  'Thauan Pontes': '2026-08-01',
  'Yokyko Muramoto': '2026-08-01',
};

const BDR_OWNER_MAP = {
  '83025540': 'Gabriele Almeida',
  '83375302': 'Priscilla Feliciello',
  '85310335': 'Anderson Souza',
  '86900152': 'Cintia Rodrigues',
  '87213208': 'Cintia Rodrigues',
  '89781254': 'Leticia Romão',
  '90141426': 'Giovana Nunes',
  '90540670': 'Yokyko Muramoto',
  '90540671': 'Thauan Pontes',
  '90540672': 'Marcelli Netto',
  '90540673': 'Felipe Andrade',
  '90688051': 'Emanuelle Braga',
  '90688054': 'Allan Valença',
  '91925085': 'Bruna Reis',
};

/**
 * Normaliza nome para matching (remove acentos, lowercase, trim).
 * @param {string} s 
 * @returns {string}
 */
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Resolve IDs de owner do HubSpot para nomes canônicos do time.
 * @param {Object} ownerMap - Mapa { ownerId: ownerName } retornado pelo HubSpot
 * @returns {Object} Mapa { ownerId: canonicalBdrName }
 */
function resolveTeamIds(ownerMap) {
  const canonSet = {};
  BDR_TEAM.forEach(n => { canonSet[norm(n)] = n; });
  const idToBdr = {};
  Object.keys(ownerMap).forEach(id => {
    const raw = norm(ownerMap[id]);
    const canonical = canonSet[norm(HS_ALIAS[raw] || raw)];
    if (canonical) idToBdr[id] = canonical;
  });
  return idToBdr;
}

function canonicalizeBdrName(name) {
  const ownerId = String(name || '').trim();
  if (BDR_OWNER_MAP[ownerId]) return BDR_OWNER_MAP[ownerId];
  const normalized = norm(name);
  const aliased = HS_ALIAS[normalized] || name;
  return BDR_TEAM.find(bdr => norm(bdr) === norm(aliased)) || String(name || '').trim() || null;
}

/**
 * Resolve um nome de BDR (canônico, alias ou cru do HubSpot) para os owner_ids dele.
 *
 * Por que existe: as tabelas gold do workload guardam `owner_name` CRU do HubSpot
 * ("Gabriele de Almeida Silva", "Cíntia Rodrigues"), enquanto a UI filtra pelo nome
 * canônico ("Gabriele Almeida", "Cintia Rodrigues"). Comparar string com string
 * zerava o resultado de todo BDR com alias ou acento divergente (incidente
 * 2026-07-27: Gabriele, Cintia e Bruna retornavam 0 linhas com dado existente no BQ).
 * Filtrar por `owner_id` é imune a acento, alias e renomeação no HubSpot.
 *
 * @param {string} name Nome em qualquer grafia conhecida, ou o próprio owner_id.
 * @returns {string[]} owner_ids do BDR. Vazio se o nome não resolver para o time.
 */
function bdrOwnerIds(name) {
  if (!name) return [];
  const canonical = canonicalizeBdrName(name);
  if (!BDR_TEAM.includes(canonical)) return [];
  // Só dígitos: o client BigQuery não suporta ARRAY params, então estes ids são
  // interpolados no SQL. A origem já é o mapa canônico (nunca input do usuário),
  // e o filtro abaixo garante isso mesmo se o mapa for editado errado no futuro.
  return Object.keys(BDR_OWNER_MAP)
    .filter(id => BDR_OWNER_MAP[id] === canonical)
    .filter(id => /^\d+$/.test(id));
}

/**
 * Cláusula SQL de filtro por owner_id, já sanitizada. Retorna '' quando não há
 * filtro de BDR, para o chamador simplesmente não adicionar condição.
 *
 * FAIL-CLOSED: se `bdrName` é informado mas não resolve para nenhum owner_id,
 * lança erro em vez de devolver '' — devolver '' faria a query retornar o TIME
 * INTEIRO rotulado como se fosse de um BDR só. Esse é exatamente o modo de falha
 * silenciosa do incidente 2026-07-27 e não deve poder voltar por outra porta
 * (ex.: alguém adiciona BDR em BDR_TEAM e esquece de BDR_OWNER_MAP).
 *
 * @param {string} alias Alias da tabela no SQL (ex.: 'd'). Vazio = sem prefixo.
 * @param {string[]} ids Saída de bdrOwnerIds().
 * @param {string} [bdrName] Nome pedido, só para detectar o caso fail-closed.
 * @returns {string} Ex.: "d.owner_id IN ('83025540')" ou ''.
 */
function bdrOwnerIdClause(alias, ids, bdrName) {
  const safe = (ids || []).filter(id => /^\d+$/.test(String(id)));
  if (!safe.length) {
    if (bdrName) {
      const err = new Error(`BDR "${bdrName}" não tem owner_id mapeado em BDR_OWNER_MAP; filtro seria ignorado e o resultado voltaria com o time inteiro.`);
      err.statusCode = 500;
      throw err;
    }
    return '';
  }
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}owner_id IN (${safe.map(id => `'${id}'`).join(',')})`;
}

/**
 * Data de saída do BDR (primeiro dia FORA), ou null se ativo.
 * Aceita nome em qualquer grafia conhecida ou o próprio owner_id.
 */
function bdrExitDate(name) {
  const canonical = canonicalizeBdrName(name);
  return BDR_EXITS[canonical] || null;
}

/**
 * O BDR contava como time NAQUELA data? `dateIso` = 'YYYY-MM-DD'.
 *
 * Sem data informada responde pelo HOJE — chamador que agrega por linha deve
 * SEMPRE passar a data da linha, senão o passado do BDR que saiu desaparece.
 */
function isActiveBdrOn(name, dateIso) {
  const canonical = canonicalizeBdrName(name);
  if (!BDR_TEAM.includes(canonical)) return false;
  const exit = BDR_EXITS[canonical];
  if (!exit) return true;
  const d = /^\d{4}-\d{2}-\d{2}/.test(String(dateIso || '')) ? String(dateIso).slice(0, 10) : todayIsoBrt();
  return d < exit;
}

/** Hoje em America/Sao_Paulo (UTC-3), no formato YYYY-MM-DD. */
function todayIsoBrt() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Roster que faz sentido oferecer para uma JANELA — um BDR entra se esteve
 * ativo em algum dia dela. Janela inteiramente depois da saída não lista quem
 * saiu; janela que cruza a saída lista (o trabalho de antes é real e tem de
 * continuar visível).
 *
 * `until` ausente = mesma data de `since`. Nenhuma data = roster de hoje.
 */
function activeTeam(since, until) {
  const fim = /^\d{4}-\d{2}-\d{2}/.test(String(until || '')) ? String(until).slice(0, 10)
    : (/^\d{4}-\d{2}-\d{2}/.test(String(since || '')) ? String(since).slice(0, 10) : todayIsoBrt());
  const ini = /^\d{4}-\d{2}-\d{2}/.test(String(since || '')) ? String(since).slice(0, 10) : fim;
  // Ativo em ALGUM dia da janela == ativo no primeiro dia dela (a saída é
  // monotônica: quem saiu não volta).
  return BDR_TEAM.filter((name) => isActiveBdrOn(name, ini <= fim ? ini : fim));
}

/** owner_ids de quem já saiu, com a data de saída. */
function exitedOwnerIds() {
  return Object.keys(BDR_OWNER_MAP)
    .filter((id) => /^\d+$/.test(id) && BDR_EXITS[BDR_OWNER_MAP[id]])
    .map((id) => ({ id, exit: BDR_EXITS[BDR_OWNER_MAP[id]] }));
}

/**
 * Cláusula SQL que corta a linha de BDR que já tinha saído NAQUELA data.
 * Devolve '' quando não há ninguém a cortar (nunca `1=1`, para não poluir SQL).
 *
 * Fica em SQL, e não só no JavaScript de agregação, porque endpoint de drill e
 * de contagem lê linha crua sem passar pelo agregador — cortar num lugar só
 * deixaria a tabela do drill mostrando o que o gráfico já não mostra.
 *
 * @param {string} alias alias da tabela ('' = sem prefixo)
 * @param {string} dateColumn coluna DATE da linha (metric_date, eligible_date…)
 */
function exitedCutClause(alias, dateColumn) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(dateColumn || ''))) throw new Error(`coluna de data inválida: ${dateColumn}`);
  const prefix = alias ? `${alias}.` : '';
  const parts = exitedOwnerIds().map(({ id, exit }) => `(${prefix}owner_id = '${id}' AND ${prefix}${dateColumn} >= DATE '${exit}')`);
  if (!parts.length) return '';
  // COALESCE(..., FALSE) e não `NOT (...)` puro: com owner_id ou data NULL a
  // comparação vira NULL, `NULL OR NULL` é NULL e `NOT NULL` é NULL — que o
  // WHERE trata como falso e DESCARTA a linha. Um corte que existe para tirar 4
  // nomes acabaria tirando toda linha sem dono, em silêncio.
  return `NOT COALESCE(${parts.join(' OR ')}, FALSE)`;
}

/**
 * Valida se o time está completo (para diagnósticos).
 * Retorna lista de nomes do HubSpot que não foram resolvidos.
 * @param {Object} ownerMap - Mapa { ownerId: ownerName } retornado pelo HubSpot
 * @returns {string[]} Lista de nomes não resolvidos
 */
function findUnresolvedOwners(ownerMap) {
  const resolved = new Set(Object.values(resolveTeamIds(ownerMap)));
  const unresolved = [];
  Object.values(ownerMap).forEach(name => {
    const normalized = norm(name);
    const aliased = norm(HS_ALIAS[normalized] || name);
    if (!resolved.has(BDR_TEAM.find(b => norm(b) === aliased))) {
      // Verifica se não está nem no BDR_TEAM nem nos aliases
      const inTeam = BDR_TEAM.some(b => norm(b) === aliased);
      if (!inTeam && !HS_ALIAS[normalized]) {
        unresolved.push(name);
      }
    }
  });
  return [...new Set(unresolved)];
}

module.exports = {
  BDR_TEAM,
  BDR_OWNER_MAP,
  BDR_EXITS,
  HS_ALIAS,
  norm,
  canonicalizeBdrName,
  bdrOwnerIds,
  bdrOwnerIdClause,
  bdrExitDate,
  isActiveBdrOn,
  activeTeam,
  exitedOwnerIds,
  exitedCutClause,
  todayIsoBrt,
  resolveTeamIds,
  findUnresolvedOwners,
};
