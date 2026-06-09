'use strict';
/**
 * GET /api/users
 * Retorna lista de usuários SEM senhas ou hashes.
 * S5: Nunca expor campo password ou hash.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

// NEEDS_ADJUSTMENT(D04): Lista de 60+ usuários hardcoded no código.
// Quando alguém entra ou sai da empresa, precisa editar aqui e fazer deploy.
// Ideal: buscar do HubSpot owners API ou mover para config file / env var.
const USERS = [
  { name: 'Ivan Gartner', email: 'i@axenya.com', role: 'admin' },
  { name: 'A. Fellini', email: 'afellini@axenya.com', role: 'staff' },
  { name: 'A. Galdino', email: 'agaldino@axenya.com', role: 'staff' },
  { name: 'A. Mastbaum', email: 'amastbaum@axenya.com', role: 'staff' },
  { name: 'A. Mazzaferro', email: 'amazzaferro@axenya.com', role: 'staff' },
  { name: 'Anderson Souza', email: 'anderson.souza@axenya.com', role: 'bdr' },
  { name: 'A. Pasiani', email: 'apasiani@axenya.com', role: 'staff' },
  { name: 'André Pontes', email: 'apontes@axenya.com', role: 'ae' },
  { name: 'A. Rodrigues', email: 'arodrigues@axenya.com', role: 'staff' },
  { name: 'A. Santos', email: 'asantos@axenya.com', role: 'staff' },
  { name: 'Aylan', email: 'aylan@axenya.com', role: 'staff' },
  { name: 'B. Albuquerque', email: 'balbuquerque@axenya.com', role: 'staff' },
  { name: 'B. Garcia', email: 'bgarcia@axenya.com', role: 'staff' },
  { name: 'Caio', email: 'caio@axenya.com', role: 'staff' },
  { name: 'C. Bigliani', email: 'cbigliani@axenya.com', role: 'staff' },
  { name: 'Cíntia', email: 'cintia@axenya.com', role: 'bdr' },
  { name: 'Cíntia Rodrigues', email: 'crodrigues@axenya.com', role: 'bdr' },
  { name: 'C. Santos', email: 'csantos@axenya.com', role: 'staff' },
  { name: 'D. Marques', email: 'dmarques@axenya.com', role: 'staff' },
  { name: 'E. Freitas', email: 'efreitas@axenya.com', role: 'staff' },
  { name: 'E. Silva', email: 'esilva@axenya.com', role: 'staff' },
  { name: 'F. Andrade', email: 'fandrade@axenya.com', role: 'staff' },
  { name: 'F. Braganholle', email: 'fbraganholle@axenya.com', role: 'staff' },
  { name: 'F. Carneiro', email: 'fcarneiro@axenya.com', role: 'staff' },
  { name: 'F. Girotto', email: 'fgirotto@axenya.com', role: 'staff' },
  { name: 'Fernando Henrique', email: 'fsiqueira@axenya.com', role: 'ae' },
  { name: 'G. Floriano', email: 'gfloriano@axenya.com', role: 'staff' },
  { name: 'Guilherme Gabiatti', email: 'ggabiatti@axenya.com', role: 'ae' },
  { name: 'G. Nunes', email: 'gnunes@axenya.com', role: 'staff' },
  { name: 'G. Ramos', email: 'gramos@axenya.com', role: 'staff' },
  { name: 'G. Silva', email: 'gsilva@axenya.com', role: 'staff' },
  { name: 'G. Vieira', email: 'gvieira@axenya.com', role: 'staff' },
  { name: 'H. Barros', email: 'hbarros@axenya.com', role: 'staff' },
  { name: 'H. Tibucheski', email: 'htibucheski@axenya.com', role: 'staff' },
  { name: 'J. Araujo', email: 'jaraujo@axenya.com', role: 'staff' },
  { name: 'J. Bolzan', email: 'jbolzan@axenya.com', role: 'staff' },
  { name: 'J. Calixto', email: 'jcalixto@axenya.com', role: 'staff' },
  { name: 'J. Dutra', email: 'jdutra@axenya.com', role: 'staff' },
  { name: 'J. Martins', email: 'jmartins@axenya.com', role: 'staff' },
  { name: 'Karen Castellano', email: 'kcastellano@axenya.com', role: 'cotacao' },
  { name: 'L. Oliveira', email: 'loliveira@axenya.com', role: 'staff' },
  { name: 'L. Ramon', email: 'lramon@axenya.com', role: 'staff' },
  { name: 'L. Rocha', email: 'lrocha@axenya.com', role: 'staff' },
  { name: 'Letícia Romão', email: 'lromao@axenya.com', role: 'bdr' },
  { name: 'Lucia', email: 'lucia@axenya.com', role: 'staff' },
  { name: 'Maga', email: 'maga@axenya.com', role: 'staff' },
  { name: 'Magalhães', email: 'magalhaes@axenya.com', role: 'staff' },
  { name: 'Mariana Assis', email: 'massis@axenya.com', role: 'ae' },
  { name: 'M. Bastos', email: 'mbastos@axenya.com', role: 'staff' },
  { name: 'M. Carvalho', email: 'mcarvalho@axenya.com', role: 'staff' },
  { name: 'M. Netto', email: 'mnetto@axenya.com', role: 'staff' },
  { name: 'M. Vasconcelos', email: 'mvasconcelos@axenya.com', role: 'staff' },
  { name: 'M. Zeviani', email: 'mzeviani@axenya.com', role: 'staff' },
  { name: 'Priscilla Feliciello', email: 'pfeliciello@axenya.com', role: 'bdr' },
  { name: 'Peterson Venancio', email: 'pvenancio@axenya.com', role: 'ae' },
  { name: 'R. Candido', email: 'rcandido@axenya.com', role: 'staff' },
  { name: 'Rafael Leite', email: 'rferreira@axenya.com', role: 'ae' },
  { name: 'S. Alencar', email: 'salencar@axenya.com', role: 'staff' },
  { name: 'S. Lapadula', email: 'slapadula@axenya.com', role: 'staff' },
  { name: 'S. Ribeiro', email: 'sribeiro@axenya.com', role: 'staff' },
  { name: 'T. Pontes', email: 'tpontes@axenya.com', role: 'staff' },
  { name: 'V. Madeira', email: 'vmadeira@axenya.com', role: 'staff' },
  { name: 'Vivian Munhos', email: 'vmunhos@axenya.com', role: 'cotacao' },
  { name: 'W. Araujo', email: 'waraujo@axenya.com', role: 'staff' },
  { name: 'Y. Muramoto', email: 'ymuramoto@axenya.com', role: 'staff' },
  { name: 'Fausto Haderspeck', email: 'fausto@axenya.com', role: 'ae' },
  { name: 'Juliana Dalberto', email: 'juliana@axenya.com', role: 'ae' },
  { name: 'Gabriele Almeida', email: 'gabriele@axenya.com', role: 'bdr' }
];

module.exports = function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // S5: Retornar APENAS name, email, role — NUNCA hash ou password
  return res.status(200).json({
    success: true,
    users: USERS.map(u => ({ name: u.name, email: u.email, role: u.role }))
  });
}
