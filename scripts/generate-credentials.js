#!/usr/bin/env node
'use strict';
/**
 * generate-credentials.js — Gerador seguro de credentials para o Pipeline Dashboard
 *
 * SEGURANÇA (S3, S4):
 * - Gera senhas INDIVIDUAIS por usuário (formato: {username}{6 random digits})
 * - Armazena APENAS o hash SHA-256 em credentials.json
 * - NUNCA armazena senhas em plaintext no arquivo de credentials
 * - Gera PASSWORDS_FIRST_RUN.txt separado para distribuição inicial (NÃO vai no app)
 * - Remove a senha universal legada (_legacy)
 *
 * USO:
 *   node scripts/generate-credentials.js
 *   node scripts/generate-credentials.js --output /caminho/para/credentials.json
 *
 * SAÍDA:
 *   src/credentials.json — hashes apenas (vai no app)
 *   PASSWORDS_FIRST_RUN.txt — senhas em plaintext (para o admin, NÃO vai no app)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Lista canônica de usuários (mesma do main.js)
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

/**
 * Gera uma senha individual para um usuário.
 * Formato: {username_sem_ponto}{6 dígitos aleatórios}
 * Exemplo: igartner847291
 *
 * @param {string} email
 * @returns {string}
 */
function generatePassword(email) {
  const username = (email || '').split('@')[0].replace(/\./g, '').replace(/-/g, '');
  // Usar crypto.randomInt para segurança criptográfica
  const digits = String(crypto.randomInt(100000, 999999));
  return username + digits;
}

/**
 * Gera hash SHA-256 de uma senha.
 *
 * FIXME(S02): SHA-256 sem salt. Duas senhas iguais geram o mesmo hash.
 * Vulnerável a rainbow tables e ataques de dicionário.
 * Se login por senha for mantido, migrar para bcrypt ou scrypt com salt.
 * Se login por senha foi desativado (Google OAuth), este script é dead code — ver TODO(D03).
 *
 * @param {string} password
 * @returns {string} - Hex string de 64 chars
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

// ===== MAIN =====
const args = process.argv.slice(2);
const outputArg = args.indexOf('--output');
const credentialsOutputPath = outputArg >= 0 && args[outputArg + 1]
  ? args[outputArg + 1]
  : path.join(__dirname, '..', 'src', 'credentials.json');

const plaintextOutputPath = path.join(__dirname, '..', 'PASSWORDS_FIRST_RUN.txt');

console.log('');
console.log('=== Axenya Pipeline Dashboard — Gerador de Credentials ===');
console.log('');
console.log(`Gerando senhas para ${USERS.length} usuários...`);
console.log('');

// Objeto que vai para credentials.json (APENAS hashes)
const credentialsJson = {};

// Array para o arquivo de distribuição (senhas em plaintext — NÃO vai no app)
const plaintextLines = [
  '=== AXENYA PIPELINE DASHBOARD — SENHAS INICIAIS ===',
  `Gerado em: ${new Date().toISOString()}`,
  '',
  'ATENÇÃO: Este arquivo contém senhas em plaintext.',
  'Distribua individualmente para cada usuário e DELETE este arquivo após a distribuição.',
  'NÃO versionar, NÃO enviar por email em massa, NÃO incluir no app.',
  '',
  '─'.repeat(70),
  ''
];

for (const user of USERS) {
  const password = generatePassword(user.email);
  const hash = hashPassword(password);

  // credentials.json: APENAS hash (sem password)
  credentialsJson[user.name] = {
    hash,
    role: user.role,
    email: user.email
    // NOTA: campo 'password' INTENCIONALMENTE AUSENTE
  };

  // Arquivo de distribuição: senha em plaintext
  plaintextLines.push(`Nome:  ${user.name}`);
  plaintextLines.push(`Email: ${user.email}`);
  plaintextLines.push(`Senha: ${password}`);
  plaintextLines.push(`Role:  ${user.role}`);
  plaintextLines.push('');
}

plaintextLines.push('─'.repeat(70));
plaintextLines.push('');
plaintextLines.push('INSTRUÇÕES:');
plaintextLines.push('1. Envie a senha individualmente para cada usuário (não em massa)');
plaintextLines.push('2. Peça que cada usuário altere a senha no primeiro acesso (futuro)');
plaintextLines.push('3. DELETE este arquivo após distribuir todas as senhas');
plaintextLines.push('4. O arquivo credentials.json contém APENAS hashes — é seguro incluir no app');
plaintextLines.push('');

// Escrever credentials.json (hashes apenas)
fs.writeFileSync(credentialsOutputPath, JSON.stringify(credentialsJson, null, 2), { encoding: 'utf8', mode: 0o644 });
console.log(`✅ credentials.json criado em: ${credentialsOutputPath}`);
console.log(`   → ${USERS.length} usuários, APENAS hashes SHA-256 (sem senhas em plaintext)`);

// Verificação de segurança: garantir que não há campo 'password' no JSON
const verifyJson = JSON.parse(fs.readFileSync(credentialsOutputPath, 'utf8'));
let hasPasswordField = false;
for (const [name, data] of Object.entries(verifyJson)) {
  if ('password' in data) {
    hasPasswordField = true;
    console.error(`❌ ERRO: Campo 'password' encontrado para ${name}!`);
  }
}
if (!hasPasswordField) {
  console.log('   → Verificação de segurança: PASSOU (zero campos password)');
}

// Escrever PASSWORDS_FIRST_RUN.txt (senhas em plaintext — para o admin)
fs.writeFileSync(plaintextOutputPath, plaintextLines.join('\n'), { encoding: 'utf8', mode: 0o600 });
console.log('');
console.log(`⚠️  PASSWORDS_FIRST_RUN.txt criado em: ${plaintextOutputPath}`);
console.log('   → Contém senhas em PLAINTEXT — distribua individualmente e DELETE após uso');
console.log('   → Permissões: 600 (apenas o dono pode ler)');
console.log('');
console.log('=== Concluído ===');
console.log('');
