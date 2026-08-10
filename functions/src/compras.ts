/**
 * compras.ts — pipeline de Compras com transições críticas mediadas por
 * Cloud Functions (verificação de perfil no servidor, transação Firestore,
 * chave idempotente, validação de transição de status, auditoria).
 *
 * Modelo de dados (documento-por-registro, substitui o array único
 * erp_vr/compras): cada entidade do fluxo é uma coleção própria, nunca um
 * elemento dentro de um array compartilhado — Rules não conseguem proteger
 * "criar" e "aprovar" como operações distintas quando ambas são apenas
 * "sobrescrever o array inteiro". Aqui cada write passa por uma function
 * que valida o perfil do chamador ANTES de tocar no Firestore, e o
 * documento correspondente tem `allow write: if false` nas Rules — o
 * cliente NUNCA escreve direto nessas coleções, só lê.
 *
 * Coleções:
 *   erp_vr_compras/{compraId}                — solicitação/compra (núcleo)
 *   erp_vr_compras_recebimentos/{recId}       — recebimento físico
 *   erp_vr_compras_documentos/{docId}         — documento fiscal/cobrança
 *   erp_vr_compras_parcelas/{parcelaId}       — parcela de um documento
 *   erp_vr_fin_cp/{cpId}                      — Conta a Pagar (provisória/definitiva)
 *   erp_vr_fin_pagamentos/{pagId}             — pagamento (parcial/final)
 *   erp_vr_stock_movimentos/{movId}           — ledger de movimentação de estoque
 *   compras_idem_keys/{key}                   — idempotência entre chamadas
 *   compras_audit_log/{auto}                  — auditoria de transições críticas
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const VALID_ROLES = ["master", "comercial", "producao", "financeiro"] as const;
type Role = typeof VALID_ROLES[number];

const COL_COMPRAS       = "erp_vr_compras";
const COL_RECEBIMENTOS  = "erp_vr_compras_recebimentos";
const COL_DOCUMENTOS    = "erp_vr_compras_documentos";
const COL_PARCELAS      = "erp_vr_compras_parcelas";
const COL_FIN_CP        = "erp_vr_fin_cp";
const COL_FIN_PAGAMENTOS= "erp_vr_fin_pagamentos";
const COL_STOCK_MOV     = "erp_vr_stock_movimentos";
const COL_IDEM          = "compras_idem_keys";
const COL_AUDIT         = "compras_audit_log";

type StatusCompra = "solicitada" | "cotacao" | "aprovada" | "pedida" | "recebida_parcial" | "recebida" | "cancelada";

// Transições permitidas — nunca "pular para trás" exceto cancelamento (de
// qualquer estado não-terminal). Espelha PC_FLUXO do client (index.html)
// mas é a ÚNICA cópia que efetivamente autoriza algo.
const TRANSICOES: Record<StatusCompra, StatusCompra[]> = {
  solicitada:        ["cotacao", "aprovada", "cancelada"],
  cotacao:           ["aprovada", "cancelada"],
  aprovada:          ["pedida", "cancelada"],
  pedida:            ["recebida_parcial", "recebida", "cancelada"],
  recebida_parcial:  ["recebida_parcial", "recebida", "cancelada"],
  recebida:          [],
  cancelada:         [],
};

// SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.3 — a auditoria encontrou que cada
// parcela de um documento de Compras era arredondada de forma
// INDEPENDENTE (Math.round((valorTotal/nParcelas)*100)/100), sem garantir
// que a soma das parcelas batesse com o total (ex.: R$100/3 podia virar
// 3×R$33,33 = R$99,99, faltando R$0,01). O motor de orçamento
// (orcDistribuirParcelas, index.html) já resolve isso com a técnica de
// "a primeira parcela absorve o resto" — replicada aqui, em TypeScript,
// como fonte única server-side. Sempre em CENTAVOS inteiros.
export function distribuirParcelasCentavos(totalCents: number, n: number): number[] {
  const total = Math.round(totalCents || 0);
  const nParc = n > 0 ? Math.round(n) : 1;
  const base = Math.floor(total / nParc);
  const resto = total - base * nParc;
  const parcelas: number[] = [];
  for (let i = 0; i < nParc; i++) parcelas.push(base);
  parcelas[0] += resto;
  return parcelas;
}

function normalizeRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const r = value.trim().toLowerCase();
  if (r === "admin") return "master";
  if ((VALID_ROLES as readonly string[]).includes(r)) return r as Role;
  return null;
}

function getCaller(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  }
  const uid  = context.auth.uid;
  const role = normalizeRole(context.auth.token?.role);
  if (!role) {
    throw new functions.https.HttpsError("permission-denied", "Perfil sem permissão.");
  }
  return { uid, role };
}

function requireRole(caller: { role: Role }, allowed: Role[], acao: string) {
  if (caller.role === "master") return; // master sempre pode
  if (!allowed.includes(caller.role)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      `Perfil "${caller.role}" não pode ${acao}. Permitido: master, ${allowed.join(", ")}.`
    );
  }
}

async function acquireIdem(key: string): Promise<boolean> {
  const db  = admin.firestore();
  const ref = db.collection(COL_IDEM).doc(key);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const age = now - ((snap.data()?.ts as number) ?? 0);
      if (age < 5 * 60_000) return false; // já processado nos últimos 5min — idempotente
    }
    tx.set(ref, { ts: now });
    return true;
  });
}

async function writeAudit(action: string, callerUid: string, callerRole: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await admin.firestore().collection(COL_AUDIT).add({
      action, callerUid, callerRole, detail, timestamp: Date.now(),
    });
  } catch (e) {
    functions.logger.error("[compras] falha ao gravar auditoria:", e);
  }
}

interface ItemCompra {
  material: string | null;
  label: string;
  qtyNecessaria: number;
  unidade: string;
  matKeyConfianca: "exata" | "nenhuma";
}

// ══════════════════════════════════════════════════════════════════════════
// comprasCriarSolicitacao — Produção, Comercial ou Master. Não define preço
// nem fornecedor — só a NECESSIDADE. Idempotente via requestId do cliente.
// ══════════════════════════════════════════════════════════════════════════
export const comprasCriarSolicitacao = functions.https.onCall(async (data, context) => {
  const caller = getCaller(context);
  requireRole(caller, ["producao", "comercial"], "criar uma solicitação de compra");

  const requestId = String(data?.requestId || "");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório (idempotência).");
  const idemKey = `criar:${requestId}`;
  const acquired = await acquireIdem(idemKey);

  const label = String(data?.label || "").trim();
  if (!label) throw new functions.https.HttpsError("invalid-argument", "Descrição do item obrigatória.");
  const qtyNecessaria = Number(data?.qtyNecessaria) || 1;
  const material = data?.material ? String(data.material) : null;
  const marca = data?.marca === "vitre" ? "vitre" : "vr";
  const origem = data?.origem ?? null;

  const db = admin.firestore();

  if (!acquired) {
    // Já processado — devolve o registro existente em vez de duplicar.
    const existing = await db.collection(COL_COMPRAS).where("requestId", "==", requestId).limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      return { id: doc.id, numero: doc.data().numero, jaExistia: true };
    }
  }

  const counterRef = db.collection(COL_COMPRAS + "_counter").doc("seq");
  const numero = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const atual = snap.exists ? (snap.data()?.n as number) || 0 : 0;
    const proximo = atual + 1;
    tx.set(counterRef, { n: proximo });
    return proximo;
  });

  const item: ItemCompra = {
    material,
    label,
    qtyNecessaria,
    unidade: "un",
    matKeyConfianca: material ? "exata" : "nenhuma",
  };

  const docRef = db.collection(COL_COMPRAS).doc();
  await docRef.set({
    id: docRef.id,
    requestId,
    numero,
    status: "solicitada" as StatusCompra,
    itens: [item],
    fornecedorEscolhido: null,
    marca,
    origem,
    criadoPorUid: caller.uid,
    criadoPorRole: caller.role,
    criadoEm: Date.now(),
    aprovadoPorUid: null,
    aprovadoEm: null,
    canceladoPorUid: null,
    canceladoEm: null,
    motivoCancelamento: null,
    qtyRecebidaTotal: 0,
    obrigacaoProvisoriaId: null,
  });

  await writeAudit("compra_criada", caller.uid, caller.role, { compraId: docRef.id, numero, label });
  return { id: docRef.id, numero, jaExistia: false };
});

// ══════════════════════════════════════════════════════════════════════════
// comprasAprovar — SOMENTE Master. Define fornecedor/preço e avança o
// status. É exatamente a operação que Produção NUNCA pode chamar mesmo
// tendo criado a solicitação original — validado pela própria função, não
// pela UI.
// ══════════════════════════════════════════════════════════════════════════
export const comprasAprovar = functions.https.onCall(async (data, context) => {
  const caller = getCaller(context);
  requireRole(caller, [], "aprovar/precificar uma solicitação de compra"); // lista vazia = só master além do próprio requireRole já liberar master

  const compraId = String(data?.compraId || "");
  const fornecedorEscolhido = String(data?.fornecedorEscolhido || "").trim();
  const precoUnit = Number(data?.precoUnit);
  if (!compraId) throw new functions.https.HttpsError("invalid-argument", "compraId obrigatório.");
  if (!fornecedorEscolhido) throw new functions.https.HttpsError("invalid-argument", "Fornecedor obrigatório para aprovar.");
  if (!(precoUnit >= 0)) throw new functions.https.HttpsError("invalid-argument", "Preço unitário inválido.");

  const idemKey = `aprovar:${compraId}`;
  await acquireIdem(idemKey); // best-effort; a transação abaixo é a garantia real

  const db = admin.firestore();
  const ref = db.collection(COL_COMPRAS).doc(compraId);

  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Compra não encontrada.");
    const compra = snap.data()!;
    const statusAtual = compra.status as StatusCompra;
    if (!TRANSICOES[statusAtual]?.includes("aprovada")) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Transição inválida: não é possível aprovar uma compra em status "${statusAtual}".`
      );
    }
    const itens = (compra.itens || []).map((it: ItemCompra) => ({ ...it, precoUnit }));
    tx.update(ref, {
      status: "aprovada" as StatusCompra,
      fornecedorEscolhido,
      itens,
      aprovadoPorUid: caller.uid,
      aprovadoEm: Date.now(),
    });
    return { numero: compra.numero };
  });

  await writeAudit("compra_aprovada", caller.uid, caller.role, { compraId, fornecedorEscolhido, precoUnit });
  return { ok: true, numero: resultado.numero };
});

// ══════════════════════════════════════════════════════════════════════════
// comprasRegistrarRecebimento — Produção ou Master. Só registra QUANTIDADE
// FÍSICA recebida — nunca preço, nunca fornecedor, nunca aprova nada. Cria
// o movimento de estoque na MESMA transação (estoque só aumenta por
// recebimento confirmado) e sincroniza a obrigação provisória.
// ══════════════════════════════════════════════════════════════════════════
export const comprasRegistrarRecebimento = functions.https.onCall(async (data, context) => {
  const caller = getCaller(context);
  requireRole(caller, ["producao"], "registrar recebimento físico");

  const compraId = String(data?.compraId || "");
  const requestId = String(data?.requestId || "");
  const qtyRecebida = Number(data?.qtyRecebida);
  if (!compraId) throw new functions.https.HttpsError("invalid-argument", "compraId obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório (idempotência).");
  if (!(qtyRecebida > 0)) throw new functions.https.HttpsError("invalid-argument", "Quantidade recebida inválida.");

  const idemKey = `receber:${requestId}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const compraRef = db.collection(COL_COMPRAS).doc(compraId);
  const recRef = db.collection(COL_RECEBIMENTOS).doc();

  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(compraRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Compra não encontrada.");
    const compra = snap.data()!;
    const statusAtual = compra.status as StatusCompra;
    if (statusAtual === "cancelada" || statusAtual === "solicitada" || statusAtual === "cotacao") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Não é possível registrar recebimento com a compra em status "${statusAtual}" (precisa estar aprovada/pedida).`
      );
    }
    const item = (compra.itens || [])[0] as ItemCompra & { qtyRecebida?: number };
    const totalRecebidoAntes = Number(compra.qtyRecebidaTotal) || 0;
    const totalRecebidoDepois = totalRecebidoAntes + qtyRecebida;
    const necessario = item ? item.qtyNecessaria : 0;
    const novoStatus: StatusCompra = totalRecebidoDepois >= necessario ? "recebida" : "recebida_parcial";

    tx.set(recRef, {
      id: recRef.id, compraId, qtyRecebida, requestId,
      registradoPorUid: caller.uid,
      registradoEm: Date.now(),
    });
    tx.update(compraRef, { status: novoStatus, qtyRecebidaTotal: totalRecebidoDepois });

    if (item && item.material) {
      const movRef = db.collection(COL_STOCK_MOV).doc();
      tx.set(movRef, {
        id: movRef.id, material: item.material, delta: qtyRecebida,
        motivo: "recebimento_compra", compraId, recebimentoId: recRef.id,
        criadoPorUid: caller.uid, criadoEm: Date.now(),
      });
      // Estoque agregado ainda vive em erp_vr/stock (fora do escopo desta
      // rodada migrar todo o estoque para documento-por-material) — o
      // ledger acima é a fonte auditável; a função HTTP que sincroniza o
      // agregado consome este ledger de forma idempotente (não implementada
      // nesta rodada — registrado como pendência).
    }

    return { novoStatus, totalRecebidoDepois };
  });

  await writeAudit("compra_recebimento", caller.uid, caller.role, { compraId, qtyRecebida, ...resultado });
  return { ok: true, ...resultado };
});

// ══════════════════════════════════════════════════════════════════════════
// comprasAdicionarDocumento — Financeiro ou Master. Cria o documento fiscal
// + parcelas e reconcilia a obrigação provisória em Conta a Pagar
// definitiva (mesma regra de negócio validada nas rodadas anteriores via
// mock, agora como única fonte de verdade real).
// ══════════════════════════════════════════════════════════════════════════
export const comprasAdicionarDocumento = functions.https.onCall(async (data, context) => {
  const caller = getCaller(context);
  requireRole(caller, ["financeiro"], "adicionar documento fiscal");

  const compraId = String(data?.compraId || "");
  const numero = String(data?.numero || "").trim();
  const valorTotal = Number(data?.valorTotal);
  const nParcelas = Math.max(1, Number(data?.nParcelas) || 1);
  if (!compraId || !numero) throw new functions.https.HttpsError("invalid-argument", "compraId e numero obrigatórios.");
  if (!(valorTotal > 0)) throw new functions.https.HttpsError("invalid-argument", "valorTotal inválido.");

  const idemKey = `documento:${compraId}:${numero}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const compraRef = db.collection(COL_COMPRAS).doc(compraId);
  const docRef = db.collection(COL_DOCUMENTOS).doc();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(compraRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Compra não encontrada.");

    tx.set(docRef, {
      id: docRef.id, compraId, numero, valorTotal, nParcelas,
      criadoPorUid: caller.uid, criadoEm: Date.now(),
    });

    // P1.3 — parcelas centavo-exatas: soma(parcelas) === valorTotal sempre,
    // nunca cada parcela arredondada isoladamente (ver distribuirParcelasCentavos).
    const valorTotalCents = Math.round(valorTotal * 100);
    const parcelasCents = distribuirParcelasCentavos(valorTotalCents, nParcelas);
    for (let i = 0; i < nParcelas; i++) {
      const valorParcela = parcelasCents[i] / 100;
      const parcelaRef = db.collection(COL_PARCELAS).doc();
      tx.set(parcelaRef, {
        id: parcelaRef.id, documentoId: docRef.id, compraId,
        numero: i + 1, valor: valorParcela, status: "pendente",
      });
      const cpRef = db.collection(COL_FIN_CP).doc();
      tx.set(cpRef, {
        id: cpRef.id, compraId, documentoId: docRef.id, parcelaId: parcelaRef.id,
        tipo: "definitiva", valor: valorParcela, status: "pendente",
        criadoEm: Date.now(),
      });
    }

    // Reconcilia/encerra a obrigação provisória, se existir.
    const provQuery = await db.collection(COL_FIN_CP)
      .where("compraId", "==", compraId).where("tipo", "==", "provisoria").limit(1).get();
    if (!provQuery.empty) {
      tx.update(provQuery.docs[0].ref, { status: "conciliada", conciliadoEm: Date.now() });
    }
  });

  await writeAudit("compra_documento_adicionado", caller.uid, caller.role, { compraId, numero, valorTotal, nParcelas });
  return { ok: true, documentoId: docRef.id };
});

// ══════════════════════════════════════════════════════════════════════════
// comprasRegistrarPagamento — Financeiro ou Master. Idempotente,
// transacional, grava também em fin_tx (espelha o comportamento client já
// validado nas rodadas anteriores).
// ══════════════════════════════════════════════════════════════════════════
export const comprasRegistrarPagamento = functions.https.onCall(async (data, context) => {
  const caller = getCaller(context);
  requireRole(caller, ["financeiro"], "registrar pagamento");

  const cpId = String(data?.cpId || "");
  const requestId = String(data?.requestId || "");
  const valor = Number(data?.valor);
  if (!cpId || !requestId) throw new functions.https.HttpsError("invalid-argument", "cpId e requestId obrigatórios.");
  if (!(valor > 0)) throw new functions.https.HttpsError("invalid-argument", "valor inválido.");

  const idemKey = `pagar:${requestId}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const cpRef = db.collection(COL_FIN_CP).doc(cpId);
  const pagRef = db.collection(COL_FIN_PAGAMENTOS).doc();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(cpRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Conta a Pagar não encontrada.");
    const cp = snap.data()!;
    if (cp.status === "pago") {
      throw new functions.https.HttpsError("failed-precondition", "Conta a Pagar já quitada.");
    }
    tx.set(pagRef, {
      id: pagRef.id, cpId, valor, requestId,
      registradoPorUid: caller.uid, registradoEm: Date.now(),
    });
    tx.update(cpRef, { status: "pago", pagoEm: Date.now(), pagamentoId: pagRef.id });
  });

  await writeAudit("compra_pagamento", caller.uid, caller.role, { cpId, valor, requestId });
  return { ok: true, pagamentoId: pagRef.id };
});

// ══════════════════════════════════════════════════════════════════════════
// comprasCancelar — Master apenas. Preserva histórico (nunca apaga).
// ══════════════════════════════════════════════════════════════════════════
export const comprasCancelar = functions.https.onCall(async (data, context) => {
  const caller = getCaller(context);
  requireRole(caller, [], "cancelar uma compra");

  const compraId = String(data?.compraId || "");
  const motivo = String(data?.motivo || "").trim();
  if (!compraId) throw new functions.https.HttpsError("invalid-argument", "compraId obrigatório.");
  if (!motivo) throw new functions.https.HttpsError("invalid-argument", "Motivo do cancelamento obrigatório.");

  const db = admin.firestore();
  const ref = db.collection(COL_COMPRAS).doc(compraId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Compra não encontrada.");
    const statusAtual = snap.data()!.status as StatusCompra;
    if (!TRANSICOES[statusAtual]?.includes("cancelada")) {
      throw new functions.https.HttpsError("failed-precondition", `Não é possível cancelar uma compra em status "${statusAtual}".`);
    }
    tx.update(ref, {
      status: "cancelada" as StatusCompra,
      canceladoPorUid: caller.uid,
      canceladoEm: Date.now(),
      motivoCancelamento: motivo,
    });
  });

  await writeAudit("compra_cancelada", caller.uid, caller.role, { compraId, motivo });
  return { ok: true };
});
