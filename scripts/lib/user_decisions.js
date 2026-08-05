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
 */
'use strict';

const DECISOES_HUMANAS = [
  { legacyIndex: 0, nome: 'CLEITON GOMES',                email: 'cleiton_1310@hotmail.com',    funcaoFinal: 'comercial', acao: 'criar-conta' },
  { legacyIndex: 1, nome: 'MARIA LUIZA',                   email: 'marialuizasstival@gmail.com',  funcaoFinal: 'producao',  acao: 'criar-conta' },
  { legacyIndex: 4, nome: 'Paulo Victor',                  email: 'cortevr@gmail.com',            funcaoFinal: 'producao',  acao: 'criar-conta' },
  { legacyIndex: 2, nome: 'ISABELLA BORGES',                email: 'isabellabsil@hotmail.com',     funcaoFinal: 'master',    acao: 'normalizar-existente' },
  { legacyIndex: 3, nome: 'Valéria Vieira Borges e Silva',  email: 'vrronaldo@hotmail.com',        funcaoFinal: 'master',    acao: 'normalizar-existente' },
  { legacyIndex: 5, nome: 'Gabriel (conta principal)',      email: 'gabrieelborges@hotmail.com',   funcaoFinal: 'master',    acao: 'normalizar-com-claim' },
  { legacyIndex: 6, nome: 'Gabriel Borges (conta secundária)', email: 'gabrieelborges8@gmail.com', funcaoFinal: 'master',    acao: 'normalizar-existente' },
  { legacyIndex: 7, nome: 'Gabriel Borges (conta aposentada)', email: 'gabrieelborges8@hotmail.com', funcaoFinal: null,      acao: 'aposentar' },
];

const CONTAS_TECNICAS = ['vrmarcasgithub@gmail.com'];

const VALID_ROLES = ['master', 'comercial', 'producao', 'financeiro'];

function getDecisaoPorEmail(email) {
  if (!email) return null;
  const e = email.toLowerCase();
  return DECISOES_HUMANAS.find(d => d.email.toLowerCase() === e) || null;
}

module.exports = { DECISOES_HUMANAS, CONTAS_TECNICAS, VALID_ROLES, getDecisaoPorEmail };
