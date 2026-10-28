/**
 * valeria_pre_orcamento_aprovacao.ts — Etapa 9M (2026-10-27).
 *
 * MÓDULO ISOLADO, NÃO REGISTRADO em `index.ts` (mesma decisão de
 * segurança desde a Etapa 9I — ver cabeçalho de
 * valeria_pre_orcamento_identidade.ts).
 *
 * ACHADO CRÍTICO desta etapa: o gate client-side da Etapa 9L
 * (orcEnvPatchAcoesRevisao, index.html) só decide quais BOTÕES
 * aparecem — a escrita real (orcEnvSetStatus → escrita direta no
 * Firestore via SDK client) continuava inteiramente do lado do
 * cliente, sem nenhuma verificação server-side. Qualquer chamada direta
 * (console do navegador, cliente alternativo) ainda conseguia aprovar
 * um `pre_orc_valeria` sem revisão concluída — o gate da 9L reduz o
 * risco de uso ACIDENTAL pela UI normal, mas nunca foi (e não se
 * apresentou como) uma garantia de segurança real.
 *
 * Esta etapa cria o caminho server-side de verdade: aprovar/recusar um
 * pré-orçamento de ORIGEM VALÉRIA só acontece aqui, dentro de UMA
 * transação Firestore que (a) confirma o lock REVISADO, (b) confirma o
 * estado atual do orçamento é elegível para a decisão pedida, (c) grava
 * o novo status, e (d) — só ao aprovar — cria a Conta a Receber com a
 * MESMA chave de idempotência de finCrAutoAprovarOrcamento
 * (functions/src/finCr.ts, NUNCA modificado aqui), tudo atômico: ou as
 * duas escritas acontecem, ou nenhuma.
 *
 * LIMITE HONESTO (documentado também no relatório final, nunca
 * escondido): `firestore.rules` hoje permite `isComercial()` escrever o
 * documento INTEIRO `erp_vr/orcamentos` diretamente
 * (firestore.rules:197) — um cliente autenticado como comercial ainda
 * PODE, tecnicamente, escrever `status:"aprovado"` sem passar por esta
 * função, porque o documento é um array inteiro serializado como JSON
 * num campo `data` (padrão kv_store) — Rules não conseguem validar
 * elementos individuais desse array sem reescrever toda a arquitetura
 * de armazenamento. Fechar esse caminho de verdade exige mudar Rules
 * (proibido nesta etapa, nunca feito aqui) — este módulo fecha o
 * caminho INTENCIONAL (a UI real, migrada para chamar esta função em
 * vez de orcEnvSetStatus para origem Valéria), não o caminho
 * teoricamente possível via escrita direta arbitrária.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { getCallerVerificado, requireRole, parseDoc } from "./auth_helper";

const COL = "erp_vr";
const ORC_DOC = "orcamentos";
const FIN_CR_DOC = "fin_cr";
const REVISAO_COL = "valeria_pre_orcamentos_revisao";

interface OrcamentoEnviadoLike {
  id?: string;
  n?: number | string;
  nomeCliente?: string;
  total?: number | string;
  status?: string;
  conversationId?: string;
  atendimentoId?: string;
  marca?: string;
  crId?: string;
  [key: string]: unknown;
}

interface CrEntry {
  id: string; cliente: string; clienteId: string; orcamentoId: string; descricao: string;
  valor: number; vencimento: string; status: string; marca: string; metodo: string;
  osRef: string; dataCriacao: string; dataRecebimento: string | null;
}

interface RevisaoDoc {
  status: "AGUARDANDO_REVISAO" | "EM_REVISAO" | "REVISADO";
  assumidoPorUid: string | null;
}

export class PreOrcamentoAprovacaoError extends Error {
  constructor(public readonly codigo: string, message: string) {
    super(`${codigo}: ${message}`);
    this.name = "PreOrcamentoAprovacaoError";
  }
}

function dataHojeBR(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function pareceOrigemValeria(o: OrcamentoEnviadoLike): boolean {
  return typeof o.n !== "undefined" || typeof o.nomeCliente !== "undefined";
}

/**
 * Único ponto de escrita server-side para aprovar/recusar um
 * pré-orçamento de origem Valéria. NUNCA usado para orçamentos comuns
 * (pareceOrigemValeria filtra isso — eles continuam no caminho legado
 * client-side, intocado, seção "preservar integralmente" do pedido).
 *
 * Transação única: lock (valeria_pre_orcamentos_revisao) + orçamento
 * (erp_vr/orcamentos) + Conta a Receber (erp_vr/fin_cr, só se aprovado)
 * — todas as leituras antes de qualquer escrita (regra do Firestore),
 * todas as escritas atômicas (ou tudo, ou nada).
 */
export async function aprovarOuRecusarPreOrcamentoCore(
  orcId: string,
  decisao: "aprovado" | "recusado",
  caller: { uid: string }
): Promise<{ ok: true; jaProcessado: boolean; status: string; crId: string | null }> {
  const db = admin.firestore();
  const refOrc = db.collection(COL).doc(ORC_DOC);
  const refCR = db.collection(COL).doc(FIN_CR_DOC);

  return db.runTransaction(async (tx) => {
    // ── Leituras (todas antes de qualquer escrita) ──────────────────────
    const snapOrc = await tx.get(refOrc);
    const arr = parseDoc<OrcamentoEnviadoLike[]>(snapOrc, []);
    const idx = arr.findIndex((o) => o.id === orcId);
    if (idx < 0) throw new PreOrcamentoAprovacaoError("NOT_FOUND", `orçamento ${orcId} não encontrado.`);
    const orc = arr[idx];

    if (!pareceOrigemValeria(orc)) {
      // Nunca deveria ser chamado para um orçamento comum — se acontecer
      // (chamada direta fora da UI), recusa explicitamente em vez de
      // silenciosamente aprovar algo fora do escopo desta função.
      throw new PreOrcamentoAprovacaoError("NAO_E_ORIGEM_VALERIA", `orçamento ${orcId} não é de origem Valéria — use o fluxo comercial padrão.`);
    }

    // Idempotência: já está exatamente no status pedido — devolve sucesso
    // sem reaplicar nada (nunca uma segunda Conta a Receber).
    if (orc.status === decisao) {
      return { ok: true as const, jaProcessado: true, status: orc.status, crId: orc.crId ?? null };
    }
    // Nunca sobrescreve uma decisão humana anterior diferente (ex.: já
    // recusado, tentando aprovar agora) — qualquer mudança de decisão já
    // tomada exige um fluxo humano explícito à parte, nunca esta função.
    if (orc.status === "aprovado" || orc.status === "recusado") {
      throw new PreOrcamentoAprovacaoError("JA_DECIDIDO", `orçamento ${orcId} já está "${orc.status}" — esta função nunca sobrescreve uma decisão anterior.`);
    }

    const atendimentoId = orc.conversationId || orc.atendimentoId || "";
    if (!atendimentoId) throw new PreOrcamentoAprovacaoError("SEM_ATENDIMENTO", `orçamento ${orcId} não tem atendimento vinculado — impossível verificar revisão.`);
    const refRevisao = db.collection(REVISAO_COL).doc(atendimentoId);
    const snapRevisao = await tx.get(refRevisao);
    const revisao = snapRevisao.exists ? (snapRevisao.data() as RevisaoDoc) : null;
    if (!revisao || revisao.status !== "REVISADO") {
      throw new PreOrcamentoAprovacaoError("PENDING_HUMAN_REVIEW", `atendimento ${atendimentoId} ainda não teve a revisão concluída — aprovação/recusa bloqueada.`);
    }

    let crId: string | null = null;
    let snapCR: FirebaseFirestore.DocumentSnapshot | null = null;
    let arrCR: CrEntry[] = [];
    if (decisao === "aprovado") {
      snapCR = await tx.get(refCR);
      arrCR = parseDoc<CrEntry[]>(snapCR, []);
    }

    // ── Escritas (depois de todas as leituras) ──────────────────────────
    arr[idx] = { ...orc, status: decisao };

    if (decisao === "aprovado") {
      const numOrc = String(orc.n ?? "");
      const prodNome = "Produto";
      const idemDescricao = "ORC #" + numOrc + " — " + prodNome;
      const jaExiste = arrCR.find((c) => c.orcamentoId === orcId && c.descricao === idemDescricao);
      if (jaExiste) {
        crId = jaExiste.id;
      } else {
        crId = "cr" + Date.now();
        arrCR.unshift({
          id: crId, cliente: orc.nomeCliente || "(não informado)", clienteId: "", orcamentoId: orcId,
          descricao: idemDescricao, valor: Number(orc.total) || 0, vencimento: dataHojeBR(),
          status: "pendente", marca: orc.marca || "vr", metodo: "PIX", osRef: "ORC-" + numOrc,
          dataCriacao: dataHojeBR(), dataRecebimento: null,
        });
        arr[idx] = { ...arr[idx], crId };
      }
      tx.set(refCR, { data: JSON.stringify(arrCR), ts: Date.now() });
    }
    tx.set(refOrc, { data: JSON.stringify(arr), ts: Date.now() });

    return { ok: true as const, jaProcessado: false, status: decisao, crId };
  });
}

function paraHttpsError(e: unknown): functions.https.HttpsError {
  if (e instanceof functions.https.HttpsError) return e;
  if (e instanceof PreOrcamentoAprovacaoError) {
    const codeMap: Record<string, functions.https.FunctionsErrorCode> = {
      NOT_FOUND: "not-found",
      NAO_E_ORIGEM_VALERIA: "invalid-argument",
      JA_DECIDIDO: "failed-precondition",
      SEM_ATENDIMENTO: "failed-precondition",
      PENDING_HUMAN_REVIEW: "failed-precondition",
    };
    return new functions.https.HttpsError(codeMap[e.codigo] || "internal", e.message);
  }
  return new functions.https.HttpsError("internal", e instanceof Error ? e.message : "Erro desconhecido");
}

// ── Wrapper onCall (Firebase Auth real, role "comercial") — NÃO
// exportado em index.ts nesta etapa.
export const vendedorDecidirPreOrcamentoValeria = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "aprovar/recusar pré-orçamento Valéria");
  const orcId = String(data?.orcId || "").trim();
  const decisao = data?.decisao === "aprovado" || data?.decisao === "recusado" ? data.decisao : null;
  if (!orcId) throw new functions.https.HttpsError("invalid-argument", "orcId obrigatório");
  if (!decisao) throw new functions.https.HttpsError("invalid-argument", "decisao deve ser 'aprovado' ou 'recusado'");
  try {
    return await aprovarOuRecusarPreOrcamentoCore(orcId, decisao, caller);
  } catch (e) {
    throw paraHttpsError(e);
  }
});
