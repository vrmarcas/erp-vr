/**
 * estoque.ts — fronteira server-side para o restante da superfície de
 * escrita de estoque/retalhos que producaoIniciarOuEditar não cobria.
 *
 * Achado (auditoria Fase F, FASE 2 desta rodada): fora do fluxo de
 * início/edição de produção (já corrigido em producao.ts), o frontend
 * ainda escrevia diretamente em erp_vr/stock, erp_vr/retalhos e
 * erp_vr/erp_stock_log a partir de pelo menos 9 funções distintas, sem
 * transação, sem idempotência, sem auditoria e sem qualquer verificação de
 * papel além do que a UI escondia/mostrava (nenhuma delas tinha um "if
 * (role!=='master') throw" — a Rules do Firestore é quem de fato decidia,
 * e ela permite isProducao() — produção, master ou admin — escrever esses
 * documentos inteiros, sem validar conteúdo). Este arquivo move cada uma
 * dessas escritas para uma Cloud Function dedicada, reaproveitando a
 * mesma fronteira de identidade de auth_helper.ts (context.auth apenas,
 * nunca payload) e o mesmo padrão de transação de producao.ts.
 *
 * Não é uma reescrita de modelo de dados — os documentos continuam
 * agregados (erp_vr/stock, erp_vr/retalhos, erp_vr/erp_stock_log), como em
 * producao.ts. Reescrever para documento-por-registro é escopo maior,
 * documentado como pendência futura (mesmo racional do Compras v2).
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { CallerVerificado, getCallerVerificado, requireRole, acquireIdem as acquireIdemShared, writeAudit as writeAuditShared, parseDoc } from "./auth_helper";

const COL = "erp_vr";
const COL_IDEM = "estoque_idem_keys";
const COL_AUDIT = "erp_vr_audit_log_estoque";

function acquireIdem(key: string): Promise<boolean> {
  return acquireIdemShared(COL_IDEM, key);
}
function writeAudit(action: string, callerUid: string, callerRole: string, detail: Record<string, unknown>): Promise<void> {
  return writeAuditShared(COL_AUDIT, action, callerUid, callerRole, detail);
}

interface StockItem { label: string; qty: number; cor?: string; esp?: number; min?: number; max?: number; }
interface Retalho { mat: string; label: string; dims: string; qty: number; data?: string; obs?: string; codigo?: string; }
interface LogEntry {
  tipo: string; matKey: string; matLabel: string; qty: number; os?: unknown; obs: string; dt: string;
  finalidade: string; idempotencyKey: string; ts: number; usuario: string;
  autorizadoPorUid?: string; autorizadoPorRole?: string;
}

function nowDt(): string {
  const now = new Date();
  return now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function buildLog(
  tipo: string, matKey: string, matLabel: string, qty: number, obs: string, finalidade: string,
  idemKeyEntry: string, caller: CallerVerificado
): LogEntry {
  return {
    tipo, matKey: matKey || "", matLabel: matLabel || matKey || "", qty, obs: obs || "", dt: nowDt(),
    finalidade, idempotencyKey: idemKeyEntry, ts: Date.now(), usuario: caller.uid,
    autorizadoPorUid: caller.uid, autorizadoPorRole: caller.role,
  };
}

function refs(db: FirebaseFirestore.Firestore) {
  return {
    stockRef: db.collection(COL).doc("stock"),
    retRef: db.collection(COL).doc("retalhos"),
    logRef: db.collection(COL).doc("erp_stock_log"),
    tombRef: db.collection(COL).doc("stock_deleted"),
  };
}

function appendLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  const out = [entry].concat(log);
  if (out.length > 200) out.length = 200;
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// estoqueRegistrarEntrada — entrada manual/recebimento (cobre
// stockConfirmarEntrada). Só incrementa; sem exceção de saldo negativo
// porque este caminho nunca decrementa.
// ══════════════════════════════════════════════════════════════════════════
export const estoqueRegistrarEntrada = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "registrar entrada de estoque");

  const d = (data || {}) as Record<string, unknown>;
  const matKey = String(d.matKey || "");
  const qty = Number(d.qty);
  const obs = typeof d.obs === "string" ? d.obs.slice(0, 500) : "";
  const requestId = String(d.requestId || "");
  if (!matKey) throw new functions.https.HttpsError("invalid-argument", "matKey obrigatório.");
  if (!qty || qty < 1) throw new functions.https.HttpsError("invalid-argument", "qty deve ser um número inteiro positivo.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `entrada:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { stockRef, logRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapLog] = await Promise.all([tx.get(stockRef), tx.get(logRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      let log = parseDoc<LogEntry[]>(snapLog, []);
      if (!sd[matKey]) throw new functions.https.HttpsError("failed-precondition", "MATERIAL_NAO_ENCONTRADO");

      const minQty = Math.round(qty);
      sd[matKey].qty = (sd[matKey].qty || 0) + minQty;
      log = appendLog(log, buildLog("entrada", matKey, sd[matKey].label, minQty, obs, "entrada_manual", `estoque_entrada:${requestId}`, caller));

      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });
      tx.set(logRef, { data: JSON.stringify(log), ts: Date.now() });
      return { qtyDepois: sd[matKey].qty, label: sd[matKey].label };
    });
    await writeAudit("entrada_registrada", caller.uid, caller.role, { matKey, qty, ...resultado });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro entrada:", e);
    throw new functions.https.HttpsError("internal", "Erro ao registrar entrada.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// estoqueRegistrarSaidaManual — saída manual (cobre stockRegistrarSaida e
// stockRegistrarSaidaComRetalho / _stockFazSaida). Nunca permite saldo
// negativo — este caminho não tem (e nunca teve) o conceito de exceção
// Master, diferente do início de produção. Preservado como está: negar é o
// comportamento correto e pré-existente, não uma regra nova.
// ══════════════════════════════════════════════════════════════════════════
export const estoqueRegistrarSaidaManual = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "registrar saída manual de estoque");

  const d = (data || {}) as Record<string, unknown>;
  const matKey = String(d.matKey || "");
  const qty = Number(d.qty);
  const obs = typeof d.obs === "string" ? d.obs.slice(0, 500) : "";
  const osRef = typeof d.osRef === "string" ? d.osRef.slice(0, 200) : "";
  const requestId = String(d.requestId || "");
  if (!matKey) throw new functions.https.HttpsError("invalid-argument", "matKey obrigatório.");
  if (!qty || qty <= 0) throw new functions.https.HttpsError("invalid-argument", "qty deve ser um número positivo.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `saida:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { stockRef, logRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapLog] = await Promise.all([tx.get(stockRef), tx.get(logRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      let log = parseDoc<LogEntry[]>(snapLog, []);
      if (!sd[matKey]) throw new functions.https.HttpsError("failed-precondition", "MATERIAL_NAO_ENCONTRADO");

      const minQty = qty < 1 ? 1 : Math.round(qty);
      const saldoAtual = sd[matKey].qty || 0;
      if (saldoAtual < minQty) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `ESTOQUE_INSUFICIENTE: saldo atual de ${sd[matKey].label} é ${saldoAtual}, solicitado ${minQty}.`
        );
      }
      sd[matKey].qty = saldoAtual - minQty;
      const obsFinal = osRef ? (obs ? obs + " · " + osRef : osRef) : obs;
      log = appendLog(log, buildLog("saida", matKey, sd[matKey].label, minQty, obsFinal, "saida_manual", `estoque_saida:${requestId}`, caller));

      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });
      tx.set(logRef, { data: JSON.stringify(log), ts: Date.now() });
      return { qtyDepois: sd[matKey].qty, label: sd[matKey].label };
    });
    await writeAudit("saida_registrada", caller.uid, caller.role, { matKey, qty, osRef, ...resultado });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro saida:", e);
    throw new functions.https.HttpsError("internal", "Erro ao registrar saída.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// estoqueConsumoAutoOrcamento — cobre a baixa automática de orcGerarOS()
// (hoje hard-coded: 1 unidade do material "ac3" por OS gerada, independente
// do material real do orçamento). Comportamento PRESERVADO exatamente como
// está — inclusive o "pular silenciosamente se ac3 não tiver saldo" — não é
// papel desta correção de segurança inventar/mudar essa regra de negócio;
// só fechar a fronteira de quem pode executá-la e como. Documentado como
// pendência de negócio separada no checkpoint (a baixa não reflete o
// material real da OS).
// ══════════════════════════════════════════════════════════════════════════
export const estoqueConsumoAutoOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao", "comercial"], "gerar OS a partir de orçamento");

  const d = (data || {}) as Record<string, unknown>;
  const osRef = typeof d.osRef === "string" ? d.osRef.slice(0, 200) : "";
  const requestId = String(d.requestId || "");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");
  const MAT_KEY_LEGADO = "ac3";

  const idemKey = `auto_orc:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true, aplicado: false };

  const db = admin.firestore();
  const { stockRef, logRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapLog] = await Promise.all([tx.get(stockRef), tx.get(logRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      let log = parseDoc<LogEntry[]>(snapLog, []);

      if (!sd[MAT_KEY_LEGADO] || (sd[MAT_KEY_LEGADO].qty || 0) <= 0) {
        // Comportamento legado: pula sem falhar (não bloqueia a criação da OS).
        return { aplicado: false };
      }
      sd[MAT_KEY_LEGADO].qty -= 1;
      log = appendLog(log, buildLog(
        "saida", MAT_KEY_LEGADO, sd[MAT_KEY_LEGADO].label, 1, osRef, "auto_orcamento",
        `estoque_auto_orc:${requestId}`, caller
      ));
      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });
      tx.set(logRef, { data: JSON.stringify(log), ts: Date.now() });
      return { aplicado: true, qtyDepois: sd[MAT_KEY_LEGADO].qty };
    });
    if (resultado.aplicado) {
      await writeAudit("consumo_auto_orcamento", caller.uid, caller.role, { osRef, ...resultado });
    }
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro consumo auto:", e);
    throw new functions.https.HttpsError("internal", "Erro ao processar baixa automática.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// estoqueCriarOuEditarItem — cobre stockSalvarNovoItem (criação e edição de
// material). Diferente do original: qty negativo é recusado aqui — isto NÃO
// é uma regra de negócio nova, é uma validação de integridade de dado
// (nenhuma tela jamais ofereceu "estoque negativo" como opção válida para
// este fluxo; o original só não validava). Documentado explicitamente no
// checkpoint como um endurecimento deliberado, não uma decisão de negócio
// inventada.
// ══════════════════════════════════════════════════════════════════════════
export const estoqueCriarOuEditarItem = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "criar ou editar item de estoque");

  const d = (data || {}) as Record<string, unknown>;
  const matKey = String(d.matKey || "").trim();
  const label = String(d.label || "").trim();
  const cor = typeof d.cor === "string" ? d.cor.trim() : "";
  const esp = d.esp !== undefined && d.esp !== null && d.esp !== "" ? Number(d.esp) : undefined;
  const qty = Number(d.qty);
  const min = d.min !== undefined && d.min !== null && d.min !== "" ? Number(d.min) : undefined;
  const max = d.max !== undefined && d.max !== null && d.max !== "" ? Number(d.max) : undefined;
  const requestId = String(d.requestId || "");
  if (!matKey) throw new functions.https.HttpsError("invalid-argument", "matKey obrigatório.");
  if (!label) throw new functions.https.HttpsError("invalid-argument", "label obrigatório.");
  if (!Number.isFinite(qty) || qty < 0) throw new functions.https.HttpsError("invalid-argument", "qty deve ser um número maior ou igual a zero.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `criar_editar_item:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { stockRef, logRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapLog] = await Promise.all([tx.get(stockRef), tx.get(logRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      const existia = !!sd[matKey];
      const qtyAntes = existia ? (sd[matKey].qty || 0) : null;
      sd[matKey] = Object.assign({}, sd[matKey] || {}, {
        label, qty,
        ...(cor ? { cor } : {}),
        ...(esp !== undefined && Number.isFinite(esp) ? { esp } : {}),
        ...(min !== undefined && Number.isFinite(min) ? { min } : {}),
        ...(max !== undefined && Number.isFinite(max) ? { max } : {}),
      });
      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });

      if (existia && qtyAntes !== qty) {
        let log = parseDoc<LogEntry[]>(snapLog, []);
        log = appendLog(log, buildLog(
          qty > (qtyAntes || 0) ? "ajuste_entrada" : "ajuste_saida", matKey, label,
          Math.abs(qty - (qtyAntes || 0)), `Correção de quantidade: ${qtyAntes} → ${qty}`,
          "ajuste_manual", `estoque_ajuste:${requestId}`, caller
        ));
        tx.set(logRef, { data: JSON.stringify(log), ts: Date.now() });
      }
      return { existia, qtyAntes, qtyDepois: qty };
    });
    await writeAudit(resultado.existia ? "item_editado" : "item_criado", caller.uid, caller.role, { matKey, label, ...resultado });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro criar/editar item:", e);
    throw new functions.https.HttpsError("internal", "Erro ao salvar item de estoque.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// estoqueExcluirItem / estoqueRestaurarItem / estoqueExcluirItemDefinitivo
// — cobrem stockExcluirItem / stockLixeiraRestaurar / stockLixeiraExcluirDef.
// Idempotentes por estado: repetir a exclusão de algo já excluído (ou a
// restauração de algo já restaurado) retorna sucesso sem efeito adicional,
// em vez de erro — mesmo padrão de "retry seguro" usado em producao.ts.
// ══════════════════════════════════════════════════════════════════════════
export const estoqueExcluirItem = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "excluir item de estoque");
  const d = (data || {}) as Record<string, unknown>;
  const matKey = String(d.matKey || "").trim();
  const requestId = String(d.requestId || "");
  if (!matKey) throw new functions.https.HttpsError("invalid-argument", "matKey obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `excluir_item:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { stockRef, tombRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapTomb] = await Promise.all([tx.get(stockRef), tx.get(tombRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      const tomb = parseDoc<Record<string, StockItem & { excluidoEm?: number; excluidoPor?: string }>>(snapTomb, {});
      if (!sd[matKey]) return { jaExcluido: true };

      tomb[matKey] = Object.assign({}, sd[matKey], { excluidoEm: Date.now(), excluidoPor: caller.uid });
      delete sd[matKey];
      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });
      tx.set(tombRef, { data: JSON.stringify(tomb), ts: Date.now() });
      return { jaExcluido: false };
    });
    if (!resultado.jaExcluido) await writeAudit("item_excluido", caller.uid, caller.role, { matKey });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro excluir item:", e);
    throw new functions.https.HttpsError("internal", "Erro ao excluir item.");
  }
});

export const estoqueRestaurarItem = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "restaurar item de estoque");
  const d = (data || {}) as Record<string, unknown>;
  const matKey = String(d.matKey || "").trim();
  const requestId = String(d.requestId || "");
  if (!matKey) throw new functions.https.HttpsError("invalid-argument", "matKey obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `restaurar_item:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { stockRef, tombRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapTomb] = await Promise.all([tx.get(stockRef), tx.get(tombRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      const tomb = parseDoc<Record<string, StockItem & { excluidoEm?: number; excluidoPor?: string }>>(snapTomb, {});
      if (!tomb[matKey]) return { jaRestaurado: true };

      const { excluidoEm, excluidoPor, ...item } = tomb[matKey];
      void excluidoEm; void excluidoPor;
      sd[matKey] = item;
      delete tomb[matKey];
      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });
      tx.set(tombRef, { data: JSON.stringify(tomb), ts: Date.now() });
      return { jaRestaurado: false };
    });
    if (!resultado.jaRestaurado) await writeAudit("item_restaurado", caller.uid, caller.role, { matKey });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro restaurar item:", e);
    throw new functions.https.HttpsError("internal", "Erro ao restaurar item.");
  }
});

export const estoqueExcluirItemDefinitivo = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, [], "excluir item definitivamente da lixeira"); // master-only: descarte irreversível
  const d = (data || {}) as Record<string, unknown>;
  const matKey = String(d.matKey || "").trim();
  const requestId = String(d.requestId || "");
  if (!matKey) throw new functions.https.HttpsError("invalid-argument", "matKey obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `excluir_def:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { tombRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const snapTomb = await tx.get(tombRef);
      const tomb = parseDoc<Record<string, StockItem>>(snapTomb, {});
      if (!tomb[matKey]) return { jaExcluido: true };
      delete tomb[matKey];
      tx.set(tombRef, { data: JSON.stringify(tomb), ts: Date.now() });
      return { jaExcluido: false };
    });
    if (!resultado.jaExcluido) await writeAudit("item_excluido_definitivo", caller.uid, caller.role, { matKey });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro excluir definitivo:", e);
    throw new functions.https.HttpsError("internal", "Erro ao excluir definitivamente.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// estoqueLimparHistorico — cobre stockLimparHistorico. Endurecido para
// master-only (era reachable por qualquer isProducao() sem checagem
// nenhuma) porque apaga o rastro de auditoria de todas as outras funções
// acima — documentado como mudança deliberada de permissão, não mantida
// "como estava" por ser claramente incompatível com o objetivo de
// auditoria desta correção.
// ══════════════════════════════════════════════════════════════════════════
export const estoqueLimparHistorico = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, [], "limpar o histórico de estoque"); // master-only
  const d = (data || {}) as Record<string, unknown>;
  const requestId = String(d.requestId || "");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `limpar_hist:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { logRef } = refs(db);
  try {
    const antes = await db.runTransaction(async (tx) => {
      const snapLog = await tx.get(logRef);
      const log = parseDoc<LogEntry[]>(snapLog, []);
      tx.set(logRef, { data: JSON.stringify([]), ts: Date.now() });
      return log.length;
    });
    await writeAudit("historico_limpo", caller.uid, caller.role, { entradasRemovidas: antes });
    return { ok: true, jaProcessado: false, entradasRemovidas: antes };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro limpar histórico:", e);
    throw new functions.https.HttpsError("internal", "Erro ao limpar histórico.");
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Retalhos — estoqueCriarRetalho / estoqueEditarRetalho /
// estoqueConsumirRetalho / estoqueExcluirRetalho. Cobrem retalhoAdicionar,
// retalhoEditarSalvar, retalhoRemover/retalhoConfirmarUso e
// retalhoExcluirConfirmar. Identificados por `codigo` (gerado
// atomicamente no servidor na criação) sempre que disponível — só usam
// índice/mat+dims como fallback para peças legadas sem código.
// ══════════════════════════════════════════════════════════════════════════
function findRetalhoIdx(list: Retalho[], codigo: string | undefined, mat: string | undefined, dims: string | undefined): number {
  if (codigo) return list.findIndex((r) => r.codigo === codigo);
  return list.findIndex((r) => r.mat === mat && r.dims === dims && !r.codigo);
}

// Mesmo esquema de prefixo por material já usado pelo cliente
// (RETALHO_PREFIXO em index.html) e pelo contador atômico pré-existente
// (_retalhoNextCod) — reaproveitado aqui para não quebrar o namespace de
// códigos já em uso (ex.: "AC3-005"), não inventar um formato novo.
const RETALHO_PREFIXO: Record<string, string> = {
  ac3: "AC3", ac5: "AC5", ac8: "ACL", ac10: "ACE",
  ps3: "PS3", mt2: "INX", acm: "ACM",
};
function retalhoPrefixo(mat: string): string {
  return RETALHO_PREFIXO[mat] || mat.toUpperCase().slice(0, 3);
}

export const estoqueCriarRetalho = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "criar retalho");
  const d = (data || {}) as Record<string, unknown>;
  const mat = String(d.mat || "").trim();
  const dims = String(d.dims || "").trim();
  const obs = typeof d.obs === "string" ? d.obs.slice(0, 300) : "";
  const requestId = String(d.requestId || "");
  if (!mat) throw new functions.https.HttpsError("invalid-argument", "mat obrigatório.");
  if (!dims) throw new functions.https.HttpsError("invalid-argument", "dims obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `criar_retalho:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { stockRef, retRef } = refs(db);
  const seqRef = db.collection(COL).doc("retalhos_seq");
  const prefix = retalhoPrefixo(mat);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapRet, snapSeq] = await Promise.all([tx.get(stockRef), tx.get(retRef), tx.get(seqRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      const retList = parseDoc<Retalho[]>(snapRet, []);
      const label = sd[mat] ? sd[mat].label : mat;
      const seqData = snapSeq.exists ? (snapSeq.data() || {}) : {};
      const seq = (Number(seqData[prefix]) || 0) + 1;
      const cod = prefix + "-" + String(seq).padStart(3, "0");
      const hoje = new Date();
      const dStr = String(hoje.getDate()).padStart(2, "0") + "/" + String(hoje.getMonth() + 1).padStart(2, "0");

      retList.push({ mat, label, dims, qty: 1, data: dStr, obs, codigo: cod });
      tx.set(retRef, { data: JSON.stringify(retList), ts: Date.now() });
      tx.set(seqRef, { [prefix]: seq }, { merge: true });
      return { codigo: cod, label };
    });
    await writeAudit("retalho_criado", caller.uid, caller.role, { mat, dims, ...resultado });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro criar retalho:", e);
    throw new functions.https.HttpsError("internal", "Erro ao criar retalho.");
  }
});

export const estoqueEditarRetalho = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "editar retalho");
  const d = (data || {}) as Record<string, unknown>;
  const codigo = String(d.codigo || "").trim();
  const mat = String(d.mat || "").trim();
  const dims = String(d.dims || "").trim();
  const qty = Number(d.qty);
  const obs = typeof d.obs === "string" ? d.obs.slice(0, 300) : "";
  const requestId = String(d.requestId || "");
  if (!codigo) throw new functions.https.HttpsError("invalid-argument", "codigo obrigatório.");
  if (!dims) throw new functions.https.HttpsError("invalid-argument", "dims obrigatório.");
  if (!Number.isFinite(qty) || qty < 0) throw new functions.https.HttpsError("invalid-argument", "qty deve ser um número maior ou igual a zero.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `editar_retalho:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { stockRef, retRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapStock, snapRet] = await Promise.all([tx.get(stockRef), tx.get(retRef)]);
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      const retList = parseDoc<Retalho[]>(snapRet, []);
      const idx = findRetalhoIdx(retList, codigo, undefined, undefined);
      if (idx < 0) throw new functions.https.HttpsError("failed-precondition", "RETALHO_NAO_ENCONTRADO");

      retList[idx].mat = mat || retList[idx].mat;
      retList[idx].label = sd[retList[idx].mat] ? sd[retList[idx].mat].label : retList[idx].mat;
      retList[idx].dims = dims;
      retList[idx].qty = qty;
      retList[idx].obs = obs;
      tx.set(retRef, { data: JSON.stringify(retList), ts: Date.now() });
      return { codigo, qty };
    });
    await writeAudit("retalho_editado", caller.uid, caller.role, resultado);
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro editar retalho:", e);
    throw new functions.https.HttpsError("internal", "Erro ao editar retalho.");
  }
});

export const estoqueConsumirRetalho = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "consumir retalho");
  const d = (data || {}) as Record<string, unknown>;
  const codigo = String(d.codigo || "").trim();
  const osRef = typeof d.osRef === "string" ? d.osRef.slice(0, 200) : "";
  const requestId = String(d.requestId || "");
  if (!codigo) throw new functions.https.HttpsError("invalid-argument", "codigo obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `consumir_retalho:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { retRef, logRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapRet, snapLog] = await Promise.all([tx.get(retRef), tx.get(logRef)]);
      const retList = parseDoc<Retalho[]>(snapRet, []);
      let log = parseDoc<LogEntry[]>(snapLog, []);
      const idx = findRetalhoIdx(retList, codigo, undefined, undefined);
      if (idx < 0 || (retList[idx].qty || 0) <= 0) {
        throw new functions.https.HttpsError("failed-precondition", "RETALHO_INDISPONIVEL");
      }
      const r = retList[idx];
      r.qty -= 1;
      const removido = r.qty <= 0;
      if (removido) retList.splice(idx, 1);

      log = appendLog(log, buildLog(
        "retalho-saida", r.mat, r.label + " " + r.dims + " cm", 1,
        osRef ? (r.codigo ? "Cód: " + r.codigo + " · " + osRef : osRef) : (r.codigo ? "Cód: " + r.codigo : ""),
        "consumo_retalho", `estoque_consumo_retalho:${requestId}`, caller
      ));
      tx.set(retRef, { data: JSON.stringify(retList), ts: Date.now() });
      tx.set(logRef, { data: JSON.stringify(log), ts: Date.now() });
      return { codigo, removido, qtyDepois: removido ? 0 : r.qty };
    });
    await writeAudit("retalho_consumido", caller.uid, caller.role, resultado);
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro consumir retalho:", e);
    throw new functions.https.HttpsError("internal", "Erro ao consumir retalho.");
  }
});

export const estoqueExcluirRetalho = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "excluir retalho");
  const d = (data || {}) as Record<string, unknown>;
  const codigo = String(d.codigo || "").trim();
  const requestId = String(d.requestId || "");
  if (!codigo) throw new functions.https.HttpsError("invalid-argument", "codigo obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `excluir_retalho:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const { retRef } = refs(db);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const snapRet = await tx.get(retRef);
      const retList = parseDoc<Retalho[]>(snapRet, []);
      const idx = findRetalhoIdx(retList, codigo, undefined, undefined);
      if (idx < 0) return { jaExcluido: true };
      retList.splice(idx, 1);
      tx.set(retRef, { data: JSON.stringify(retList), ts: Date.now() });
      return { jaExcluido: false };
    });
    if (!resultado.jaExcluido) await writeAudit("retalho_excluido", caller.uid, caller.role, { codigo });
    return { ok: true, jaProcessado: false, ...resultado };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[estoque] erro excluir retalho:", e);
    throw new functions.https.HttpsError("internal", "Erro ao excluir retalho.");
  }
});
