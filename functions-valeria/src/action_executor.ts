/**
 * action_executor.ts — execução server-side de ações comerciais
 * determinísticas (sprint P0.6).
 *
 * Achado real de E2E (sprint P0.5): o backend retornou corretamente
 * nextAction="calculate_quote" + toolToCall="calcular_produto_personalizado",
 * e mesmo assim o LLM (GPT-4.1 Mini) ignorou a decisão e foi para o fluxo
 * Vitre — nenhuma Tool de cálculo foi chamada. `toolToCall` não é
 * suficiente: ele só GUIA o modelo, nunca o IMPEDE de desobedecer.
 *
 * Princípio deste módulo: quando o orchestrator (orchestrator.ts) já
 * decidiu, de forma 100% determinística a partir de dados já persistidos,
 * que uma ação comercial É a próxima ação — essa ação é executada AQUI,
 * server-side, sem depender de nenhuma Tool call do LLM. O LLM continua
 * responsável por interpretar linguagem, extrair dados (via
 * atualizar_briefing_tecnico) e verbalizar o resultado — nunca por
 * decidir SE uma ação determinística acontece.
 *
 * Reaproveita 100% a lógica já existente e testada (calculatePersonalizedProduct
 * de quote_core.ts, estimateProductionDeadline/checkUrgentFit de
 * deadline.ts) — nunca duplica cálculo/preço/prazo, só remove o
 * intermediário (Tool call) entre a decisão do orchestrator e a execução.
 */
import * as admin from "firebase-admin";
import { calculatePersonalizedProduct } from "./quote_core";
import { estimateProductionDeadline, checkUrgentFit } from "./deadline";
import type { DeadlineEstimate, UrgentFitResult } from "./deadline";
import {
  toQuoteCoreInput,
  technicalBriefingFingerprint,
  type TechnicalBriefing,
} from "./technical_briefing";
import {
  loadTechnicalBriefing,
  saveTechnicalBriefing,
  mergeTechnicalBriefing,
  saveLastEligibleSimulation,
  clearLastEligibleSimulation,
  type LastEligibleSimulation,
} from "./technical_briefing_store";
import { saveSimulation, SIM_COL, SIM_TTL_MS } from "./simulation_store";
import { fsRead, fsWrite } from "./kv_store";
import { uid } from "./ids";
import { TROFEU_GOJOVEM_PRODUCT_ID, calculateTrofeuGoJovem } from "./trofeu_gojovem";
import { nomeConfirmado, telefoneConfirmado, type NextCommercialAction } from "./orchestrator";
import type { Cliente, CrmLead, OrcamentoEnviado, PricingSimulation, QuoteItem } from "./types";

/**
 * Conjunto de nextAction que este módulo sabe executar sem depender de
 * Tool call — usado por valeriaGetContexto para decidir se chama o
 * executor. "confirm_quote" DELIBERADAMENTE não está aqui: é um estado de
 * espera (preço já conhecido, aguardando confirmação explícita do
 * cliente) — nada para o backend executar ainda.
 */
export const EXECUTABLE_ACTIONS: ReadonlySet<NextCommercialAction> = new Set([
  "calculate_quote",
  "create_quote",
  "check_production_deadline",
  "check_urgent_fit",
]);

export type CalculateQuoteExecutionResult =
  | {
      action: "calculate_quote"; success: true; eligibility: "ELIGIBLE";
      finalPrice: number; simulationId: string; pricingVersion: string;
      pieces: Array<{ nome: string; larg: number; alt: number; qtyTotal: number }>;
      warnings: string[];
    }
  | {
      action: "calculate_quote"; success: false;
      eligibility: "NEEDS_INFORMATION" | "HUMAN_VALIDATION_REQUIRED" | "UNSUPPORTED" | "TEMPORARILY_UNAVAILABLE";
      missingFields?: string[];
      blockedItems?: Array<{ campo: string; reasonCode: string; motivo: string }>;
      reason: string;
    }
  | { action: "calculate_quote"; success: false; eligibility: null; reason: "TECHNICAL_BRIEFING_NOT_READY" };

/**
 * Sprint P0.6, item 3 — equivalente server-side de
 * valeriaCalcularProdutoPersonalizado, dirigido pelo technicalBriefing já
 * persistido (nunca por body de Tool call). simulationId continua
 * exclusivamente server-side (nunca fornecido/lido do LLM).
 */
/** Persiste a simulação + lastEligibleSimulation e monta o envelope de retorno — usado por ambos os ramos (motor genérico e Troféu GoJovem). */
async function persistirSimulacaoElegivel(params: {
  conversationId: string;
  technicalBriefing: TechnicalBriefing;
  isTest: boolean;
  finalPrice: number;
  pricingVersion: string;
  simulationId: string;
  itensNormalizados: Array<{ larg: number; alt: number; qty: number; matKey: string; descricao: string }>;
  pieces: Array<{ nome: string; larg: number; alt: number; qtyTotal: number }>;
  warnings: string[];
}): Promise<CalculateQuoteExecutionResult> {
  const { conversationId, technicalBriefing, isTest, finalPrice, pricingVersion, simulationId, itensNormalizados, pieces, warnings } = params;
  const simNow = Date.now();
  const sim: PricingSimulation = {
    simulationId, conversationId,
    itensNormalizados: itensNormalizados as unknown as QuoteItem[],
    finalPrice, pricingVersion,
    createdAt: simNow, expiresAt: simNow + SIM_TTL_MS,
    origem: "valeria", usado: false, isTest,
    technicalBriefingSnapshot: technicalBriefing as unknown as Record<string, unknown>,
  };
  await saveSimulation(sim);
  await saveLastEligibleSimulation(conversationId, {
    simulationId, createdAt: simNow,
    productId: technicalBriefing.productId!,
    finalPrice, fingerprint: technicalBriefingFingerprint(technicalBriefing),
  });
  return {
    action: "calculate_quote", success: true, eligibility: "ELIGIBLE",
    finalPrice, simulationId, pricingVersion, pieces, warnings,
  };
}

export async function executeCalculateQuote(
  conversationId: string,
  technicalBriefing: TechnicalBriefing,
  isTest: boolean = false
): Promise<CalculateQuoteExecutionResult> {
  // Sprint P0.9 — Troféu GoJovem: produto conhecido com preço comercial
  // fixo cadastrado no ERP (vitre_produtos/TFMOD10.precoVenda) — a receita
  // real tem 2 materiais/espessuras diferentes (fora do que
  // calculatePersonalizedProduct suporta hoje, 1 material por produto), e
  // o preço cobre gravação/montagem que o motor de área não sabe
  // precificar. Ver trofeu_gojovem.ts para a justificativa completa.
  if (technicalBriefing.productId === TROFEU_GOJOVEM_PRODUCT_ID) {
    const qty = technicalBriefing.quantity;
    if (!(qty && qty > 0)) {
      return { action: "calculate_quote", success: false, eligibility: "NEEDS_INFORMATION", missingFields: ["quantity"], reason: "Quantidade ainda não informada." };
    }
    const calc = await calculateTrofeuGoJovem(qty);
    if (calc.pricing.eligibility !== "ELIGIBLE") {
      const reason = calc.pricing.eligibility === "NEEDS_INFORMATION"
        ? "Quantidade ainda não informada."
        : "Preço comercial fixo do Troféu GoJovem não encontrado no ERP (vitre_produtos/TFMOD10.precoVenda).";
      return {
        action: "calculate_quote", success: false, eligibility: calc.pricing.eligibility,
        missingFields: calc.pricing.missingFields, reason,
      };
    }
    const itensNormalizados = calc.pieces.map((p) => ({
      larg: p.larg, alt: p.alt, qty: p.qtyTotal, matKey: p.matKey, descricao: p.nome,
    }));
    return persistirSimulacaoElegivel({
      conversationId, technicalBriefing, isTest,
      finalPrice: calc.pricing.finalPrice!,
      pricingVersion: calc.pricing.pricingVersion!,
      simulationId: calc.pricing.simulationId!,
      itensNormalizados,
      pieces: calc.pieces.map((p) => ({ nome: p.nome, larg: p.larg, alt: p.alt, qtyTotal: p.qtyTotal })),
      warnings: [],
    });
  }

  const core = toQuoteCoreInput(technicalBriefing);
  if (!core) {
    return { action: "calculate_quote", success: false, eligibility: null, reason: "TECHNICAL_BRIEFING_NOT_READY" };
  }

  const calc = await calculatePersonalizedProduct({
    ...core,
    adesivo: !!technicalBriefing.adesivo,
    adesivoBranco: !!technicalBriefing.adesivoBranco,
    solicitacoesNaoSuportadas: technicalBriefing.solicitacoesNaoSuportadas ?? [],
  });
  const pricing = calc.pricing;

  if (pricing.eligibility !== "ELIGIBLE") {
    const reason =
      pricing.eligibility === "NEEDS_INFORMATION" ? "Faltam campos para o motor de preço calcular este produto específico." :
      pricing.eligibility === "HUMAN_VALIDATION_REQUIRED" ? "Item pedido exige validação humana (sem fonte canônica de preço)." :
      pricing.eligibility === "UNSUPPORTED" ? "Produto fora do que o motor cobre." :
      "Motor de preço temporariamente indisponível.";
    return {
      action: "calculate_quote", success: false, eligibility: pricing.eligibility,
      missingFields: pricing.missingFields, blockedItems: pricing.blockedItems, reason,
    };
  }

  const simId = pricing.simulationId ?? uid("sim");
  const itensNormalizados = calc.pieces.map((p) => ({
    larg: p.larg, alt: p.alt, qty: p.qtyTotal, matKey: core.matKey, descricao: p.nome,
  }));
  return persistirSimulacaoElegivel({
    conversationId, technicalBriefing, isTest,
    finalPrice: pricing.finalPrice!,
    pricingVersion: pricing.pricingVersion!,
    simulationId: simId,
    itensNormalizados,
    pieces: calc.pieces,
    warnings: calc.warnings,
  });
}

export type CreateQuoteExecutionResult =
  | { action: "create_quote"; success: true; orcamentoId: string; n: number; total: number; pricingVersion: string }
  | { action: "create_quote"; success: false; errorCode: string; reason: string };

/**
 * Sprint P0.6, item 4 — equivalente server-side de valeriaCriarOrcamento,
 * dirigido pela simulação canônica (lastEligibleSimulation) e pela
 * identidade já resolvida (cliente/lead/channelPhone) — nunca por
 * nomeCliente/telCliente/simulationId fornecidos pelo LLM.
 */
export async function executeCreateQuote(params: {
  conversationId: string;
  agentId: string;
  organizationId: string;
  cliente: Cliente | null;
  lead: CrmLead | null;
  channelPhone: string | null;
  lastEligibleSimulation: LastEligibleSimulation;
}): Promise<CreateQuoteExecutionResult> {
  const { conversationId, agentId, organizationId, cliente, lead, channelPhone, lastEligibleSimulation } = params;
  const nomeCliente = nomeConfirmado(cliente, lead);
  const telCliente = telefoneConfirmado(cliente, lead, channelPhone);
  if (!nomeCliente || !telCliente) {
    return { action: "create_quote", success: false, errorCode: "IDENTITY_NOT_READY", reason: "Nome/telefone do cliente ainda não confirmados." };
  }

  const db = admin.firestore();
  const simulationId = lastEligibleSimulation.simulationId;

  let sim!: PricingSimulation;
  try {
    await db.runTransaction(async (tx) => {
      const simRef = db.collection(SIM_COL).doc(simulationId);
      const simDoc = await tx.get(simRef);
      if (!simDoc.exists) throw Object.assign(new Error(), { _code: "SIMULATION_NOT_FOUND" });
      const simData = simDoc.data() as PricingSimulation;
      if (simData.conversationId !== conversationId) throw Object.assign(new Error(), { _code: "SIMULATION_MISMATCH" });
      if (simData.expiresAt < Date.now()) throw Object.assign(new Error(), { _code: "SIMULATION_EXPIRED" });
      if (simData.usado) throw Object.assign(new Error(), { _code: "SIMULATION_ALREADY_USED" });
      tx.update(simRef, { usado: true });
      sim = simData;
    });
  } catch (e: unknown) {
    const code = (e as { _code?: string })._code ?? "UNKNOWN";
    const reasonByCode: Record<string, string> = {
      SIMULATION_NOT_FOUND: "simulationId não encontrado — cálculo precisa ser refeito.",
      SIMULATION_MISMATCH: "simulationId pertence a outra conversa.",
      SIMULATION_EXPIRED: "Simulação expirada (válida por 1h) — cálculo precisa ser refeito.",
      SIMULATION_ALREADY_USED: "Esta simulação já foi usada para criar um orçamento.",
    };
    return { action: "create_quote", success: false, errorCode: code, reason: reasonByCode[code] ?? "Erro inesperado ao criar orçamento." };
  }

  const orcamentos = (await fsRead<OrcamentoEnviado[]>("orcamentos")) ?? [];
  const maxN = orcamentos.reduce((m, o) => Math.max(m, parseInt(String(o.n ?? 0), 10) || 0), 0);

  // Herda leadId/clienteId/oportunidadeId/isTest do atendimento real
  // (cross-codebase, read-only), best-effort — mesma disciplina de
  // valeriaCriarOrcamento. isTest NUNCA é inferido de nome/padrão de
  // texto — só da flag explícita atendimentos/{id}.isTeste (sprint P0.7,
  // P0 real: orçamentos de homologação estavam poluindo métricas
  // comerciais). Nome do campo no orçamento é isTest (sem "e") —
  // ver comentário em types.ts.
  let leadId: string | null = null, clienteId: string | null = null, oportunidadeId: string | null = null;
  let isTestFromAtd = false;
  let atdRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    atdRef = db.collection("atendimentos").doc(conversationId);
    const atdSnap = await atdRef.get();
    if (atdSnap.exists) {
      const atdData = atdSnap.data() ?? {};
      leadId = (atdData.leadId as string) ?? null;
      clienteId = (atdData.clienteId as string) ?? null;
      oportunidadeId = (atdData.oportunidadeId as string) ?? null;
      isTestFromAtd = atdData.isTeste === true;
    } else {
      atdRef = null;
    }
  } catch (e) {
    console.error("[action_executor.executeCreateQuote] falha ao ler atendimento para herdar vínculos:", (e as Error).message);
  }

  const briefingSnap = (sim.technicalBriefingSnapshot ?? null) as { productId?: string; recipeVersion?: number } | null;

  const orc: OrcamentoEnviado = {
    id: uid("orc"), n: maxN + 1,
    nomeCliente, telCliente,
    emailCliente: "", descricao: "",
    itens: sim.itensNormalizados,
    total: sim.finalPrice, totalCost: sim.finalPrice,
    pricingVersion: sim.pricingVersion, quoteEngine: "erp_official",
    simulationId, communicableToCustomer: true, status: "pre_orc_valeria",
    data: new Date().toISOString(), marca: "vr", origem: "valeria",
    conversationId, agentId, organizationId,
    atendimentoId: conversationId, leadId, clienteId, oportunidadeId,
    isTest: isTestFromAtd || sim.isTest === true,
    recipeSnapshot: briefingSnap ? { productId: briefingSnap.productId ?? null, recipeVersion: briefingSnap.recipeVersion ?? null } : null,
    technicalBriefingSnapshot: sim.technicalBriefingSnapshot ?? null,
  };

  orcamentos.unshift(orc);
  await fsWrite("orcamentos", orcamentos);
  await db.collection("valeria_conversations").doc(conversationId).set({ orcamentoId: orc.id, updatedAt: Date.now() }, { merge: true });

  if (atdRef) {
    try {
      await atdRef.set({ orcamentoId: orc.id, updatedAt: Date.now() }, { merge: true });
      await db.collection("atendimentos_audit_log").add({
        action: "vincular_orcamento", callerUid: "valeria", callerRole: "ai_agent",
        detail: { atendimentoId: conversationId, orcamentoId: orc.id, origem: "valeria_autonomous_executor" },
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error("[action_executor.executeCreateQuote] orçamento criado, mas falhou ao vincular no atendimento:", (e as Error).message);
    }
  }

  await clearLastEligibleSimulation(conversationId);
  // Sprint P0.6 — consome o sinal de confirmação (evita recriar orçamento
  // num turno futuro se o fingerprint voltar a bater por coincidência).
  const atual = await loadTechnicalBriefing(conversationId);
  await saveTechnicalBriefing(conversationId, mergeTechnicalBriefing(atual, { clientConfirmedQuote: false }));

  return { action: "create_quote", success: true, orcamentoId: orc.id, n: orc.n, total: orc.total, pricingVersion: orc.pricingVersion };
}

/**
 * Sprint P0.6, item 5 — equivalente server-side de
 * valeriaConsultarPrazoProducao. Consome (limpa) wantsDeadlineCheck para
 * nunca reexecutar em loop.
 */
export async function executeCheckProductionDeadline(
  conversationId: string,
  technicalBriefing: TechnicalBriefing
): Promise<DeadlineEstimate> {
  const estimativa = await estimateProductionDeadline({
    produto: technicalBriefing.productId!,
    quantidade: technicalBriefing.quantity ?? undefined,
  });
  await saveTechnicalBriefing(conversationId, mergeTechnicalBriefing(technicalBriefing, { wantsDeadlineCheck: false }));
  return estimativa;
}

/**
 * Sprint P0.6, item 6 — equivalente server-side de
 * valeriaVerificarEncaixeProducao. Consome (limpa) dataNecessidadeCliente
 * para nunca reexecutar em loop.
 */
export async function executeCheckUrgentFit(
  conversationId: string,
  technicalBriefing: TechnicalBriefing
): Promise<UrgentFitResult> {
  const resultado = await checkUrgentFit({
    produto: technicalBriefing.productId!,
    requestedDateISO: technicalBriefing.dataNecessidadeCliente!,
    quantidade: technicalBriefing.quantity ?? undefined,
  });
  await saveTechnicalBriefing(conversationId, mergeTechnicalBriefing(technicalBriefing, { dataNecessidadeCliente: null }));
  return resultado;
}

export type ExecutedActionEnvelope =
  | { action: "calculate_quote"; result: CalculateQuoteExecutionResult }
  | { action: "create_quote"; result: CreateQuoteExecutionResult }
  | { action: "check_production_deadline"; result: DeadlineEstimate }
  | { action: "check_urgent_fit"; result: UrgentFitResult };

/**
 * executeCommercialAction() — item 2 do sprint P0.6: o único ponto onde
 * uma nextAction determinística vira execução real. Retorna null quando
 * nextAction não é uma ação auto-executável (ex.: greet, ask_required_fields,
 * confirm_quote) — nesses casos o LLM segue normalmente com
 * nextActionPayload, nada muda.
 */
export async function executeCommercialAction(params: {
  conversationId: string;
  agentId: string;
  organizationId: string;
  cliente: Cliente | null;
  lead: CrmLead | null;
  channelPhone: string | null;
  nextAction: NextCommercialAction;
  technicalBriefing: TechnicalBriefing | null;
  lastEligibleSimulation: LastEligibleSimulation | null;
  /** Sprint P0.7 — propagado do atendimento até simulação/orçamento (nunca inferido). */
  isTest?: boolean;
}): Promise<ExecutedActionEnvelope | null> {
  const { conversationId, nextAction, technicalBriefing, lastEligibleSimulation } = params;
  if (!EXECUTABLE_ACTIONS.has(nextAction)) return null;

  if (nextAction === "calculate_quote") {
    if (!technicalBriefing) return null;
    return { action: "calculate_quote", result: await executeCalculateQuote(conversationId, technicalBriefing, !!params.isTest) };
  }

  if (nextAction === "create_quote") {
    if (!lastEligibleSimulation) return null;
    return {
      action: "create_quote",
      result: await executeCreateQuote({
        conversationId, agentId: params.agentId, organizationId: params.organizationId,
        cliente: params.cliente, lead: params.lead, channelPhone: params.channelPhone,
        lastEligibleSimulation,
      }),
    };
  }

  if (nextAction === "check_production_deadline") {
    if (!technicalBriefing?.productId) return null;
    return { action: "check_production_deadline", result: await executeCheckProductionDeadline(conversationId, technicalBriefing) };
  }

  if (nextAction === "check_urgent_fit") {
    if (!technicalBriefing?.productId || !technicalBriefing?.dataNecessidadeCliente) return null;
    return { action: "check_urgent_fit", result: await executeCheckUrgentFit(conversationId, technicalBriefing) };
  }

  return null;
}
