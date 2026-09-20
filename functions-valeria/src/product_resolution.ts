/**
 * product_resolution.ts — ValerIA 2.0, Fase B (2026-09-19).
 *
 * Decisão determinística "produto pronto (Vitre) vs. personalizado", exigida
 * pela política CATALOG-FIRST: a ValerIA sempre tenta primeiro encaixar o
 * cliente num produto já pronto do catálogo (`vitre_produtos`) antes de abrir
 * o caminho de personalização (pipeline VR existente — orchestrator/
 * action_executor/quote_core/recipes.ts, NÃO tocado por este módulo).
 *
 * Módulo PURO por design (sem Firestore, sem I/O, sem efeito colateral):
 * recebe sinais já extraídos pelo LLM + estado do catálogo/produtos já
 * carregado, e devolve só a decisão. Quem persiste, cria rascunho ou chama
 * o Chatvolt é o chamador (catalog_draft.ts / a Tool HTTP), nunca este
 * módulo — isso é o que o torna trivialmente testável.
 *
 * REGRA APROVADA (2026-09-19): NÃO existe tolerância dimensional automática
 * por padrão. `toleranciaCm` de um grupo de catálogo, se ausente/null,
 * desliga qualquer "near match" por proximidade numérica — uma dimensão
 * que não bate exatamente com nenhum tamanho do grupo nunca vira
 * CATALOG_OPTION_AVAILABLE sozinha; ela vira AMBIGUOUS (quando o cliente
 * foi vago, ex. "uns 30 cm" sem medida exata) ou CUSTOM_REQUIRED (quando o
 * cliente deu uma medida exata que não corresponde a nenhum tamanho — isso
 * é pedido de personalização, não aproximação).
 */

export type ResolutionType =
  | "EXACT_CATALOG_MATCH"
  | "CATALOG_OPTION_AVAILABLE"
  | "CUSTOM_REQUIRED"
  | "CUSTOM_REQUESTED"
  | "AMBIGUOUS"
  | "UNSUPPORTED"
  /**
   * Fase D.2.2 (2026-09-19) — distingue "catálogo comercial conhecido" de
   * "produto operacional homologado". O grupo foi identificado sem
   * ambiguidade (nome bate, é um modelo real do catálogo/PDF), mas
   * `tamanhos` está vazio — nenhum `vitreProductId` foi mapeado ainda.
   * NUNCA vira CUSTOM_REQUIRED/CUSTOM_REQUIRED (o cliente não pediu nada
   * fora do padrão — o padrão é que ainda não existe no ERP) nem
   * UNSUPPORTED (a categoria/modelo é reconhecida, só falta o mapeamento
   * operacional). A ValerIA continua qualificando comercialmente
   * (quantidade/personalização/prazo) e encaminha para revisão humana com
   * motivo PRODUCT_MAPPING_REQUIRED — nunca cria vitre_orcamentos.
   */
  | "CATALOG_KNOWN_NO_OPERATIONAL_MATCH";

/** Origem de um campo — de onde veio o valor, para nunca confundir default com informação real do cliente. */
export type FieldSource = "CUSTOMER" | "VITRE_PRODUCT" | "CATALOG_GROUP" | "SYSTEM" | "HUMAN" | "INFERRED";

export interface CatalogSizeOption {
  tamanho: string; // "P" | "M" | "G" | rótulo livre
  larguraCm: number;
  alturaCm: number;
  profundidadeCm?: number | null;
  /**
   * CONTRATO (fechamento Fase B/Fase C, 2026-09-19): dois campos
   * SEMANTICAMENTE distintos, mesmo que hoje coincidam em valor —
   * `vitre_produtos` usa o próprio SKU como id do documento, mas isso é
   * um detalhe de implementação atual, não uma garantia permanente.
   *   vitreProductId  = ID REAL do documento em `vitre_produtos` (o que
   *                     qualquer leitura/escrita no Firestore usa).
   *   vitreProductSku = SKU comercial/interno (o que aparece em nome de
   *                     produto, etiqueta, planilha — pode divergir do id
   *                     no futuro sem quebrar nada que dependa do id).
   */
  vitreProductId: string;
  vitreProductSku: string;
  /**
   * Fase D (ingestão de catálogos reais, 2026-09-19) — metadados de
   * auditoria/versionamento, nunca usados para decidir preço operacional
   * (isso continua sendo sempre `vitre_produtos.precoVenda`, lido ao vivo
   * — ver vitre_v2_eligibility.ts/catalog_tools.ts). `catalogPublishedPrice`
   * é só o valor impresso no PDF/catálogo comercial, para detectar
   * PRICE_MISMATCH durante a homologação; `pageNumber` é só referência de
   * onde este item aparece no material de origem.
   */
  catalogPublishedPrice?: number | null;
  pageNumber?: number | null;
}

export interface CatalogGroup {
  catalogGroupId: string; // ex.: "caixa_tampa_correr"
  categoria: string; // ex.: "caixas"
  nome: string; // ex.: "Caixa com tampa de correr"
  aliases: string[]; // formas alternativas de citar o mesmo grupo (case-insensitive)
  tamanhos: CatalogSizeOption[];
  materialPadrao?: string | null;
  espessuraPadraoMm?: number | null;
  /**
   * Tolerância de proximidade dimensional, em cm, para permitir
   * CATALOG_OPTION_AVAILABLE por aproximação. null/undefined = SEM
   * tolerância automática (comportamento padrão aprovado — ver cabeçalho).
   * Nunca assumir um valor default diferente de "desligado".
   */
  toleranciaCm?: number | null;
  /**
   * Fase D.2.2 — subtipo comercial dentro da mesma categoria/catálogo,
   * quando o grupo não é semanticamente equivalente aos demais (ex.:
   * "Caixa Veludo p/ Homenagem" dentro do catálogo de troféus). Só
   * informativo/relatório — não participa da lógica de matching.
   */
  catalogSubtype?: string | null;
}

export interface ResolutionSignals {
  /** Texto/sinais brutos extraídos pelo LLM neste turno (idempotente por turno, não histórico). */
  categoria?: string | null;
  /** SKU citado explicitamente ou já conhecido do contexto da conversa (prioridade máxima). */
  explicitSkuOrProductId?: string | null;
  /** Nome/alias de grupo de catálogo mencionado (ex.: "tampa de correr"). */
  groupNameOrAlias?: string | null;
  /** Tamanho de catálogo citado literalmente (ex.: "M", "média"). */
  catalogSizeLabel?: string | null;
  /** Dimensões exatas citadas pelo cliente, se houver (cm). */
  exactDimensionsCm?: { largura: number; altura: number; profundidade?: number | null } | null;
  /** Cliente deu uma medida "vaga" (ex.: "uns 30 cm") sem afirmar ser exata. */
  vagueSizeHintCm?: number | null;
  /** Cliente pediu explicitamente algo fora do catálogo / rejeitou a opção oferecida. */
  customerExplicitlyRequestsCustom?: boolean;
  /**
   * Contexto de conversa (resolução anterior desta conversa) — SEMPRE dois
   * sinais SEPARADOS, nunca um substituindo o outro (correção 2026-09-19):
   *   contextCatalogGroupId  = família/grupo comercial já identificado
   *                            (ex.: "caixa_tampa_de_correr"), pode existir
   *                            sozinho, sem nenhum SKU concreto.
   *   contextMatchedProductId = SKU REAL de vitre_produtos, só quando uma
   *                            resolução anterior desta conversa já chegou
   *                            a EXACT_CATALOG_MATCH (ou CATALOG_OPTION
   *                            confirmada) para um tamanho específico.
   */
  contextCatalogGroupId?: string | null;
  /** ID real do documento vitre_produtos já resolvido em turno anterior desta conversa. */
  contextMatchedProductId?: string | null;
  /** SKU correspondente a contextMatchedProductId (mesmo par id/sku do turno anterior). */
  contextMatchedProductSku?: string | null;
  /** true depois que o cliente confirmou explicitamente uma opção sugerida (CATALOG_OPTION_AVAILABLE anterior). */
  clientConfirmedSuggestedOption?: boolean;
}

export interface ResolutionResult {
  resolutionType: ResolutionType;
  matchedProductId: string | null; // ID REAL do doc em vitre_produtos, só quando EXACT (ou CATALOG_OPTION confirmado)
  matchedProductSku: string | null; // SKU correspondente — ver contrato id≠sku em CatalogSizeOption
  catalogGroupId: string | null; // grupo envolvido nesta resolução (EXACT/CATALOG_OPTION/AMBIGUOUS)
  /**
   * Preenchidos SÓ em CUSTOM_REQUESTED/CUSTOM_REQUIRED, como campos de
   * tipo diferente (correção 2026-09-19 — nunca misturar groupId dentro de
   * um campo chamado productId, e nunca misturar SKU com id real):
   *   baseCatalogGroupId = família/modelo comercial de origem (sempre que
   *                        havia um grupo identificado, mesmo sem SKU).
   *   baseProductId      = ID REAL de vitre_produtos de referência, só
   *                        quando um tamanho específico já havia sido
   *                        resolvido antes do pedido de personalização;
   *                        null quando o cliente nunca chegou a selecionar
   *                        um tamanho de catálogo.
   *   baseProductSku     = SKU correspondente a baseProductId (hoje
   *                        coincidem em valor — são o mesmo texto — mas
   *                        são conceitos diferentes, nunca o mesmo campo).
   */
  baseCatalogGroupId: string | null;
  baseProductId: string | null;
  baseProductSku: string | null;
  clientConfirmed: boolean;
  matchConfidence: number; // 0..1 — 1 só em EXACT_CATALOG_MATCH
  customizationRequired: boolean;
  customizationReason: string | null;
  suggestedOption: CatalogSizeOption | null; // preenchido em CATALOG_OPTION_AVAILABLE, para a ValerIA perguntar
  reasonCode: string; // motivo curto e estável, para observabilidade/testes
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function findGroupByNameOrAlias(groups: CatalogGroup[], nameOrAlias: string): CatalogGroup | null {
  const needle = normalize(nameOrAlias);
  for (const g of groups) {
    if (normalize(g.nome) === needle) return g;
    if (g.aliases.some((a) => normalize(a) === needle)) return g;
  }
  // fallback: contém (menos estrito, ainda assim exige inequívoco — só 1 match)
  const contains = groups.filter(
    (g) => normalize(g.nome).includes(needle) || g.aliases.some((a) => normalize(a).includes(needle))
  );
  return contains.length === 1 ? contains[0] : null;
}

function findSizeByLabel(group: CatalogGroup, label: string): CatalogSizeOption | null {
  const needle = normalize(label);
  const bySizeLetter = group.tamanhos.find((t) => normalize(t.tamanho) === needle);
  if (bySizeLetter) return bySizeLetter;
  if (needle === "media" || needle === "medio") return group.tamanhos.find((t) => normalize(t.tamanho) === "m") || null;
  if (needle === "pequena" || needle === "pequeno") return group.tamanhos.find((t) => normalize(t.tamanho) === "p") || null;
  if (needle === "grande") return group.tamanhos.find((t) => normalize(t.tamanho) === "g") || null;
  return null;
}

function findSizeByExactDimensions(
  group: CatalogGroup,
  dims: { largura: number; altura: number; profundidade?: number | null }
): CatalogSizeOption | null {
  const matches = group.tamanhos.filter(
    (t) =>
      t.larguraCm === dims.largura &&
      t.alturaCm === dims.altura &&
      (dims.profundidade == null || t.profundidadeCm == null || t.profundidadeCm === dims.profundidade)
  );
  return matches.length === 1 ? matches[0] : null;
}

function findSizeWithinTolerance(
  group: CatalogGroup,
  dims: { largura: number; altura: number; profundidade?: number | null },
  toleranciaCm: number
): CatalogSizeOption | null {
  const matches = group.tamanhos.filter(
    (t) => Math.abs(t.larguraCm - dims.largura) <= toleranciaCm && Math.abs(t.alturaCm - dims.altura) <= toleranciaCm
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * resolveProductMatch — função pura central da política CATALOG-FIRST.
 *
 * Ordem de prioridade determinística (seção 4 do desenho aprovado):
 *  1. SKU/productId explícito
 *  2. productId já conhecido do contexto (sem pedido de troca)
 *  3. grupo de catálogo inequívoco + tamanho citado (letra ou dimensão exata) → EXACT
 *  4. cliente pediu explicitamente personalizado / rejeitou catálogo → CUSTOM_REQUESTED|CUSTOM_REQUIRED
 *  5. grupo inequívoco + dimensão exata que não bate com nenhum tamanho → CUSTOM_REQUIRED (preserva baseCatalogGroupId, baseProductId fica null)
 *  6. grupo inequívoco + dica vaga de tamanho, dentro de tolerância explicitamente configurada → CATALOG_OPTION_AVAILABLE
 *  7a. grupo inequívoco com ZERO tamanhos mapeados (catálogo comercial sem produto operacional, Fase D.2.2) → CATALOG_KNOWN_NO_OPERATIONAL_MATCH
 *  7b. grupo inequívoco com EXATAMENTE 1 tamanho (modelo único, sem P/M/G) → EXACT_CATALOG_MATCH direto
 *  7c. grupo inequívoco com 2+ tamanhos e nenhum informado → AMBIGUOUS (perguntar tamanho)
 *  8. categoria conhecida sem grupo inequívoco → AMBIGUOUS
 *  9. categoria não reconhecida no catálogo ativo → UNSUPPORTED
 */
export function resolveProductMatch(signals: ResolutionSignals, groups: CatalogGroup[]): ResolutionResult {
  const base = (overrides: Partial<ResolutionResult>): ResolutionResult => ({
    resolutionType: "AMBIGUOUS",
    matchedProductId: null,
    matchedProductSku: null,
    catalogGroupId: null,
    baseCatalogGroupId: null,
    baseProductId: null,
    baseProductSku: null,
    clientConfirmed: false,
    matchConfidence: 0,
    customizationRequired: false,
    customizationReason: null,
    suggestedOption: null,
    reasonCode: "AMBIGUOUS_NO_SIGNAL",
    ...overrides,
  });

  // 1. SKU explícito — prioridade máxima, nunca reinterpretado. O LLM só
  // manda um texto (SKU ou id — não distingue); tratamos como candidato a
  // AMBOS aqui, e é justamente por isso que o chamador (qualification_engine
  // ::validateMatchedProduct) SEMPRE revalida contra o Firestore antes de
  // aceitar — nunca confia neste valor sozinho.
  if (signals.explicitSkuOrProductId) {
    return base({
      resolutionType: "EXACT_CATALOG_MATCH",
      matchedProductId: signals.explicitSkuOrProductId,
      matchedProductSku: signals.explicitSkuOrProductId,
      clientConfirmed: true,
      matchConfidence: 1,
      reasonCode: "EXPLICIT_SKU",
    });
  }

  const group: CatalogGroup | null = signals.groupNameOrAlias ? findGroupByNameOrAlias(groups, signals.groupNameOrAlias) : null;

  // 2. Grupo não identificado, mas havia um em contexto (conversa em andamento) e cliente não pediu troca.
  const contextGroup =
    !group && signals.contextCatalogGroupId ? groups.find((g) => g.catalogGroupId === signals.contextCatalogGroupId) || null : null;
  const effectiveGroup = group || contextGroup;

  const contextGroupIdForCustom = effectiveGroup?.catalogGroupId || signals.contextCatalogGroupId || null;

  // 4a. Pedido explícito de personalização, sem grupo nem produto em contexto → nada para basear.
  if (signals.customerExplicitlyRequestsCustom && !contextGroupIdForCustom && !signals.contextMatchedProductId) {
    return base({
      resolutionType: "CUSTOM_REQUIRED",
      customizationRequired: true,
      customizationReason: "Cliente pediu produto sob medida sem produto/grupo de referência.",
      reasonCode: "CUSTOM_REQUESTED_NO_BASE",
    });
  }

  // 4b. Pedido explícito de personalização com grupo e/ou produto de referência → preserva base
  // (baseCatalogGroupId = família; baseProductId = SKU real só se um tamanho já havia sido
  // resolvido — em turno anterior via contextMatchedProductId, OU no MESMO turno quando o
  // cliente cita modelo+tamanho e personalização juntos, ex.: "Quero a caixa tampa de correr
  // M, mas em 35x25x10" — aqui "M" resolve um SKU real dentro do próprio turno).
  if (signals.customerExplicitlyRequestsCustom && (contextGroupIdForCustom || signals.contextMatchedProductId)) {
    const sizeResolvedThisTurn = signals.catalogSizeLabel && effectiveGroup ? findSizeByLabel(effectiveGroup, signals.catalogSizeLabel) : null;
    return base({
      resolutionType: "CUSTOM_REQUESTED",
      catalogGroupId: contextGroupIdForCustom,
      baseCatalogGroupId: contextGroupIdForCustom,
      baseProductId: sizeResolvedThisTurn?.vitreProductId || signals.contextMatchedProductId || null,
      baseProductSku: sizeResolvedThisTurn?.vitreProductSku || signals.contextMatchedProductSku || null,
      customizationRequired: true,
      customizationReason: "Cliente pediu alteração explícita sobre um produto/grupo de catálogo já identificado.",
      reasonCode: "CUSTOM_REQUESTED_WITH_BASE",
    });
  }

  if (!effectiveGroup) {
    // 9. categoria citada mas não reconhecida em nenhum grupo ativo.
    if (signals.categoria && groups.length > 0 && !groups.some((g) => normalize(g.categoria) === normalize(signals.categoria!))) {
      return base({ resolutionType: "UNSUPPORTED", reasonCode: "CATEGORY_NOT_SUPPORTED" });
    }
    // 8. categoria conhecida (ou nenhuma) sem grupo inequívoco.
    return base({ reasonCode: "AMBIGUOUS_GROUP_NOT_IDENTIFIED" });
  }

  // 3. Tamanho citado por letra/rótulo.
  if (signals.catalogSizeLabel) {
    const size = findSizeByLabel(effectiveGroup, signals.catalogSizeLabel);
    if (size) {
      return base({
        resolutionType: "EXACT_CATALOG_MATCH",
        matchedProductId: size.vitreProductId,
        matchedProductSku: size.vitreProductSku,
        catalogGroupId: effectiveGroup.catalogGroupId,
        clientConfirmed: true,
        matchConfidence: 1,
        suggestedOption: size,
        reasonCode: "EXACT_SIZE_LABEL",
      });
    }
  }

  // 3b. Dimensão exata citada.
  if (signals.exactDimensionsCm) {
    const exact = findSizeByExactDimensions(effectiveGroup, signals.exactDimensionsCm);
    if (exact) {
      return base({
        resolutionType: "EXACT_CATALOG_MATCH",
        matchedProductId: exact.vitreProductId,
        matchedProductSku: exact.vitreProductSku,
        catalogGroupId: effectiveGroup.catalogGroupId,
        clientConfirmed: true,
        matchConfidence: 1,
        suggestedOption: exact,
        reasonCode: "EXACT_DIMENSIONS",
      });
    }
    // 5. Dimensão exata que não bate com nenhum tamanho do grupo → personalização, preserva o GRUPO
    // como base (nunca o grupo dentro de baseProductId — nenhum SKU real foi selecionado aqui).
    return base({
      resolutionType: "CUSTOM_REQUIRED",
      catalogGroupId: effectiveGroup.catalogGroupId,
      baseCatalogGroupId: effectiveGroup.catalogGroupId,
      baseProductId: null,
      customizationRequired: true,
      customizationReason: `Medida ${signals.exactDimensionsCm.largura}x${signals.exactDimensionsCm.altura} não corresponde a nenhum tamanho de catálogo do grupo "${effectiveGroup.nome}".`,
      reasonCode: "EXACT_DIMENSIONS_NO_CATALOG_MATCH",
    });
  }

  // 6. Dica vaga de tamanho, só vira opção sugerida se toleranciaCm estiver explicitamente configurada.
  if (signals.vagueSizeHintCm != null && effectiveGroup.toleranciaCm != null) {
    const near = findSizeWithinTolerance(
      effectiveGroup,
      { largura: signals.vagueSizeHintCm, altura: signals.vagueSizeHintCm },
      effectiveGroup.toleranciaCm
    );
    if (near) {
      const confirmed = signals.clientConfirmedSuggestedOption === true;
      return base({
        resolutionType: confirmed ? "EXACT_CATALOG_MATCH" : "CATALOG_OPTION_AVAILABLE",
        matchedProductId: confirmed ? near.vitreProductId : null,
        matchedProductSku: confirmed ? near.vitreProductSku : null,
        catalogGroupId: effectiveGroup.catalogGroupId,
        clientConfirmed: confirmed,
        matchConfidence: confirmed ? 1 : 0.5,
        suggestedOption: near,
        reasonCode: confirmed ? "OPTION_CONFIRMED_BY_CLIENT" : "OPTION_SUGGESTED_PENDING_CONFIRMATION",
      });
    }
  }

  // 7a. Grupo inequívoco, ZERO tamanhos mapeados (nenhum vitreProductId ainda) —
  // catálogo comercial conhecido, sem produto operacional. Nunca UNSUPPORTED
  // (o modelo É reconhecido) nem CUSTOM_* (o cliente não pediu nada fora do
  // padrão — é o ERP que ainda não tem o mapeamento).
  if (effectiveGroup.tamanhos.length === 0) {
    return base({
      resolutionType: "CATALOG_KNOWN_NO_OPERATIONAL_MATCH",
      catalogGroupId: effectiveGroup.catalogGroupId,
      reasonCode: "CATALOG_KNOWN_NO_PRODUCT_REF",
    });
  }

  // 7b. Grupo inequívoco com EXATAMENTE 1 tamanho (modelo único, sem P/M/G —
  // ex.: troféus) — nenhuma ambiguidade possível, resolve direto sem exigir
  // que o cliente/LLM cite um rótulo de tamanho que nem existe para esse modelo.
  if (effectiveGroup.tamanhos.length === 1) {
    const unico = effectiveGroup.tamanhos[0];
    return base({
      resolutionType: "EXACT_CATALOG_MATCH",
      matchedProductId: unico.vitreProductId,
      matchedProductSku: unico.vitreProductSku,
      catalogGroupId: effectiveGroup.catalogGroupId,
      clientConfirmed: true,
      matchConfidence: 1,
      suggestedOption: unico,
      reasonCode: "EXACT_SINGLE_VARIANT_GROUP",
    });
  }

  // 7c. Grupo inequívoco, mas nenhum tamanho informado (nem exato nem vago), e
  // o grupo tem 2+ variantes reais (ex.: caixas P/M/G) → perguntar tamanho.
  return base({
    catalogGroupId: effectiveGroup.catalogGroupId,
    reasonCode: "AMBIGUOUS_SIZE_NOT_INFORMED",
  });
}
