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
  HS_ALIAS,
  norm,
  canonicalizeBdrName,
  bdrOwnerIds,
  bdrOwnerIdClause,
  resolveTeamIds,
  findUnresolvedOwners,
};
