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
  HS_ALIAS,
  norm,
  resolveTeamIds,
  findUnresolvedOwners,
};
