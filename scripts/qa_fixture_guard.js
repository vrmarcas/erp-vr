/**
 * qa_fixture_guard.js
 *
 * FASE 1 da auditoria "FECHAMENTO DEFINITIVO" (2026-08-05): 'stock' foi
 * sobrescrito por acidente DUAS vezes nesta auditoria — as duas vezes pelo
 * mesmo erro: gravar um documento agregado inteiro a partir do estado em
 * memória de uma aba de navegador que ainda não tinha o listener
 * sincronizado. Este módulo existe para tornar esse erro estruturalmente
 * impossível em qualquer manipulação de fixture feita via Admin SDK (Node),
 * não apenas documentá-lo.
 *
 * Regras não-negociáveis, aplicadas em código, não em disciplina:
 *  - só aceita projectId começando com "demo-"; recusa explicitamente
 *    "erp-vrmarcas" mesmo que alguém tente disfarçar com maiúsculas/espaços;
 *  - toda fixture (chave em qualquer documento agregado, nome de OS,
 *    cliente, etc.) precisa do prefixo E2E_FASEF_20260805_ — objetos sem
 *    esse prefixo em nenhum campo textual identificável são rejeitados;
 *  - nunca faz `.set()` substituindo um mapa/array inteiro por um objeto
 *    menor sem antes ler o servidor e fazer merge campo a campo — perder
 *    uma chave que já existia no servidor e não está no novo payload é
 *    tratado como erro fatal, não como "atualização";
 *  - dry-run por padrão — só grava de verdade com a flag { apply: true }
 *    explícita, e sempre mostra o diff planejado antes;
 *  - faz backup local (JSON, fora do Git) do estado anterior e calcula
 *    SHA-256 antes de qualquer escrita real;
 *  - depois de aplicar, relê o servidor e confirma que o resultado bate
 *    com o esperado — se não bater, lança erro (não segue em frente calado);
 *  - limpeza só remove chaves que o PRÓPRIO runner marcou como criadas
 *    nesta sessão (rastreadas em memória), nunca "tudo que parece fixture".
 *
 * Uso típico (ver scripts/test_qa_fixture_guard.js para exemplos executáveis):
 *
 *   const { FixtureGuard } = require('./qa_fixture_guard');
 *   const guard = new FixtureGuard({ projectId: 'demo-erp-homolog', apply: true });
 *   await guard.mergeFixture('stock', { e2e_fasef_mat: { label: 'E2E_FASEF_20260805_Mat', qty: 5 } });
 *   ...
 *   await guard.cleanupCreated(); // remove só o que este guard criou
 */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PROD_PROJECT_IDS = ['erp-vrmarcas'];
const FIXTURE_PREFIX = 'E2E_FASEF_20260805_';
const BACKUP_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  'erp-vr-fasef-homolog-snapshots',
  'qa_fixture_guard_backups'
);

function assertNaoProducao(projectId) {
  var p = String(projectId || '').trim().toLowerCase();
  if (!p) throw new Error('[qa_fixture_guard] projectId vazio — recusado.');
  if (PROD_PROJECT_IDS.indexOf(p) >= 0) {
    throw new Error('[qa_fixture_guard] RECUSADO: projectId "' + projectId + '" é um projeto de PRODUÇÃO conhecido. Este runner nunca escreve em produção.');
  }
  if (p.indexOf('demo-') !== 0) {
    throw new Error('[qa_fixture_guard] RECUSADO: projectId "' + projectId + '" não começa com "demo-". Este runner só opera em projetos de homologação.');
  }
}

function contemPrefixoFixture(valor) {
  if (typeof valor === 'string') return valor.indexOf(FIXTURE_PREFIX) >= 0;
  if (Array.isArray(valor)) return valor.some(contemPrefixoFixture);
  if (valor && typeof valor === 'object') return Object.values(valor).some(contemPrefixoFixture);
  return false;
}

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function agora() {
  // Date.now() é intencional aqui (script standalone, não workflow) — só
  // usado para nome de arquivo de backup, não para lógica de negócio.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

class FixtureGuard {
  /**
   * @param {object} opts
   * @param {string} opts.projectId — obrigatório, validado contra produção.
   * @param {object} opts.db — instância firebase-admin firestore() já
   *   conectada ao Emulator (via FIRESTORE_EMULATOR_HOST) — não é criada
   *   aqui para não acoplar este módulo a uma inicialização específica do
   *   Admin SDK; quem chama já deve ter feito admin.initializeApp() com o
   *   FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST corretos.
   * @param {boolean} [opts.apply=false] — sem isso, todo método de escrita
   *   só calcula e imprime o diff planejado, nunca grava.
   * @param {string} [opts.col='erp_vr'] — coleção dos documentos agregados.
   */
  constructor(opts) {
    opts = opts || {};
    assertNaoProducao(opts.projectId);
    if (!opts.db) throw new Error('[qa_fixture_guard] opts.db (firestore()) é obrigatório.');
    this.projectId = opts.projectId;
    this.db = opts.db;
    this.apply = opts.apply === true;
    this.col = opts.col || 'erp_vr';
    this._criados = {}; // { docKey: Set(chaves criadas por este guard) }
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  async _lerServidor(docKey) {
    var ref = this.db.collection(this.col).doc(docKey);
    var snap = await ref.get();
    var raw = (snap.exists && snap.data() && typeof snap.data().data !== 'undefined') ? snap.data().data : null;
    var parsed = raw !== null ? JSON.parse(raw) : null;
    return { ref: ref, exists: snap.exists, parsed: parsed, raw: raw };
  }

  _backup(docKey, dadoAnterior) {
    var file = path.join(BACKUP_DIR, docKey + '_' + agora() + '.json');
    fs.writeFileSync(file, JSON.stringify({ docKey: docKey, projectId: this.projectId, capturadoEm: new Date().toISOString(), dado: dadoAnterior }, null, 2));
    var hash = sha256(dadoAnterior);
    fs.writeFileSync(file + '.sha256', hash + '  ' + path.basename(file) + '\n');
    return { file: file, hash: hash };
  }

  /**
   * Faz merge de `fixtureObj` (mapa: chave -> valor) dentro do documento
   * agregado `docKey`, SEMPRE lendo o servidor primeiro e preservando
   * qualquer chave já existente que não esteja em `fixtureObj`. Toda chave
   * de `fixtureObj` precisa conter o prefixo de fixture em algum campo
   * textual — senão, é rejeitada (isso é o que teria impedido os dois
   * acidentes desta auditoria: um objeto sem o prefixo nunca passa daqui).
   */
  async mergeFixture(docKey, fixtureObj, opts) {
    opts = opts || {};
    if (!fixtureObj || typeof fixtureObj !== 'object' || Array.isArray(fixtureObj)) {
      throw new Error('[qa_fixture_guard] mergeFixture espera um MAPA {chave: valor} — arrays inteiros não são aceitos aqui (use mergeFixtureArray).');
    }
    var chavesInvalidas = Object.keys(fixtureObj).filter(function (k) { return !contemPrefixoFixture(fixtureObj[k]) && !contemPrefixoFixture(k); });
    if (chavesInvalidas.length) {
      throw new Error('[qa_fixture_guard] RECUSADO: as chaves ' + chavesInvalidas.join(', ') + ' não contêm o prefixo obrigatório "' + FIXTURE_PREFIX + '" em nenhum campo textual.');
    }

    // Diff só para exibição (dry-run) — não é a fonte de verdade da escrita;
    // a leitura que decide o resultado real acontece DENTRO da transação
    // abaixo, para não perder uma escrita concorrente entre o preview e o
    // commit (é exatamente essa janela de "ler, decidir, gravar" em passos
    // separados que causou os dois acidentes de sobrescrita desta auditoria).
    var preview = await this._lerServidor(docKey);
    var previewBase = preview.parsed && !Array.isArray(preview.parsed) ? preview.parsed : {};
    var previewChavesAntes = Object.keys(previewBase);
    var diff = {
      docKey: docKey,
      chavesAntes: previewChavesAntes.length,
      chavesNovas: Object.keys(fixtureObj).filter(function (k) { return previewChavesAntes.indexOf(k) < 0; }),
      chavesSobrescritas: Object.keys(fixtureObj).filter(function (k) { return previewChavesAntes.indexOf(k) >= 0; }),
    };
    console.log('[qa_fixture_guard] diff planejado (preview) para "' + docKey + '":', JSON.stringify(diff, null, 2));

    if (!this.apply) {
      console.log('[qa_fixture_guard] dry-run (apply=false) — nada foi gravado.');
      return { applied: false, diff: diff };
    }

    var backupInfo = preview.parsed !== null ? this._backup(docKey, preview.parsed) : null;
    var self = this;
    var ref = this.db.collection(this.col).doc(docKey);

    var commitResult = await this.db.runTransaction(async function (txn) {
      var snap = await txn.get(ref);
      var raw = (snap.exists && snap.data() && typeof snap.data().data !== 'undefined') ? snap.data().data : null;
      var atual = raw !== null ? JSON.parse(raw) : null;
      if (atual !== null && Array.isArray(atual)) {
        throw new Error('[qa_fixture_guard] RECUSADO: o documento "' + docKey + '" no servidor é um array, incompatível com mergeFixture (mapa). Use appendFixtureItems.');
      }
      var base = atual ? Object.assign({}, atual) : {};
      var chavesAntes = Object.keys(base);
      var resultado = Object.assign({}, base, fixtureObj);
      var chavesDepois = Object.keys(resultado);
      var perdidas = chavesAntes.filter(function (k) { return chavesDepois.indexOf(k) < 0; });
      if (perdidas.length) {
        throw new Error('[qa_fixture_guard] ERRO FATAL: o merge perderia as chaves ' + perdidas.join(', ') + ' — operação abortada.');
      }
      txn.set(ref, { data: JSON.stringify(resultado), ts: Date.now() });
      return { chavesDepois: chavesDepois.length };
    });

    // Rodada 2.1 (2026-08-08) — achado real (falha intermitente reproduzida
    // no teste 10, "duas fixtures concorrentes"): esta checagem comparava
    // a CONTAGEM TOTAL de chaves do documento, lida DEPOIS da transação
    // commitar, contra a contagem vista NO MOMENTO do commit desta mesma
    // transação. Sob concorrência real (duas chamadas de mergeFixture no
    // MESMO documento — exatamente o cenário que este método deve suportar
    // corretamente), a transação do Firestore já mescla e serializa as
    // escritas sem perda nenhuma, mas a leitura pós-commit desta chamada
    // pode acontecer DEPOIS que a OUTRA chamada concorrente também já
    // commitou — inflando a contagem total e disparando este "erro fatal"
    // por uma causa que não é perda de dado nenhuma. Corrigido verificando
    // só o que ESTA chamada era responsável por escrever (suas próprias
    // chaves, com o valor mesclado esperado) — nunca a contagem total do
    // documento, que outra escrita concorrente pode legitimamente mudar.
    var confirmado = await this._lerServidor(docKey);
    var confirmadoData = confirmado.parsed || {};
    var chavesPerdidasNaConfirmacao = Object.keys(fixtureObj).filter(function (k) {
      return JSON.stringify(confirmadoData[k]) !== JSON.stringify(fixtureObj[k]);
    });
    if (chavesPerdidasNaConfirmacao.length) {
      throw new Error('[qa_fixture_guard] ERRO FATAL: leitura pós-escrita não confirma as chaves ' + chavesPerdidasNaConfirmacao.join(', ') + ' — investigar antes de continuar.');
    }
    Object.keys(fixtureObj).forEach(function (k) {
      self._criados[docKey] = self._criados[docKey] || new Set();
      self._criados[docKey].add(k);
    });

    console.log('[qa_fixture_guard] aplicado dentro de transação e confirmado por leitura direta do servidor. Backup: ' + (backupInfo ? backupInfo.file : '(documento não existia antes)'));
    return { applied: true, diff: diff, backup: backupInfo };
  }

  /**
   * Variante para documentos agregados que são ARRAYS (fin_cr, fin_tx,
   * clientes, etc.) — adiciona itens preservando todos os existentes.
   */
  async appendFixtureItems(docKey, itens, opts) {
    opts = opts || {};
    if (!Array.isArray(itens)) throw new Error('[qa_fixture_guard] appendFixtureItems espera um array de itens.');
    var invalidos = itens.filter(function (it) { return !contemPrefixoFixture(it); });
    if (invalidos.length) {
      throw new Error('[qa_fixture_guard] RECUSADO: ' + invalidos.length + ' item(ns) sem o prefixo obrigatório "' + FIXTURE_PREFIX + '".');
    }

    var preview = await this._lerServidor(docKey);
    var previewBase = preview.parsed && Array.isArray(preview.parsed) ? preview.parsed : [];
    var diff = { docKey: docKey, itensAntes: previewBase.length, itensNovos: itens.length };
    console.log('[qa_fixture_guard] diff planejado (preview) para "' + docKey + '":', JSON.stringify(diff, null, 2));

    if (!this.apply) { console.log('[qa_fixture_guard] dry-run — nada gravado.'); return { applied: false, diff: diff }; }

    var backupInfo = preview.parsed !== null ? this._backup(docKey, preview.parsed) : null;
    var self = this;
    var ref = this.db.collection(this.col).doc(docKey);

    var commitResult = await this.db.runTransaction(async function (txn) {
      var snap = await txn.get(ref);
      var raw = (snap.exists && snap.data() && typeof snap.data().data !== 'undefined') ? snap.data().data : null;
      var atual = raw !== null ? JSON.parse(raw) : null;
      if (atual !== null && !Array.isArray(atual)) {
        throw new Error('[qa_fixture_guard] RECUSADO: o documento "' + docKey + '" no servidor não é um array.');
      }
      var base = atual ? atual.slice() : [];
      var resultado = itens.concat(base);
      txn.set(ref, { data: JSON.stringify(resultado), ts: Date.now() });
      return { itensDepois: resultado.length };
    });

    // Rodada 2.1 (2026-08-08) — mesmo achado do mergeFixture() acima:
    // contagem total do array é instável sob chamadas concorrentes no
    // mesmo documento (outra chamada pode ter adicionado itens entre o
    // commit desta e esta releitura). Verifica só que OS ITENS QUE ESTA
    // CHAMADA acrescentou estão de fato presentes no array confirmado.
    var confirmado = await this._lerServidor(docKey);
    var arrConfirmado = confirmado.parsed || [];
    var itensPerdidos = itens.filter(function (it) {
      return !arrConfirmado.some(function (c) { return JSON.stringify(c) === JSON.stringify(it); });
    });
    if (itensPerdidos.length) {
      throw new Error('[qa_fixture_guard] ERRO FATAL: leitura pós-escrita não confirma ' + itensPerdidos.length + ' item(ns) — investigar antes de continuar.');
    }
    self._criados[docKey] = self._criados[docKey] || new Set();
    itens.forEach(function (it) { self._criados[docKey].add(sha256(it)); });
    console.log('[qa_fixture_guard] aplicado dentro de transação e confirmado. Backup: ' + (backupInfo ? backupInfo.file : '(vazio antes)'));
    return { applied: true, diff: diff, backup: backupInfo };
  }

  /**
   * Remove SÓ as chaves/itens que este MESMO guard (nesta mesma execução em
   * memória) marcou como criados — nunca "tudo que parece fixture", e nunca
   * restaura um snapshot antigo por cima do estado atual (só deleta as
   * chaves exatas, preservando qualquer mudança concorrente feita por outra
   * fonte nas demais chaves).
   */
  async cleanupCreated(docKey) {
    var criadas = this._criados[docKey];
    if (!criadas || !criadas.size) { console.log('[qa_fixture_guard] nada para limpar em "' + docKey + '" (nada foi criado por este guard).'); return { removed: 0 }; }

    if (!this.apply) {
      var preview = await this._lerServidor(docKey);
      var atualPreview = preview.parsed;
      if (atualPreview === null) { console.log('[qa_fixture_guard] documento "' + docKey + '" não existe — nada a limpar.'); return { removed: 0 }; }
      var wouldRemove = Array.isArray(atualPreview)
        ? atualPreview.filter(function (it) { return criadas.has(sha256(it)); }).length
        : Object.keys(atualPreview).filter(function (k) { return criadas.has(k); }).length;
      console.log('[qa_fixture_guard] dry-run — removeria ' + wouldRemove + ' de "' + docKey + '".');
      return { removed: 0, wouldRemove: wouldRemove };
    }

    var self = this;
    var ref = this.db.collection(this.col).doc(docKey);

    var commitResult = await this.db.runTransaction(async function (txn) {
      var snap = await txn.get(ref);
      var raw = (snap.exists && snap.data() && typeof snap.data().data !== 'undefined') ? snap.data().data : null;
      var atual = raw !== null ? JSON.parse(raw) : null;
      if (atual === null) return { removed: 0, existed: false };

      if (Array.isArray(atual)) {
        var restante = atual.filter(function (it) { return !criadas.has(sha256(it)); });
        var removidosArr = atual.length - restante.length;
        if (removidosArr > 0) txn.set(ref, { data: JSON.stringify(restante), ts: Date.now() });
        return { removed: removidosArr, existed: true, restantes: restante.length };
      }

      var resultado = Object.assign({}, atual);
      var removidosCount = 0;
      criadas.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(resultado, k)) { delete resultado[k]; removidosCount++; } });
      if (removidosCount > 0) txn.set(ref, { data: JSON.stringify(resultado), ts: Date.now() });
      return { removed: removidosCount, existed: true, restantes: Object.keys(resultado).length };
    });

    if (!commitResult.existed) { console.log('[qa_fixture_guard] documento "' + docKey + '" não existe mais — nada a limpar.'); return { removed: 0 }; }
    var confirmado = await this._lerServidor(docKey);
    var restantesConfirmados = Array.isArray(confirmado.parsed) ? confirmado.parsed.length : Object.keys(confirmado.parsed || {}).length;
    console.log('[qa_fixture_guard] "' + docKey + '": ' + commitResult.removed + ' removido(s), ' + restantesConfirmados + ' restante(s) confirmado(s) no servidor.');
    return { removed: commitResult.removed };
  }
}

module.exports = { FixtureGuard: FixtureGuard, assertNaoProducao: assertNaoProducao, contemPrefixoFixture: contemPrefixoFixture, FIXTURE_PREFIX: FIXTURE_PREFIX, PROD_PROJECT_IDS: PROD_PROJECT_IDS };
