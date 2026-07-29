/**
 * briefing.ts — valeriaAtualizarBriefing (B2)
 *
 * Atualização parcial progressiva do briefing de demanda.
 *
 * Regras de merge:
 *  - Só atualiza campos explicitamente presentes no payload
 *  - NUNCA sobrescreve dado válido com: null, undefined, "", string genérica
 *    ("não informado", "sem informação", "nenhum", "n/a", "na", "-")
 *  - Mantém histórico de cada alteração com ts + camposAlterados + agentId
 *  - Calcula % de completude (0–100) dos campos essenciais
 *  - Classifica a demanda: catálogo / semi_personalizada / personalizada
 *  - Informa quais campos ainda estão faltando
 *
 * Persistência: Firestore "valeria_briefings/{conversationId}"
 */

import * as functions from "firebase-functions";
import * as admin      from "firebase-admin";

import { pipeline }          from "./pipeline";
import {
  withIdempotency,
  extractIdempotencyKey,
  validateIdempotencyKey,
  buildPayloadHash,
  idempotencyHttpStatus,
} from "./idempotency";
import { ok, err }           from "./response";
import type {
  BriefingData,
  BriefingHistoricoEntry,
  ClassificacaoDemanda,
} from "./types";

const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
const RUN_OPTS = functions.runWith({
  secrets:        SECRET_NAMES,
  timeoutSeconds: 30,
  memory:         "256MB",
});

const BRIEFING_COL = "valeria_briefings";

// Campos essenciais para cálculo de completude
const CAMPOS_ESSENCIAIS: (keyof BriefingData)[] = [
  "produto",
  "larguraMm",
  "alturaMm",
  "quantidade",
  "material",
  "acabamento",
  "prazo",
  "referencia",
  "observacoes",
];

// Strings que representam "ausência de informação" — não sobrescrever com elas
const VALORES_GENERICOS = new Set([
  "",
  "não informado",
  "nao informado",
  "sem informação",
  "sem informacao",
  "nenhum",
  "nenhuma",
  "n/a",
  "na",
  "-",
  "--",
  "indefinido",
  "a definir",
]);

function isValorValido(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && VALORES_GENERICOS.has(v.trim().toLowerCase())) return false;
  if (typeof v === "number" && (isNaN(v) || v <= 0)) return false;
  return true;
}

function classificarDemanda(briefing: BriefingData): ClassificacaoDemanda {
  const prod  = (briefing.produto  ?? "").toLowerCase();
  const mat   = (briefing.material ?? "").toLowerCase();
  const acab  = (briefing.acabamento ?? "").toLowerCase();

  // Personalizada: sem produto definido OU produto claramente custom
  const produtosCustom = ["personalizado", "especial", "sob medida", "custom"];
  if (!briefing.produto || produtosCustom.some((p) => prod.includes(p))) {
    return "personalizada";
  }

  // Semi-personalizada: produto catalogo com material ou acabamento especial
  const matsEspeciais = ["inox", "mdf", "madeira", "espelho", "vidro", "mika", "poliestireno"];
  const acabEspeciais  = ["dourado", "escovado", "espelhado", "led", "iluminado", "3d"];
  if (
    matsEspeciais.some((m) => mat.includes(m)) ||
    acabEspeciais.some((a) => acab.includes(a))
  ) {
    return "semi_personalizada";
  }

  return "catalogo";
}

function calcularCompletude(briefing: BriefingData): {
  completude: number;
  camposFaltando: string[];
} {
  const preenchidos: string[] = [];
  const faltando:   string[] = [];

  for (const campo of CAMPOS_ESSENCIAIS) {
    if (isValorValido(briefing[campo])) {
      preenchidos.push(campo as string);
    } else {
      faltando.push(campo as string);
    }
  }

  const completude = Math.round((preenchidos.length / CAMPOS_ESSENCIAIS.length) * 100);
  return { completude, camposFaltando: faltando };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const valeriaAtualizarBriefing = RUN_OPTS.https.onRequest(async (req, res) => {
  const ppl = await pipeline(req, res, "valeriaAtualizarBriefing");
  if (!ppl) return;
  const { ctx } = ppl;
  if (req.method !== "POST") {
    res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST."));
    return;
  }

  const body = req.body as Record<string, unknown>;

  // Pelo menos 1 campo de briefing deve ser enviado
  const CAMPOS_BRIEFING: (keyof BriefingData)[] = [
    "produto", "familia", "larguraMm", "alturaMm", "quantidade",
    "material", "acabamento", "prazo", "referencia", "observacoes",
  ];
  const algumCampo = CAMPOS_BRIEFING.some((c) => body[c as string] !== undefined);
  if (!algumCampo) {
    res.status(400).json(err("VALIDATION_ERROR",
      "Nenhum campo de briefing foi informado. Envie pelo menos um dos campos: produto, familia, larguraMm, alturaMm, quantidade, material, acabamento, prazo, referencia, observacoes.",
      { missingFields: CAMPOS_BRIEFING as string[] }
    ));
    return;
  }

  const rawKeyB = extractIdempotencyKey(req);
  const keyVB = validateIdempotencyKey(rawKeyB);
  if (!keyVB.ok) { res.status(400).json(err("VALIDATION_ERROR", keyVB.error)); return; }
  const payloadHashB = buildPayloadHash(body as Record<string, unknown>);
  const result = await withIdempotency(
    { idempotencyKey: keyVB.key, conversationId: ctx.conversationId, functionName: "valeriaAtualizarBriefing", payloadHash: payloadHashB },
    async () => {
      const db       = admin.firestore();
      const ref      = db.collection(BRIEFING_COL).doc(ctx.conversationId);
      const snap     = await ref.get();
      const nowIso   = new Date().toISOString();

      const existing: BriefingData = snap.exists
        ? (snap.data() as BriefingData)
        : {
            conversationId: ctx.conversationId,
            historico: [],
          };

      // Merge inteligente: só aplica campos válidos presentes no payload
      const camposAlterados: string[] = [];

      const mergeField = <K extends keyof BriefingData>(campo: K, valor: unknown) => {
        if (!isValorValido(valor)) return; // ignora vazio/genérico
        const anterior = existing[campo];
        if (anterior === valor) return; // sem mudança real
        (existing as Record<string, unknown>)[campo as string] = valor;
        camposAlterados.push(campo as string);
      };

      // Campos string
      mergeField("produto",    body["produto"]);
      mergeField("familia",    body["familia"]);
      mergeField("material",   body["material"]);
      mergeField("acabamento", body["acabamento"]);
      mergeField("prazo",      body["prazo"]);
      mergeField("referencia", body["referencia"]);
      mergeField("observacoes",body["observacoes"]);

      // Campos numéricos (validação extra: > 0)
      const largura  = Number(body["larguraMm"]);
      const altura   = Number(body["alturaMm"]);
      const qtd      = Number(body["quantidade"]);
      if (!isNaN(largura)  && largura  > 0) mergeField("larguraMm",  largura);
      if (!isNaN(altura)   && altura   > 0) mergeField("alturaMm",   altura);
      if (!isNaN(qtd)      && qtd      > 0) mergeField("quantidade", qtd);

      // Vínculo (sempre atualiza se vieram)
      if (ctx.conversationId) existing.conversationId = ctx.conversationId;

      // Recalcular completude e classificação
      const { completude, camposFaltando } = calcularCompletude(existing);
      existing.completude     = completude;
      existing.camposFaltando = camposFaltando;
      existing.classificacao  = classificarDemanda(existing);
      existing.updatedAt      = nowIso;

      // Histórico (append-only)
      if (camposAlterados.length > 0) {
        const entry: BriefingHistoricoEntry = {
          ts: nowIso,
          camposAlterados,
          agentId: ctx.agentId,
        };
        existing.historico = [...(existing.historico ?? []), entry];
      }

      // Persiste
      await ref.set(existing, { merge: true });

      // Vincula ao valeria_conversations
      await db.collection("valeria_conversations")
        .doc(ctx.conversationId)
        .set({ briefingId: ctx.conversationId, updatedAt: Date.now() }, { merge: true });

      return ok(
        {
          briefingId:      ctx.conversationId,
          completude:      existing.completude,
          classificacao:   existing.classificacao,
          camposFaltando:  existing.camposFaltando,
          camposAlterados,
          briefing:        existing,
        },
        {
          communicableToCustomer: false,
          verified: true,
          warnings: camposFaltando.length > 0
            ? [`Campos ainda faltando: ${camposFaltando.join(", ")}.`]
            : undefined,
        }
      );
    },
    res
  );

  res.status(result.success ? 200 : idempotencyHttpStatus(result, 500)).json(result);
});
