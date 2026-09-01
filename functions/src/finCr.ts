/**
 * finCr.ts — HARDENING DE CONFIDENCIALIDADE FINANCEIRA (2026-08-26).
 *
 * Antes desta rodada, o perfil Comercial tinha leitura E escrita diretas
 * (via Firestore Rules) do documento inteiro erp_vr/fin_cr — Contas a
 * Receber de TODA a empresa, não só as do próprio vendedor/orçamento. Isso
 * existia porque 5 ações legítimas de Comercial precisavam ler+regravar
 * esse array dentro de uma transação client-side (Firestore exige
 * permissão de leitura para fazer um `txn.get()` antes do `txn.set()`).
 *
 * Este módulo move essas 5 ações — e a única leitura legítima que restava
 * (histórico de recebimentos de UM orçamento específico) — para Cloud
 * Functions com Admin SDK, mesmo padrão já em produção em
 * producaoIniciarOuEditar()/compras.ts: getCallerVerificado() nunca confia
 * em role enviada pelo client, requireRole() decide quem pode chamar cada
 * uma, e o Admin SDK ignora Rules por natureza — então a Firestore Rule de
 * erp_vr/fin_cr pôde voltar a ser só Financeiro (ver firestore.rules).
 *
 * NENHUMA lógica de negócio foi reinventada aqui — cada função abaixo é um
 * porte quase literal da função client-side equivalente (citada no
 * comentário de cada uma), só trocando "transação no navegador, Rules
 * decidem" por "transação no servidor, Admin SDK sempre pode". O
 * armazenamento continua exatamente o mesmo (um documento único por
 * coleção, blob JSON em `data`) — nenhuma migração de dado, nenhum
 * consumidor de Financeiro/Master/DRE/Dashboard foi tocado.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { CallerVerificado, getCallerVerificado, requireRole, acquireIdem as acquireIdemShared, writeAudit as writeAuditShared, parseDoc } from "./auth_helper";

const COL = "erp_vr";
const COL_IDEM = "fin_cr_idem_keys";
const COL_AUDIT = "erp_vr_audit_log_fin_cr";

function acquireIdem(key: string): Promise<boolean> {
  return acquireIdemShared(COL_IDEM, key);
}
function writeAudit(action: string, caller: CallerVerificado, detail: Record<string, unknown>): Promise<void> {
  return writeAuditShared(COL_AUDIT, action, caller.uid, caller.role, detail);
}

function moneyToCents(v: unknown): number { return Math.round((Number(v) || 0) * 100); }
function centsToMoney(cents: unknown): number { return (Number(cents) || 0) / 100; }

interface CrEntry {
  id: string;
  cliente: string;
  clienteId?: string;
  orcamentoId?: string | null;
  osId?: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  marca: string;
  metodo: string;
  osRef: string;
  dataCriacao: string;
  dataRecebimento: string | null;
}
interface TxEntry {
  data: string; cliente: string; os: string; orcamentoId?: string | null;
  marca: string; valor: number; metodo: string; status: string; dia: number; sem: number; mes: number;
}

function dataHojeBR(): string {
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${hoje.getFullYear()}`;
}

// ══════════════════════════════════════════════════════════════════════════
// finCrConfirmarPagamento — porte de orcRegistrarSituacaoFinanceira()/
// aplicarCRTx() (index.html). Comercial confirma como um orçamento
// aprovado foi efetivamente pago (entrada+restante, ou "a receber"
// integral). Cria as entradas iniciais de fin_cr, nunca mais de uma vez
// por orçamento (idempotência real: checada contra orcamentos.pgtoConfirmado
// dentro da própria transação, igual ao client fazia).
// ══════════════════════════════════════════════════════════════════════════
export const finCrConfirmarPagamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial", "financeiro"], "confirmar pagamento de orçamento");

  const orcId = String(data?.orcId || "");
  const tipo = String(data?.tipo || "");
  const forma = String(data?.forma || "");
  const valorEfetivo = Number(data?.valorEfetivo) || 0;
  const valorEntrada = Number(data?.valorEntrada) || 0;
  const restante = Number(data?.restante) || 0;
  const obs = data?.obs ? String(data.obs) : "";
  const nf = data?.nf ? String(data.nf) : "";
  // Campos já normalizados pelo client (orcEnvNormalizar), que já os exibe
  // na tela — mesmo nível de confiança que qualquer outro dado de
  // orçamento que Comercial já lê/escreve livremente via Rules próprias.
  const cliente = String(data?.cliente || "Cliente");
  const numOrc = String(data?.numOrc || "");
  const prodNome = String(data?.prodNome || "Produto");
  const marca = String(data?.marca || "vr");

  if (!orcId) throw new functions.https.HttpsError("invalid-argument", "orcId obrigatório.");
  if (!["50-50", "futuro", "avista", "parcial"].includes(tipo) && tipo.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "tipo obrigatório.");
  }
  if (valorEntrada < 0 || restante < 0 || valorEfetivo < 0) {
    throw new functions.https.HttpsError("invalid-argument", "Valores não podem ser negativos.");
  }

  const db = admin.firestore();
  const refOrc = db.collection(COL).doc("orcamentos");
  const refCR = db.collection(COL).doc("fin_cr");
  const refTx = db.collection(COL).doc("fin_tx");
  const dia = dataHojeBR();

  try {
    const resultado = await db.runTransaction(async (txn) => {
      const [snapOrc, snapCR, snapTx] = await Promise.all([txn.get(refOrc), txn.get(refCR), txn.get(refTx)]);
      const arrOrc = parseDoc<any[]>(snapOrc, []);
      const arrCR = parseDoc<CrEntry[]>(snapCR, []);
      const arrTx = parseDoc<TxEntry[]>(snapTx, []);

      const idxOrc = arrOrc.findIndex((x) => x.id === orcId);
      if (idxOrc < 0) throw new functions.https.HttpsError("not-found", "ORC_NAO_ENCONTRADO");
      const orc = arrOrc[idxOrc];

      // Idempotência REAL: mesmo comportamento do client — checa contra o
      // documento fresco do servidor, dentro da própria transação.
      if (orc.pgtoConfirmado) {
        return { ok: true, jaConfirmado: true, dados: orc.pgtoConfirmado, semGravar: true };
      }

      let txMutado = false;
      if (valorEntrada > 0) {
        if (orc.crId) {
          const idxOld = arrCR.findIndex((c) => c.id === orc.crId);
          if (idxOld >= 0) arrCR.splice(idxOld, 1);
        }
        const nowMs = Date.now();
        arrCR.unshift({
          id: "cr" + nowMs, cliente, clienteId: "", orcamentoId: orcId, osId: "",
          descricao: "Entrada ORC #" + numOrc + " — " + prodNome, valor: valorEntrada,
          vencimento: dia, status: "recebido", marca, metodo: forma, osRef: "",
          dataCriacao: dia, dataRecebimento: dia,
        });
        if (restante > 0) {
          arrCR.unshift({
            id: "cr" + (nowMs + 1), cliente, clienteId: "", orcamentoId: orcId, osId: "",
            descricao: "Restante ORC #" + numOrc + " — " + prodNome, valor: restante,
            vencimento: dia, status: "pendente", marca, metodo: forma, osRef: "",
            dataCriacao: dia, dataRecebimento: null,
          });
        }
        arrTx.unshift({
          data: dia.slice(0, 5), cliente, os: "", orcamentoId: orcId, marca, valor: valorEntrada,
          metodo: forma, status: "recebido", dia: 1, sem: 1, mes: new Date().getMonth() + 1,
        });
        txMutado = true;
      } else if (tipo === "futuro") {
        const idxCr = orc.crId ? arrCR.findIndex((c) => c.id === orc.crId) : -1;
        if (idxCr >= 0) {
          arrCR[idxCr].valor = valorEfetivo;
          arrCR[idxCr].metodo = forma;
        } else {
          const novoCrId = "cr" + Date.now();
          arrCR.unshift({
            id: novoCrId, cliente, clienteId: "", orcamentoId: orcId, osId: "",
            descricao: "ORC #" + numOrc + " — " + prodNome, valor: valorEfetivo,
            vencimento: dia, status: "pendente", marca, metodo: forma, osRef: "",
            dataCriacao: dia, dataRecebimento: null,
          });
          orc.crId = novoCrId;
        }
      }

      const pgtoConfirmado = {
        tipo, forma, valorEfetivo, valorEntrada, restante, obs, nf,
        confirmadoEm: dia, confirmadoPor: "cf:" + caller.uid,
      };
      orc.pgtoConfirmado = pgtoConfirmado;
      arrOrc[idxOrc] = orc;

      txn.set(refOrc, { data: JSON.stringify(arrOrc), ts: Date.now() });
      txn.set(refCR, { data: JSON.stringify(arrCR), ts: Date.now() });
      if (txMutado) txn.set(refTx, { data: JSON.stringify(arrTx), ts: Date.now() });

      return { ok: true, jaConfirmado: false, dados: pgtoConfirmado, semGravar: false };
    });

    if (!resultado.semGravar) {
      await writeAudit("confirmar_pagamento", caller, { orcId, tipo, valorEntrada, restante });
    }
    return resultado;
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[finCr] finCrConfirmarPagamento erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao confirmar pagamento.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// finCrVincularOS — porte do trecho de fin_cr E fin_tx dentro de
// orcEnvGerarOS() (index.html). O resto dessa função (280+ linhas:
// orcamentos/kb_os/kb_os_fin/erp_os_counter) continua rodando client-side,
// intocado — Comercial já tem Rules próprias para esses 4 documentos. Só
// "vincular as entradas de CR/Tx já criadas à OS recém-gerada" (que exigia
// ler+regravar fin_cr/fin_tx inteiros) migrou para cá. Achado adicional
// desta rodada: fin_tx NUNCA esteve no grant de isComercial() nas Rules
// (só fin_cr estava) — então esse pedaço da transação já falhava
// silenciosamente para contas Comercial reais antes desta correção
// (mascarado nos testes/smoke desta certificação porque sempre rodaram
// como Master, que tem acesso amplo via isFinanceiro()). Migrar para cá
// corrige os dois problemas com a mesma mudança. Chamada como um passo
// best-effort DEPOIS da transação principal confirmar — mesmo idioma já
// usado no mesmo orcEnvGerarOS() para a classificação de itens Vitre: se
// isto falhar, a OS/orçamento já confirmados NUNCA são desfeitos; o
// vínculo pode ser tentado de novo (idempotente — só toca entradas ainda
// sem osId/os).
// ══════════════════════════════════════════════════════════════════════════
export const finCrVincularOS = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial", "financeiro"], "vincular Contas a Receber a uma OS");

  const orcamentoId = String(data?.orcamentoId || "");
  const osId = String(data?.osId || "");
  const osNum = data?.osNum;
  if (!orcamentoId || !osId || osNum === undefined || osNum === null) {
    throw new functions.https.HttpsError("invalid-argument", "orcamentoId, osId e osNum são obrigatórios.");
  }

  const db = admin.firestore();
  const refCR = db.collection(COL).doc("fin_cr");
  const refTx = db.collection(COL).doc("fin_tx");

  try {
    const { vinculadosCR, vinculadosTx } = await db.runTransaction(async (txn) => {
      const [snapCR, snapTx] = await Promise.all([txn.get(refCR), txn.get(refTx)]);
      const arrCR = parseDoc<CrEntry[]>(snapCR, []);
      const arrTx = parseDoc<TxEntry[]>(snapTx, []);
      let nCR = 0, nTx = 0;
      arrCR.forEach((c) => {
        if (c.orcamentoId === orcamentoId && !c.osId) {
          c.osId = osId;
          c.osRef = "OS #" + osNum;
          nCR++;
        }
      });
      arrTx.forEach((t: any) => {
        if (t.orcamentoId === orcamentoId && !t.os) {
          t.os = String(osNum);
          nTx++;
        }
      });
      if (nCR > 0) txn.set(refCR, { data: JSON.stringify(arrCR), ts: Date.now() });
      if (nTx > 0) txn.set(refTx, { data: JSON.stringify(arrTx), ts: Date.now() });
      return { vinculadosCR: nCR, vinculadosTx: nTx };
    });
    if (vinculadosCR > 0 || vinculadosTx > 0) {
      await writeAudit("vincular_os", caller, { orcamentoId, osId, osNum, vinculadosCR, vinculadosTx });
    }
    return { ok: true, vinculados: vinculadosCR, vinculadosTx };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[finCr] finCrVincularOS erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao vincular Contas a Receber à OS.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// finCrReceberSaldo — porte de kbReceberSaldo() (index.html). Caminho
// LEGADO (status='aguardando_saldo', só aceita quitação integral). Mantido
// como função independente — igual ao client, nunca reescrito para usar a
// lógica mais nova de finCrRegistrarRecebimento.
// ══════════════════════════════════════════════════════════════════════════
export const finCrReceberSaldo = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial", "financeiro"], "confirmar recebimento de saldo");

  const osId = String(data?.osId || "");
  if (!osId) throw new functions.https.HttpsError("invalid-argument", "osId obrigatório.");
  const idemKey = "receber_saldo:" + osId + ":" + String(data?.requestId || "");
  if (data?.requestId) {
    const acquired = await acquireIdem(idemKey);
    if (!acquired) return { ok: true, jaProcessado: true };
  }

  const db = admin.firestore();
  const refKb = db.collection(COL).doc("kb_os");
  const refKbFin = db.collection(COL).doc("kb_os_fin");
  const refCr = db.collection(COL).doc("fin_cr");
  const refTx = db.collection(COL).doc("fin_tx");
  const refOrc = db.collection(COL).doc("orcamentos");
  const dia = dataHojeBR();
  const dtCurta = dia.slice(0, 5);

  try {
    const resultado = await db.runTransaction(async (txn) => {
      const [snapKb, snapKbFin, snapCr, snapTx, snapOrc] = await Promise.all([
        txn.get(refKb), txn.get(refKbFin), txn.get(refCr), txn.get(refTx), txn.get(refOrc),
      ]);
      const kbData = parseDoc<Record<string, any>>(snapKb, {});
      const kbFinData = parseDoc<Record<string, any>>(snapKbFin, {});
      let crArr = parseDoc<CrEntry[]>(snapCr, []);
      let txArr = parseDoc<TxEntry[]>(snapTx, []);
      const orcArr = parseDoc<any[]>(snapOrc, []);

      const osServidor = kbData[osId];
      const finServidor = kbFinData[osId] || {};
      if (!osServidor) throw new functions.https.HttpsError("not-found", "OS_NAO_ENCONTRADA");
      if ((finServidor.restante || 0) <= 0) {
        throw new functions.https.HttpsError("failed-precondition", "SALDO_JA_QUITADO");
      }

      const valorRecebido = finServidor.restante || 0;
      osServidor.status = "iniciada";
      finServidor.restante = 0;
      kbData[osId] = osServidor;
      kbFinData[osId] = finServidor;

      const crEntry = crArr.find((c) => c.osRef && c.osRef.indexOf(String(osServidor.num)) >= 0 && c.status === "pendente");
      if (crEntry) { crEntry.status = "recebido"; crEntry.dataRecebimento = dia; }

      const novaTx: TxEntry = {
        data: dtCurta, cliente: osServidor.cliente, os: String(osServidor.num), marca: osServidor.mk || "vr",
        valor: valorRecebido, metodo: finServidor.formaPgto || "PIX", status: "recebido",
        dia: 1, sem: 1, mes: new Date().getMonth() + 1,
      };
      txArr = [novaTx, ...txArr];

      let orcMutado = false;
      if (osServidor.orcRef && Array.isArray(orcArr)) {
        const orcEntry = orcArr.find((o) => o.id === osServidor.orcRef);
        if (orcEntry && orcEntry.status === "aguardando_pagamento") { orcEntry.status = "pago"; orcMutado = true; }
      }

      txn.set(refKb, { data: JSON.stringify(kbData), ts: Date.now() });
      txn.set(refKbFin, { data: JSON.stringify(kbFinData), ts: Date.now() });
      txn.set(refTx, { data: JSON.stringify(txArr), ts: Date.now() });
      if (crEntry) txn.set(refCr, { data: JSON.stringify(crArr), ts: Date.now() });
      if (orcMutado) txn.set(refOrc, { data: JSON.stringify(orcArr), ts: Date.now() });

      return { osNum: osServidor.num, valorRecebido, orcRef: orcMutado ? osServidor.orcRef : null };
    });

    await writeAudit("receber_saldo", caller, { osId, ...resultado });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[finCr] finCrReceberSaldo erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao confirmar recebimento de saldo.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// finCrRegistrarRecebimento — porte de finRegistrarRecebimento() (index.html).
// Rotina canônica atual (aceita pagamento parcial, forma divergente da
// entrada original) — usada tanto por "Todas as OS" (💰 Pagamento) quanto
// pela tela de Contas a Receber (_finCRBaixaConfirmar, Financeiro/Master).
// ══════════════════════════════════════════════════════════════════════════
export const finCrRegistrarRecebimento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial", "financeiro"], "registrar recebimento");

  const osId = String(data?.osId || "");
  const valorPagoCents = moneyToCents(data?.valorPago);
  const forma = data?.forma ? String(data.forma) : "PIX";
  const obs = data?.obs ? String(data.obs) : "";
  const origem = data?.origem ? String(data.origem) : "OS_SALDO";

  if (!osId) throw new functions.https.HttpsError("invalid-argument", "osId obrigatório.");
  if (valorPagoCents <= 0) throw new functions.https.HttpsError("invalid-argument", "Informe um valor de pagamento maior que zero.");

  const db = admin.firestore();
  const refKb = db.collection(COL).doc("kb_os");
  const refKbFin = db.collection(COL).doc("kb_os_fin");
  const refCr = db.collection(COL).doc("fin_cr");
  const refTx = db.collection(COL).doc("fin_tx");
  const refOrc = db.collection(COL).doc("orcamentos");
  // HOTFIX recebimentos canônicos: aceita a data informada pelo operador
  // (recebimento retroativo), mas em formato BR já resolvido — evita
  // portar finCaixaISOtoBR() só para isto; o client já valida o formato.
  const dia = data?.diaBR ? String(data.diaBR) : dataHojeBR();

  try {
    const resultado = await db.runTransaction(async (txn) => {
      const [snapKb, snapKbFin, snapCr, snapTx, snapOrc] = await Promise.all([
        txn.get(refKb), txn.get(refKbFin), txn.get(refCr), txn.get(refTx), txn.get(refOrc),
      ]);
      const kbData = parseDoc<Record<string, any>>(snapKb, {});
      const kbFinData = parseDoc<Record<string, any>>(snapKbFin, {});
      let crArr = parseDoc<CrEntry[]>(snapCr, []);
      let txArr = parseDoc<TxEntry[]>(snapTx, []);
      const orcArr = parseDoc<any[]>(snapOrc, []);

      const osServidor = kbData[osId];
      const finServidor = kbFinData[osId] || {};
      if (!osServidor) throw new functions.https.HttpsError("not-found", "OS_NAO_ENCONTRADA");
      const restanteServidorCents = moneyToCents(finServidor.restante || 0);
      if (restanteServidorCents <= 0) throw new functions.https.HttpsError("failed-precondition", "SALDO_JA_QUITADO");
      if (valorPagoCents > restanteServidorCents) {
        throw new functions.https.HttpsError("failed-precondition", "VALOR_MAIOR_QUE_SALDO:" + centsToMoney(restanteServidorCents));
      }

      const novoRestanteCents = restanteServidorCents - valorPagoCents;
      const quitado = novoRestanteCents <= 0;

      if (quitado && osServidor.status === "aguardando_saldo") osServidor.status = "iniciada";
      finServidor.restante = centsToMoney(novoRestanteCents);
      kbData[osId] = osServidor;
      kbFinData[osId] = finServidor;

      const crEntry = crArr.find((c) => c.osRef && c.osRef.indexOf(String(osServidor.num)) >= 0 && c.status === "pendente");
      if (crEntry) {
        if (quitado) {
          crArr = crArr.filter((c) => c !== crEntry);
        } else {
          crEntry.valor = centsToMoney(novoRestanteCents);
        }
      }

      const descBase = (quitado ? "Pagamento do saldo" : "Pagamento parcial do saldo") + " — OS #" + osServidor.num;
      const novoRecebimento: CrEntry = {
        id: "cr" + Date.now() + "_pgtosaldo", cliente: osServidor.cliente, clienteId: "",
        orcamentoId: osServidor.orcRef || null, osId, descricao: descBase + (obs ? " — " + obs : ""),
        valor: centsToMoney(valorPagoCents), vencimento: dia, status: "recebido",
        marca: osServidor.mk || "vr", metodo: forma, osRef: "OS #" + osServidor.num,
        dataCriacao: dia, dataRecebimento: dia,
      };
      crArr = [novoRecebimento, ...crArr];

      const novaTx: TxEntry = {
        data: dia.slice(0, 5), cliente: osServidor.cliente, os: String(osServidor.num), marca: osServidor.mk || "vr",
        valor: centsToMoney(valorPagoCents), metodo: forma, status: "recebido", dia: 1, sem: 1, mes: new Date().getMonth() + 1,
      };
      txArr = [novaTx, ...txArr];

      let orcMutado = false;
      if (quitado && osServidor.orcRef && Array.isArray(orcArr)) {
        const orcEntry = orcArr.find((o) => o.id === osServidor.orcRef);
        if (orcEntry && orcEntry.status === "aguardando_pagamento") { orcEntry.status = "pago"; orcMutado = true; }
      }

      txn.set(refKb, { data: JSON.stringify(kbData), ts: Date.now() });
      txn.set(refKbFin, { data: JSON.stringify(kbFinData), ts: Date.now() });
      txn.set(refTx, { data: JSON.stringify(txArr), ts: Date.now() });
      txn.set(refCr, { data: JSON.stringify(crArr), ts: Date.now() });
      if (orcMutado) txn.set(refOrc, { data: JSON.stringify(orcArr), ts: Date.now() });

      return { osNum: osServidor.num, valorPago: centsToMoney(valorPagoCents), quitado, restanteAtual: finServidor.restante, orcRef: orcMutado ? osServidor.orcRef : null };
    });

    await writeAudit("registrar_recebimento", caller, { osId, origem, ...resultado });
    return { ok: true, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[finCr] finCrRegistrarRecebimento erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao registrar recebimento.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// finCrAutoAprovarOrcamento — porte do trecho de fin_cr dentro de
// orcEnvSetStatus(id, 'aprovado') (index.html). O restante dessa função
// (gravar orc.status='aprovado' em `orcamentos`) continua client-side,
// intocado — Comercial já tem Rules próprias para orcamentos.
// ══════════════════════════════════════════════════════════════════════════
export const finCrAutoAprovarOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial", "financeiro"], "criar Conta a Receber ao aprovar orçamento");

  const orcId = String(data?.orcId || "");
  const cliente = String(data?.cliente || "(não informado)");
  const numOrc = String(data?.numOrc || "");
  const prodNome = String(data?.prodNome || "Produto");
  const valor = Number(data?.valor) || 0;
  const marca = String(data?.marca || "vr");
  const metodo = String(data?.metodo || "PIX");
  // crId opcional: o client já gera e persiste este id em orcamentos ANTES
  // de chamar esta Function (mesmo guard síncrono contra duplo-clique que
  // já existia em orcEnvSetStatus()) — se vier, é reaproveitado aqui;
  // senão, geramos um novo (fallback para chamadas sem esse pré-passo).
  const crIdSugerido = data?.crId ? String(data.crId) : ("cr" + Date.now());
  if (!orcId) throw new functions.https.HttpsError("invalid-argument", "orcId obrigatório.");
  if (valor < 0) throw new functions.https.HttpsError("invalid-argument", "valor não pode ser negativo.");

  const db = admin.firestore();
  const refCR = db.collection(COL).doc("fin_cr");
  const dia = dataHojeBR();

  try {
    const resultado = await db.runTransaction(async (txn) => {
      const snapCR = await txn.get(refCR);
      const arrCR = parseDoc<CrEntry[]>(snapCR, []);
      const idemDescricao = "ORC #" + numOrc + " — " + prodNome;
      // Idempotência: mesma checagem que o client já fazia via orc.crId —
      // reforçada aqui contra duplicidade (mesmo crId JÁ presente, ou
      // mesma descrição para o mesmo orçamento — cobre chamada 2x/retry).
      const jaExiste = arrCR.find((c) => c.id === crIdSugerido || (c.orcamentoId === orcId && c.descricao === idemDescricao));
      if (jaExiste) return { crId: jaExiste.id, jaExistia: true };

      const crId = crIdSugerido;
      arrCR.unshift({
        id: crId, cliente, clienteId: "", orcamentoId: orcId, descricao: idemDescricao,
        valor, vencimento: dia, status: "pendente", marca, metodo, osRef: "ORC-" + numOrc,
        dataCriacao: dia, dataRecebimento: null,
      });
      txn.set(refCR, { data: JSON.stringify(arrCR), ts: Date.now() });
      return { crId, jaExistia: false };
    });

    if (!resultado.jaExistia) await writeAudit("auto_criar_ao_aprovar", caller, { orcId, valor });
    return { ok: true, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[finCr] finCrAutoAprovarOrcamento erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao criar Conta a Receber.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// finCrCancelarAutoAprovacao — RODADA DE CORREÇÃO DEFINITIVA (2026-09-01),
// Bloco 8. Contraparte de finCrAutoAprovarOrcamento(): usada por
// orcEnvReverterParaAguardando() (index.html) quando um orçamento marcado
// "Aprovado" por engano precisa voltar para "Aguardando Cliente" ANTES de
// qualquer OS/pagamento existir. Auditoria prévia (2026-08-31/09-01)
// confirmou: reverter o status no client, sozinho, nunca desfazia o CR
// pendente criado — o orçamento voltava a "Aguardando" mas o CR ficava
// órfão em Contas a Receber, divergência real entre as duas telas.
//
// Guarda de segurança ABSOLUTA (nunca contorná-la por nenhum motivo): só
// remove o CR se `status==='pendente'` — qualquer traço de pagamento real
// (status 'recebido'/'parcial', ou dataRecebimento preenchida) BLOQUEIA a
// remoção e devolve erro explícito. Nunca apaga dinheiro real recebido.
// ══════════════════════════════════════════════════════════════════════════
export const finCrCancelarAutoAprovacao = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial", "financeiro"], "reverter aprovação de orçamento (cancelar Conta a Receber pendente)");

  const orcId = String(data?.orcId || "");
  const crId = String(data?.crId || "");
  if (!orcId) throw new functions.https.HttpsError("invalid-argument", "orcId obrigatório.");
  if (!crId) throw new functions.https.HttpsError("invalid-argument", "crId obrigatório.");

  const db = admin.firestore();
  const refCR = db.collection(COL).doc("fin_cr");

  try {
    const resultado = await db.runTransaction(async (txn) => {
      const snapCR = await txn.get(refCR);
      const arrCR = parseDoc<CrEntry[]>(snapCR, []);
      const idx = arrCR.findIndex((c) => c.id === crId);
      if (idx < 0) return { removido: false, jaAusente: true };

      const entry = arrCR[idx];
      // Nunca remover um CR que não é mais a mesma coisa que foi criada
      // automaticamente — vincula por orcamentoId também, nunca só pelo id.
      if (entry.orcamentoId && entry.orcamentoId !== orcId) {
        throw new functions.https.HttpsError("failed-precondition", "Esta Conta a Receber não pertence a este orçamento.");
      }
      if (entry.status !== "pendente" || entry.dataRecebimento) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Esta Conta a Receber já tem pagamento registrado — reversão bloqueada para nunca apagar dinheiro real recebido."
        );
      }
      arrCR.splice(idx, 1);
      txn.set(refCR, { data: JSON.stringify(arrCR), ts: Date.now() });
      return { removido: true, jaAusente: false };
    });

    if (resultado.removido) await writeAudit("cancelar_ao_reverter_aprovacao", caller, { orcId, crId });
    return { ok: true, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[finCr] finCrCancelarAutoAprovacao erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao cancelar Conta a Receber.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// finCrHistoricoRecebimento — READ-ONLY. Porte do filtro já usado por
// orcFinanceiroReal() (index.html) — única leitura de fin_cr que Comercial
// legitimamente precisa (histórico de recebimentos de UM orçamento
// específico que já está vendo). Nunca devolve o array completo nem
// nenhum outro cliente — só {data, valorCents, forma, descricao} das
// entradas 'recebido' vinculadas a este orçamento/OS.
// ══════════════════════════════════════════════════════════════════════════
export const finCrHistoricoRecebimento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial", "financeiro"], "consultar histórico de recebimento");

  const orcamentoId = String(data?.orcamentoId || "");
  const osRef = data?.osRef ? String(data.osRef) : "";
  if (!orcamentoId) throw new functions.https.HttpsError("invalid-argument", "orcamentoId obrigatório.");

  const db = admin.firestore();
  const snap = await db.collection(COL).doc("fin_cr").get();
  const arrCR = parseDoc<CrEntry[]>(snap, []);

  // DD/MM/AAAA → chave ordenável AAAAMMDD (mesmo resultado de
  // orcEnvParseDataSalvo(), sem portar o parser inteiro por causa de 1 sort).
  function chaveOrdenavel(dBR: string): string {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dBR || "");
    return m ? m[3] + m[2] + m[1] : "";
  }
  const historico = arrCR
    .filter((c) => c.status === "recebido" && (c.orcamentoId === orcamentoId || (osRef && c.osId === osRef)))
    .map((c) => ({ data: c.dataRecebimento || c.dataCriacao || "", valorCents: moneyToCents(c.valor || 0), forma: c.metodo || "—", descricao: c.descricao || "" }))
    .sort((a, b) => chaveOrdenavel(a.data).localeCompare(chaveOrdenavel(b.data)));

  return { ok: true, historico };
});
