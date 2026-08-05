/**
 * user_decisions.js
 * Fonte única das decisões humanas de conciliação dos 8 perfis legados
 * (erp_vr/erp_usuarios) — registrada nesta rodada, com sua confirmação
 * explícita por perfil. Todo script de migração/sincronização/aposentadoria
 * lê DESTE arquivo, nunca reimplementa a decisão por conta própria.
 *
 * Campos:
 *   legacyIndex — índice no array legado (só para rastreabilidade/auditoria)
 *   nome, email — identificação (e-mail é a chave real de correspondência)
 *   funcaoFinal — role final decidida (null = não deve ter acesso)
 *   acao:
 *     'criar-conta'              — conta Auth ainda não existe, precisa ser criada
 *     'normalizar-existente'     — conta Auth já existe, só falta o doc normalizado
 *     'normalizar-com-claim'     — idem, e o custom claim também precisa mudar
 *     'aposentar'                — conta existe, mas NÃO deve ter documento ativo
 *
 * CONTAS_SUBSTITUIDAS — estado DISTINTO de 'aposentar'. Registra contas criadas
 * com e-mail incorreto e substituídas por uma conta nova e correta (ex.: Paulo
 * Victor, criado no Checkpoint 1 como cortevr@gmail.com por engano, corrigido
 * para contato@aprovain.com). A conta antiga é desabilitada e perde acesso,
 * mas NÃO é a mesma coisa que um colaborador que efetivamente se desligou —
 * scripts/replace_erp_user.js trata exclusivamente desta lista, nunca de
 * DECISOES_HUMANAS.acao==='aposentar', e vice-versa em scripts/retire_erp_user.js.
 */
'use strict';

const DECISOES_HUMANAS = [
  { legacyIndex: 0, nome: 'CLEITON GOMES',                email: 'cleiton_1310@hotmail.com',    funcaoFinal: 'comercial', acao: 'criar-conta' },
  { legacyIndex: 1, nome: 'MARIA LUIZA',                   email: 'marialuizasstival@gmail.com',  funcaoFinal: 'producao',  acao: 'criar-conta' },
  { legacyIndex: 4, nome: 'Paulo Victor',                  email: 'contato@aprovain.com',         funcaoFinal: 'producao',  acao: 'criar-conta' },
  { legacyIndex: 2, nome: 'ISABELLA BORGES',                email: 'isabellabsil@hotmail.com',     funcaoFinal: 'master',    acao: 'normalizar-existente' },
  { legacyIndex: 3, nome: 'Valéria Vieira Borges e Silva',  email: 'vrronaldo@hotmail.com',        funcaoFinal: 'master',    acao: 'normalizar-existente' },
  { legacyIndex: 5, nome: 'Gabriel (conta principal)',      email: 'gabrieelborges@hotmail.com',   funcaoFinal: 'master',    acao: 'normalizar-com-claim' },
  { legacyIndex: 6, nome: 'Gabriel Borges (conta secundária)', email: 'gabrieelborges8@gmail.com', funcaoFinal: 'master',    acao: 'normalizar-existente' },
  { legacyIndex: 7, nome: 'Gabriel Borges (conta aposentada)', email: 'gabrieelborges8@hotmail.com', funcaoFinal: null,      acao: 'aposentar' },
];

const CONTAS_SUBSTITUIDAS = [
  {
    legacyIndex: 4,
    nome: 'Paulo Victor',
    emailAntigo: 'cortevr@gmail.com',
    emailNovo: 'contato@aprovain.com',
    motivo: 'conta criada com e-mail incorreto no Checkpoint 1 (2026-08-05) — corrigida a pedido do usuário',
  },
];

const CONTAS_TECNICAS = ['vrmarcasgithub@gmail.com'];

const VALID_ROLES = ['master', 'comercial', 'producao', 'financeiro'];

function getDecisaoPorEmail(email) {
  if (!email) return null;
  const e = email.toLowerCase();
  return DECISOES_HUMANAS.find(d => d.email.toLowerCase() === e) || null;
}

function getSubstituicaoPorEmailAntigo(email) {
  if (!email) return null;
  const e = email.toLowerCase();
  return CONTAS_SUBSTITUIDAS.find(s => s.emailAntigo.toLowerCase() === e) || null;
}

function isEmailSubstituido(email) {
  return !!getSubstituicaoPorEmailAntigo(email);
}

module.exports = {
  DECISOES_HUMANAS, CONTAS_TECNICAS, VALID_ROLES, getDecisaoPorEmail,
  CONTAS_SUBSTITUIDAS, getSubstituicaoPorEmailAntigo, isEmailSubstituido,
};
