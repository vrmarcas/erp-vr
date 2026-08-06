/**
 * producao.ts — fronteira server-side para início/edição de produção
 * (baixa de estoque de uma OS), incluindo a exceção de estoque insuficiente.
 *
 * Achado que motivou este arquivo (auditoria Fase F, 2026-08-05): a decisão
 * "só Master pode autorizar início de produção com estoque insuficiente"
 * vivia inteiramente no cliente (variável _souMaster + confirm() do
 * navegador) — a transação do Firestore só verificava um booleano
 * `prodAutorizado` recebido do próprio cliente, nunca reconferido. Uma conta
 * autenticada como Produção (custom claim real) conseguiu gravar estoque
 * profundamente negativo reproduzindo esse payload diretamente via SDK do
 * Firestore, sem qualquer bloqueio do servidor, sem justificativa, sem
 * auditoria. Reproduzido e documentado em
 * incidente_bypass_autorizacao_estoque_negativo_2026-08-05.json.
 *
 * Este arquivo move a decisão inteira para o servidor: a identidade vem
 * exclusivamente de context.auth (nunca de campos do payload), a role é
 * conferida contra o custom claim E contra erp_vr_usuarios/{uid} (coerência
 * + conta ativa), e a autorização de exceção exige role==='master' E uma
 * justificativa textual mínima — tudo dentro de uma única transação que relê
 * kb_os/stock/retalhos/erp_stock_log do zero.
 *
 * Mantém o modelo de dados existente (documentos agregados erp_vr/kb_os,
 * erp_vr/stock, erp_vr/retalhos, erp_vr/erp_stock_log) — não é uma
 * reescrita para documento-por-registro (isso é o modelo do Compras v2,
 * fora do escopo desta correção pontual de fronteira de autorização).
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { CallerVerificado, getCallerVerificado, requireRole, acquireIdem as acquireIdemShared, writeAudit as writeAuditShared, parseDoc } from "./auth_helper";

const COL = "erp_vr";
const COL_IDEM = "producao_idem_keys";
const COL_AUDIT = "erp_vr_audit_log_producao"; // auditoria dedicada, fora do array legado erp_vr/erp_audit_log (Rules dessa coleção legada exigem leitura Master-only e escrita por qualquer staff — aqui queremos append-only só via Function)

const JUSTIFICATIVA_MIN_LEN = 10;

function acquireIdem(key: string): Promise<boolean> {
  return acquireIdemShared(COL_IDEM, key);
}

function writeAudit(action: string, callerUid: string, callerRole: string, detail: Record<string, unknown>): Promise<void> {
  return writeAuditShared(COL_AUDIT, action, callerUid, callerRole, detail);
}

interface StockItem { label: string; qty: number; cor?: string; esp?: number; min?: number; max?: number; }
interface Retalho { mat: string; dims: string; label: string; codigo?: string; qty: number; }
interface MatProd {
  matKey: string | null; label: string; qty?: number; chapasRetiradas?: number;
  isRetalho: boolean; obs: string; sobra?: number;
  retalhoMat?: string; retalhoDims?: string; retalhoCodigo?: string;
}
interface OS {
  num?: string | number; status?: string; producaoStartId?: string; producaoIniciadaEm?: number;
  inicioProducaoTs?: number; matProd?: MatProd; orcRef?: string | null;
  [key: string]: unknown;
}
interface LogEntry {
  tipo: string; matKey: string; matLabel: string; qty: number; os: unknown; obs: string; dt: string;
  osId: string; orcamentoId: string | null; materialId: string | null; quantidade: number;
  finalidade: string; idempotencyKey: string; ts: number; usuario: string;
  autorizadoPorUid?: string; autorizadoPorRole?: string; justificativa?: string;
}

interface ProducaoInput {
  osId: string;
  editMode: boolean;
  tipo: "chapa" | "retalho";
  matKey?: string;
  qty?: number;
  retalhoCodigo?: string;
  obs?: string;
  justificativa?: string;
  requestId: string;
}

function validarInput(data: unknown): ProducaoInput {
  const d = (data || {}) as Record<string, unknown>;
  const osId = String(d.osId || "");
  if (!osId) throw new functions.https.HttpsError("invalid-argument", "osId obrigatório.");
  const requestId = String(d.requestId || "");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório (idempotência).");
  const tipo = d.tipo === "retalho" ? "retalho" : "chapa";
  const editMode = d.editMode === true;
  const obs = typeof d.obs === "string" ? d.obs.slice(0, 500) : "";
  const justificativa = typeof d.justificativa === "string" ? d.justificativa.trim().slice(0, 1000) : "";
  if (tipo === "chapa") {
    const matKey = String(d.matKey || "");
    if (!matKey) throw new functions.https.HttpsError("invalid-argument", "matKey obrigatório para tipo chapa.");
    const qty = Number(d.qty);
    if (!qty || qty <= 0) throw new functions.https.HttpsError("invalid-argument", "qty deve ser um número positivo.");
    return { osId, editMode, tipo, matKey, qty, obs, justificativa, requestId };
  }
  const retalhoCodigo = String(d.retalhoCodigo || "");
  if (!retalhoCodigo) throw new functions.https.HttpsError("invalid-argument", "retalhoCodigo obrigatório para tipo retalho.");
  return { osId, editMode, tipo, retalhoCodigo, obs, justificativa, requestId };
}

function buildLogEntry(
  tipo: string, matKey: string, matLabel: string, qty: number, os: OS, osId: string,
  obsTexto: string, finalidade: string, idemKeyEntry: string, caller: CallerVerificado, justificativa?: string
): LogEntry {
  const now = new Date();
  const dtStr = now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const entry: LogEntry = {
    tipo, matKey: matKey || "", matLabel: matLabel || matKey || "", qty, os: os.num ?? osId, obs: obsTexto || "", dt: dtStr,
    osId, orcamentoId: (os.orcRef as string) || null, materialId: matKey || null, quantidade: qty,
    finalidade, idempotencyKey: idemKeyEntry, ts: Date.now(), usuario: caller.uid,
    autorizadoPorUid: caller.uid, autorizadoPorRole: caller.role,
  };
  if (justificativa) entry.justificativa = justificativa;
  return entry;
}

// ══════════════════════════════════════════════════════════════════════════
// producaoIniciarOuEditar — início OU edição de produção (baixa de estoque
// de uma OS). Master e Produção podem iniciar/editar com estoque
// SUFICIENTE. Estoque INSUFICIENTE só pode ser autorizado por Master, com
// justificativa textual mínima — decisão inteira validada aqui, nunca
// confiando em nada que o cliente afirme sobre si mesmo.
// ══════════════════════════════════════════════════════════════════════════
export const producaoIniciarOuEditar = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "iniciar ou editar produção");

  const input = validarInput(data);
  const idemKey = `${input.editMode ? "edicao" : "inicio"}:${input.requestId}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) {
    // Requisição já processada (retry com o mesmo requestId) — não repete a baixa.
    return { ok: true, jaProcessado: true };
  }

  const db = admin.firestore();
  const kbOsRef = db.collection(COL).doc("kb_os");
  const stockRef = db.collection(COL).doc("stock");
  const retRef = db.collection(COL).doc("retalhos");
  const logRef = db.collection(COL).doc("erp_stock_log");
  const osProducaoIdemKey = "producao_inicio:" + input.osId; // mesma chave de negócio usada pelo legado (producaoStartId da OS)

  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapOs, snapStock, snapRet, snapLog] = await Promise.all([
        tx.get(kbOsRef), tx.get(stockRef), tx.get(retRef), tx.get(logRef),
      ]);
      const objOS = parseDoc<Record<string, OS>>(snapOs, {});
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      const retList = parseDoc<Retalho[]>(snapRet, []);
      let log = parseDoc<LogEntry[]>(snapLog, []);

      const osFresh = objOS[input.osId];
      if (!osFresh) throw new functions.https.HttpsError("not-found", "OS_NAO_ENCONTRADA");

      if (!input.editMode) {
        if (["pronta", "entregue", "cancelado"].indexOf(osFresh.status || "") >= 0) {
          throw new functions.https.HttpsError("failed-precondition", "OS_STATUS_INVALIDO:" + osFresh.status);
        }
        if (osFresh.producaoStartId || osFresh.matProd) {
          throw new functions.https.HttpsError("already-exists", "PRODUCAO_JA_INICIADA");
        }
      } else {
        if (["pronta", "entregue", "cancelado"].indexOf(osFresh.status || "") >= 0) {
          throw new functions.https.HttpsError("failed-precondition", "OS_STATUS_INVALIDO:" + osFresh.status);
        }
        if (!osFresh.matProd) throw new functions.https.HttpsError("failed-precondition", "EDICAO_SEM_PRODUCAO_INICIADA");
      }

      const logEntries: LogEntry[] = [];
      let retListMutada = false;

      // Edição: restaura a baixa anterior antes de aplicar a nova.
      if (input.editMode && osFresh.matProd) {
        const mp = osFresh.matProd;
        if (mp.isRetalho) {
          if (!mp.retalhoMat && !mp.retalhoCodigo) {
            throw new functions.https.HttpsError("failed-precondition", "EDICAO_RETALHO_LEGADO_SEM_MARCA");
          }
          const oldIdx = retList.findIndex((r) =>
            mp.retalhoCodigo ? r.codigo === mp.retalhoCodigo : (r.mat === mp.retalhoMat && r.dims === mp.retalhoDims)
          );
          if (oldIdx >= 0) { retList[oldIdx].qty = (retList[oldIdx].qty || 0) + 1; retListMutada = true; }
        } else if (mp.matKey && sd[mp.matKey]) {
          const prevChapas = mp.chapasRetiradas || mp.qty || 1;
          sd[mp.matKey].qty = (sd[mp.matKey].qty || 0) + prevChapas;
          logEntries.push(buildLogEntry(
            "entrada", mp.matKey, sd[mp.matKey].label, prevChapas, osFresh, input.osId,
            "Correção — material trocado na OS", "edicao_producao_estorno",
            `producao_edicao_estorno:${input.osId}:${Date.now()}`, caller
          ));
        }
      }

      let novoMatProd: MatProd;
      if (input.tipo === "retalho") {
        const idx = retList.findIndex((r) => r.codigo === input.retalhoCodigo);
        if (idx < 0 || !retList[idx] || (retList[idx].qty || 0) <= 0) {
          throw new functions.https.HttpsError("failed-precondition", "RETALHO_INDISPONIVEL");
        }
        retList[idx].qty -= 1;
        retListMutada = true;
        const r = retList[idx];
        novoMatProd = { matKey: null, label: r.label + " " + r.dims, isRetalho: true, retalhoMat: r.mat, retalhoDims: r.dims, retalhoCodigo: r.codigo || "", obs: input.obs || "" };
        logEntries.push(buildLogEntry(
          "retalho-saida", r.mat, r.label + " " + r.dims + " cm", 1, osFresh, input.osId,
          r.codigo ? "Cód: " + r.codigo : "", input.editMode ? "edicao_producao" : "inicio_producao",
          input.editMode ? `producao_edicao:${input.osId}:${Date.now()}` : osProducaoIdemKey, caller
        ));
      } else {
        const mk = input.matKey as string;
        const qty = input.qty as number;
        if (!sd[mk]) throw new functions.https.HttpsError("failed-precondition", "Material não encontrado no estoque.");
        const chapasRetirar = Math.ceil(qty);
        const saldoAtual = sd[mk].qty || 0;
        const estoqueSuficiente = saldoAtual >= chapasRetirar;

        let justificativaUsada: string | undefined;
        if (!estoqueSuficiente) {
          // ── A FRONTEIRA: nenhum campo do cliente decide isto. Só a role
          // verificada no servidor + uma justificativa textual real. ──
          if (caller.role !== "master") {
            throw new functions.https.HttpsError(
              "permission-denied",
              `ESTOQUE_INSUFICIENTE: faltam ${(chapasRetirar - saldoAtual).toFixed(2)} chapa(s) de ${sd[mk].label}. Somente Master pode autorizar produção com estoque insuficiente.`
            );
          }
          if (!input.justificativa || input.justificativa.length < JUSTIFICATIVA_MIN_LEN) {
            throw new functions.https.HttpsError(
              "invalid-argument",
              `JUSTIFICATIVA_OBRIGATORIA: autorizar estoque insuficiente exige justificativa com pelo menos ${JUSTIFICATIVA_MIN_LEN} caracteres.`
            );
          }
          justificativaUsada = input.justificativa;
        }

        sd[mk].qty = saldoAtual - chapasRetirar;
        const sobra = +(chapasRetirar - qty).toFixed(4);
        novoMatProd = {
          matKey: mk, label: sd[mk].label + (sd[mk].cor ? " " + sd[mk].cor : "") + (sd[mk].esp ? " — " + sd[mk].esp + "mm" : ""),
          qty, chapasRetiradas: chapasRetirar, isRetalho: false, obs: input.obs || "",
          sobra: sobra > 0.01 ? sobra : 0,
        };
        const obsLog = "Produção OS #" + (osFresh.num ?? input.osId) + (input.obs ? " · " + input.obs : "") +
          (sobra > 0.01 ? " (sobra " + sobra.toFixed(2) + " chapa)" : "") +
          (justificativaUsada ? " · EXCEÇÃO autorizada por Master: " + justificativaUsada : "");
        logEntries.push(buildLogEntry(
          "saida", mk, sd[mk].label, chapasRetirar, osFresh, input.osId, obsLog,
          input.editMode ? "edicao_producao" : "inicio_producao",
          input.editMode ? `producao_edicao:${input.osId}:${Date.now()}` : osProducaoIdemKey, caller, justificativaUsada
        ));

        if (justificativaUsada) {
          await writeAudit("producao_autorizada_estoque_insuficiente", caller.uid, caller.role, {
            osId: input.osId, osNum: osFresh.num, matKey: mk, saldoAntes: saldoAtual, chapasRetirar,
            saldoDepois: sd[mk].qty, justificativa: justificativaUsada, editMode: input.editMode,
          });
        }
      }

      osFresh.matProd = novoMatProd;
      if (!input.editMode) {
        osFresh.status = "producao";
        osFresh.producaoStartId = osProducaoIdemKey;
        osFresh.producaoIniciadaEm = Date.now();
        if (!osFresh.inicioProducaoTs) osFresh.inicioProducaoTs = osFresh.producaoIniciadaEm;
      } else if (!osFresh.producaoStartId) {
        osFresh.producaoStartId = osProducaoIdemKey;
      }
      objOS[input.osId] = osFresh;

      log = logEntries.concat(log);
      if (log.length > 200) log.length = 200;

      tx.set(kbOsRef, { data: JSON.stringify(objOS), ts: Date.now() });
      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });
      tx.set(logRef, { data: JSON.stringify(log), ts: Date.now() });
      if (retListMutada) tx.set(retRef, { data: JSON.stringify(retList), ts: Date.now() });

      return { osFresh, matProd: novoMatProd };
    });

    await writeAudit(input.editMode ? "producao_editada" : "producao_iniciada", caller.uid, caller.role, {
      osId: input.osId, osNum: resultado.osFresh.num, matProd: resultado.matProd,
    });

    return { ok: true, jaProcessado: false, matProd: resultado.matProd, osStatus: resultado.osFresh.status };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[producao] erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao processar produção.");
  }
});
