/**
 * deadline.ts — motor determinístico de prazo de produção (sprint P0.2,
 * P0.18-P0.22, 2026-08-23).
 *
 * AUDITORIA REALIZADA (duas vezes, independentemente, nesta sprint e na
 * anterior — não presumido): não existe em nenhum lugar do ERP
 * (index.html, functions/, functions-valeria/, firestore.rules)
 * configuração de capacidade produtiva (peças/dia, dias úteis
 * configuráveis, fila com SLA, feriados). Busca exaustiva por
 * "capacidadeDiaria/pecasPorDia/maxOsPorDia/capacidade" não retornou
 * nenhuma ocorrência. O único campo relacionado a "prazo" hoje é
 * `kb_os.*.prazo`/`tempoProd` — valor MANUAL digitado pelo operador por
 * OS, não uma previsão calculada.
 *
 * Por isso este motor NUNCA inventa um prazo — ele é a "primeira versão
 * determinística e explícita" pedida: a interface certa, pronta para
 * funcionar de verdade assim que o ERP ganhar uma fonte real de
 * capacidade (ex.: `erp_vr/erp_config.producao.capacidadeDiariaM2` ou
 * equivalente). Até lá, retorna sempre `canEstimate:false` de forma
 * estruturada — isso é o comportamento CORRETO, não uma limitação
 * escondida: impede a Valéria de fabricar "7 dias" ou qualquer número,
 * e dá ao prompt uma saída determinística para dizer "vou confirmar com
 * a equipe" sem decidir isso sozinha.
 */

export interface DeadlineEstimate {
  canEstimate: boolean;
  productionDays: number | null;
  estimatedDate: string | null; // ISO yyyy-mm-dd
  confidence: "none" | "low" | "medium" | "high";
  source: string;
  requiresHuman: boolean;
  reason: string;
}

export interface UrgentFitResult {
  feasible: boolean;
  requestedDate: string;
  earliestDate: string | null;
  requiresHuman: boolean;
  reasonCode: string;
}

/**
 * Fonte de capacidade — hoje sempre retorna null (nenhuma capacidade
 * configurada, confirmado por auditoria). Isolado em função própria para
 * que, quando o ERP ganhar essa configuração real, só este ponto precise
 * mudar — o resto do motor (estimateProductionDeadline/checkUrgentFit)
 * já está pronto para consumi-la.
 */
function lerCapacidadeConfigurada(): { capacidadeDiariaM2: number; diasUteisPorSemana: number } | null {
  return null;
}

export function estimateProductionDeadline(_params: {
  produto: string;
  areaTotalM2?: number;
  quantidade?: number;
}): DeadlineEstimate {
  const capacidade = lerCapacidadeConfigurada();
  if (!capacidade) {
    return {
      canEstimate: false,
      productionDays: null,
      estimatedDate: null,
      confidence: "none",
      source: "sem_capacidade_configurada",
      requiresHuman: true,
      reason:
        "Não existe capacidade de produção configurada no ERP (peças/dia, dias úteis) — prazo real precisa ser confirmado pela equipe de produção.",
    };
  }
  // Inalcançável hoje (lerCapacidadeConfigurada sempre retorna null) —
  // implementação futura, quando a fonte real existir, entra aqui.
  return {
    canEstimate: false,
    productionDays: null,
    estimatedDate: null,
    confidence: "none",
    source: "nao_implementado",
    requiresHuman: true,
    reason: "Motor de capacidade ainda não implementado.",
  };
}

export function checkUrgentFit(_params: {
  produto: string;
  requestedDateISO: string;
  areaTotalM2?: number;
  quantidade?: number;
}): UrgentFitResult {
  const capacidade = lerCapacidadeConfigurada();
  if (!capacidade) {
    return {
      feasible: false,
      requestedDate: _params.requestedDateISO,
      earliestDate: null,
      requiresHuman: true,
      reasonCode: "PRODUCTION_EXCEPTION",
    };
  }
  return {
    feasible: false,
    requestedDate: _params.requestedDateISO,
    earliestDate: null,
    requiresHuman: true,
    reasonCode: "PRODUCTION_EXCEPTION",
  };
}
