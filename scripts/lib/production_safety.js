/**
 * production_safety.js
 * Trava compartilhada por todos os scripts de migração de usuários para
 * qualquer execução --apply contra o projeto de produção (erp-vrmarcas).
 * Não afrouxa a trava anterior — adiciona camadas por cima dela.
 *
 * Para --apply --confirm-project=erp-vrmarcas ser aceito, TODAS as
 * condições abaixo precisam ser verdadeiras simultaneamente:
 *   1. --allow-production presente:
 *   2. --authorization=FASE_F_USERS_2026_08_05 presente (token da
 *      autorização humana desta rodada específica — não é secreto, é só
 *      um identificador de rastreabilidade, igual um número de ticket);
 *   3. o estado ATUAL do Auth/Firestore bate exatamente com o esperado
 *      (validarEstadoEsperado), verificado ANTES de qualquer escrita.
 *
 * Qualquer divergência aborta com exit(1) e nenhuma escrita é feita.
 */
'use strict';

const { DECISOES_HUMANAS, CONTAS_TECNICAS, CONTAS_SUBSTITUIDAS } = require('./user_decisions');

const AUTORIZACAO_ESPERADA = 'FASE_F_USERS_2026_08_05';

function flagsDeProducaoPresentes(argv) {
  const temAllowProduction = argv.includes('--allow-production');
  const authArg = argv.find(a => a.startsWith('--authorization='));
  const temAuthorization = !!(authArg && authArg.split('=')[1] === AUTORIZACAO_ESPERADA);
  return { ok: temAllowProduction && temAuthorization, temAllowProduction, temAuthorization };
}

// ── Modo de credencial ───────────────────────────────────────────────────
// --credential-mode=adc usa explicitamente admin.credential.applicationDefault()
// (Application Default Credentials — gcloud auth application-default login),
// nunca um arquivo JSON de service account, mesmo que GOOGLE_APPLICATION_
// CREDENTIALS esteja definida no ambiente por engano — a intenção explícita
// da flag sempre vence. Só faz sentido combinado com produção; contra o
// emulador (demo-erp-homolog) a credencial é irrelevante, o emulador não a
// verifica.
function usaCredencialADC(argv) {
  const arg = argv.find(a => a.startsWith('--credential-mode='));
  return !!(arg && arg.split('=')[1] === 'adc');
}

function initializeAppComModoCorreto(admin, projectId, argv) {
  if (admin.apps.length) return admin.app();
  if (usaCredencialADC(argv)) {
    // Nunca loga path/token/conteúdo da credencial — só a decisão de modo.
    console.log('[credencial] modo ADC explícito — ignorando qualquer GOOGLE_APPLICATION_CREDENTIALS de arquivo.');
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'erp-vrmarcas' });
  }
  return admin.initializeApp({ projectId });
}

// ── Núcleo puro: recebe o estado JÁ CONSULTADO (authUsers, existingNormUids)
// e valida contra as contagens esperadas. Testável sem Firebase. ──────────
//
// exigirACriarAusente (default true):
//   true  — as contas "a criar" DEVEM estar ausentes do Auth ainda. Nunca é
//           realmente usado por nenhum script hoje (ver null abaixo), mas
//           continua suportado/testado como o estágio conceitual "antes de
//           qualquer criação".
//   false — as contas "a criar" DEVEM já estar presentes. Usado por
//           migrate_erp_usuarios_normalizado.js e sync_role_claims.js, que
//           operam sobre contas Auth já existentes.
//   null  — não valida presença NEM ausência das contas "a criar" (cada uma
//           pode estar em estágio diferente — algumas já criadas, outras
//           ainda não). Usado por create_missing_erp_users.js, cujo próprio
//           laço por decisão já trata isso de forma idempotente e segura
//           (cria se ausente, aborta-conciliação individual se presente
//           inesperadamente) — um gate binário global aqui bloquearia
//           incorretamente a criação de uma conta corrigida enquanto outras
//           já existem de uma rodada anterior (bug real encontrado e
//           corrigido durante a correção do e-mail de Paulo Victor).
// A checagem de "existentes devem estar presentes", ambiguidade e conta
// técnica continuam valendo em TODOS os estágios, sem exceção.
function validarEstadoEsperado(authUsers, existingNormUids, exigirACriarAusente) {
  if (exigirACriarAusente === undefined) exigirACriarAusente = true;
  const authByEmail = new Map(authUsers.filter(u => u.email).map(u => [u.email.toLowerCase(), u]));
  const tecnicas = new Set(CONTAS_TECNICAS.map(e => e.toLowerCase()));

  const erros = [];

  const ativos = DECISOES_HUMANAS.filter(d => d.acao !== 'aposentar');
  const aCriar = DECISOES_HUMANAS.filter(d => d.acao === 'criar-conta');
  const existentes = DECISOES_HUMANAS.filter(d => d.acao === 'normalizar-existente' || d.acao === 'normalizar-com-claim');
  const aposentados = DECISOES_HUMANAS.filter(d => d.acao === 'aposentar');

  if (ativos.length !== 8) erros.push('esperado 8 usuários ativos na tabela, encontrado ' + ativos.length);
  if (aCriar.length !== 3) erros.push('esperado 3 contas a criar na tabela, encontrado ' + aCriar.length);
  if (existentes.length !== 5) erros.push('esperado 5 contas existentes na tabela, encontrado ' + existentes.length);
  if (aposentados.length !== 1) erros.push('esperado 1 aposentado na tabela, encontrado ' + aposentados.length);

  if (exigirACriarAusente === null) {
    // Não valida presença nem ausência — ver comentário da função.
  } else if (exigirACriarAusente) {
    // As 3 "a criar" DEVEM estar ausentes do Auth agora (senão o passo de
    // criação seria redundante/perigoso — para nisso e exige nova conciliação).
    aCriar.forEach(d => {
      if (authByEmail.has(d.email.toLowerCase())) erros.push('conta "' + d.nome + '" já existe no Auth, mas a tabela espera criar — pare e reconcilie');
    });
  } else {
    // Estágio pós-criação: as 3 "a criar" DEVEM estar presentes agora
    // (senão create_missing_erp_users.js ainda não rodou ou falhou).
    aCriar.forEach(d => {
      if (!authByEmail.has(d.email.toLowerCase())) erros.push('conta "' + d.nome + '" ainda não existe no Auth — rode create_missing_erp_users.js primeiro');
    });
  }

  // As 4 "existentes" DEVEM estar presentes no Auth agora.
  existentes.forEach(d => {
    if (!authByEmail.has(d.email.toLowerCase())) erros.push('conta "' + d.nome + '" não encontrada no Auth, mas a tabela espera que já exista');
  });

  // O aposentado deve existir (não pode aposentar quem não existe).
  aposentados.forEach(d => {
    if (!authByEmail.has(d.email.toLowerCase())) erros.push('conta aposentada "' + d.nome + '" não encontrada no Auth');
  });

  // Nenhuma conta técnica pode coincidir com nenhuma decisão da tabela.
  DECISOES_HUMANAS.forEach(d => {
    if (tecnicas.has(d.email.toLowerCase())) erros.push('ERRO GRAVE: conta técnica "' + d.email + '" está associada a uma decisão de role — abortando');
  });

  // 0 ambiguidade: nenhum e-mail da tabela pode aparecer mais de 1x no Auth.
  DECISOES_HUMANAS.forEach(d => {
    const matches = authUsers.filter(u => u.email && u.email.toLowerCase() === d.email.toLowerCase());
    if (matches.length > 1) erros.push('e-mail "' + d.email + '" corresponde a ' + matches.length + ' contas no Auth — ambíguo, abortando');
  });

  // Um e-mail antigo já substituído (ver CONTAS_SUBSTITUIDAS) nunca pode
  // reaparecer como decisão ativa — protege contra reintroduzir por engano
  // uma conta corrigida (ex.: cortevr@gmail.com após a correção para
  // contato@aprovain.com).
  const emailsSubstituidos = new Set(CONTAS_SUBSTITUIDAS.map(s => s.emailAntigo.toLowerCase()));
  DECISOES_HUMANAS.forEach(d => {
    if (emailsSubstituidos.has(d.email.toLowerCase())) {
      erros.push('ERRO GRAVE: e-mail "' + d.email + '" já foi substituído (ver CONTAS_SUBSTITUIDAS) mas ainda aparece como decisão ativa na tabela — abortando');
    }
  });

  return { ok: erros.length === 0, erros, resumo: { ativos: ativos.length, aCriar: aCriar.length, existentes: existentes.length, aposentados: aposentados.length, substituidos: CONTAS_SUBSTITUIDAS.length } };
}

module.exports = { flagsDeProducaoPresentes, validarEstadoEsperado, AUTORIZACAO_ESPERADA, usaCredencialADC, initializeAppComModoCorreto };
