/**
 * technical_briefing.ts — schema técnico canônico (sprint P0.3, Bloco A).
 *
 * Resolve o bloqueio real identificado na sprint anterior: `orchestrator.ts`
 * usava nomes/unidades do briefing CONVERSACIONAL genérico (larguraMm,
 * material como texto livre — pensado para catálogo/Vitre, onde não há
 * cálculo geométrico) enquanto `quote_core.ts` (motor real) espera nomes
 * técnicos exatos (`larg`/`alt`/`prof` em cm, `matKey`, `esp` em mm).
 * `missingFields` do orchestrator não batia com o que as Tools de produto
 * personalizado realmente exigiam.
 *
 * TechnicalBriefing é o schema ÚNICO que tanto o orchestrator quanto o
 * quote_core consomem para produto VR personalizado — elimina a
 * duplicidade, não cria uma terceira representação.
 *
 * Unidade canônica interna: MILÍMETROS (mm) — decisão do sprint (Bloco A2).
 * A conversão cm/m→mm acontece UMA vez, na borda (parseFlexibleLength),
 * nunca espalhada pelas Functions. `quote_core.ts`/`recipes.ts` continuam
 * trabalhando em CENTÍMETROS internamente (é a unidade das fórmulas
 * PLAN_RECIPES portadas fielmente do frontend — mudar isso reabriria risco
 * de quebrar a paridade geométrica já comprovada) — a conversão mm→cm
 * acontece explicitamente em UM ÚNICO ponto (toQuoteCoreInput), documentado
 * abaixo, não em cada Function.
 */

import { PLAN_BUILTIN_NAMES, resolveRecipe } from "./recipes";
import type { MaterialConfig } from "./types";

export interface TechnicalDimensions {
  larguraMm: number | null;   // L
  alturaMm: number | null;    // A
  profundidadeMm: number | null; // P — só produtos dim3d
}

/**
 * Rodada "qualificação comercial" (2026-10-21) — até aqui, TODO produto
 * personalizado (caixa/troféu/placa) era tratado com o MESMO conjunto
 * fixo de 7 campos geométricos, mesmo quando isso não fazia sentido
 * (troféu não tem receita/geometria — recipes.ts não tem nenhuma entrada
 * para ele, de propósito, para nunca acionar o hardcode legado "Troféu
 * GoJovem" no fluxo V2). `categoriaComercial` é o campo que finalmente
 * distingue isso — setado UMA vez, no primeiro seed do briefing
 * (catalog_tools.ts, a partir da `categoria` já extraída pelo LLM/
 * resolveProductMatch), nunca inferido de outra forma. Ausente/undefined
 * (briefings antigos, antes desta rodada) é tratado como "caixa" —
 * preserva 100% o comportamento geométrico já existente, zero regressão.
 */
export type CategoriaComercial = "caixa" | "trofeu" | "placa";

export interface TechnicalBriefing {
  productId: string | null; // = nome da receita (PLAN_RECIPES) hoje — ver nota em recipes.ts sobre não usar erp_plan_produtos
  recipeVersion: number;    // fixo em 1 enquanto não houver versionamento de receita embutida
  dimensions: TechnicalDimensions;
  quantity: number | null;
  materialId: string | null;  // = matKey (cfg_N)
  thicknessMm: number | null; // esp
  /** Rodada "qualificação comercial" — ver CategoriaComercial acima. */
  categoriaComercial?: CategoriaComercial | null;
  /** Caixa — "pra que você vai usar essa caixa?" (orienta espessura/tampa/acabamento). */
  finalidadeUso?: string | null;
  /** Caixa — true/false explícito; null = ainda não perguntado. */
  temTampa?: boolean | null;
  /** Caixa — só relevante quando temTampa===true. */
  tampaModelo?: string | null;
  /**
   * Troféu/placa — descrição do modelo/referência que o cliente já tem em
   * mente, OU "sem_modelo" quando o cliente explicitamente não tem
   * nenhuma referência (nunca inventado — só gravado quando o cliente diz
   * de fato que não tem modelo, para então oferecer o catálogo em vez de
   * ficar perguntando em loop).
   */
  modeloReferencia?: string | null;
  /** Troféu/placa — cliente mandou alguma imagem/arquivo como referência. */
  arquivoRecebido?: boolean | null;
  /**
   * Troféu/placa — true só quando CONFIRMADO que o arquivo é pronto para
   * produção (vetor/arte final); false quando é só referência visual
   * (ex.: imagem gerada por IA, foto de catálogo concorrente — nunca
   * assumido como produtivo automaticamente). null = ainda não perguntado/
   * confirmado.
   */
  arquivoEhProdutivo?: boolean | null;
  /** Placa sem arte pronta — o que o cliente quer que apareça na peça (texto/logo/telefone/QR/etc., livre). */
  conteudoDesejado?: string | null;
  /** Placa — true quando o cliente já tem arte pronta; false quando não tem (então pede conteudoDesejado); null = ainda não perguntado. */
  temArte?: boolean | null;
  /**
   * Troféu/placa — true quando já oferecemos o catálogo de referência
   * (catalog_comercial.ts) nesta conversa, mesmo que o cliente não tenha
   * modelo nenhum — evita ficar perguntando "tem modelo?" para sempre
   * quando a resposta já foi "não" e o catálogo (com ou sem link ainda)
   * já foi oferecido.
   */
  catalogoReferenciaOferecido?: boolean | null;
  /**
   * Sprint P0.4 — consumíveis que afetam preço (Bloco C), rastreados aqui
   * para que technicalBriefingFingerprint() detecte mudança neles também
   * (nunca só geometria/material). null/undefined = nunca informado
   * nesta conversa (equivalente a false para fins de preço).
   */
  adesivo?: boolean | null;
  adesivoBranco?: boolean | null;
  /**
   * Sprint P0.6 (Bloco C) — chaves de itens que o cliente pediu além do
   * produto em si (gravacao/spray/extra/montagem/deslocamento/desconto/
   * acrescimo). Afeta a elegibilidade do cálculo (vira
   * HUMAN_VALIDATION_REQUIRED) — por isso participa do fingerprint, igual
   * a adesivo/adesivoBranco. Extraído pelo LLM (linguagem natural), nunca
   * decidido por ele quando agir.
   */
  solicitacoesNaoSuportadas?: string[] | null;
  /**
   * Sprint P1.2 — sinal de bloqueio determinístico (complexity_detector.ts):
   * quando não-vazio, o produto pedido tem elementos que nenhuma receita
   * conhecida cobre (LED, motor, madeira, componente elétrico externo
   * etc.). O orchestrator trava nextAction="handoff" ANTES de qualquer
   * readiness/pricing enquanto este campo estiver presente — nunca
   * limpo automaticamente (mesma disciplina de solicitacoesNaoSuportadas).
   */
  unsupportedComplexityReasonCodes?: string[] | null;
  /**
   * Sprint P0.6 — sinais de controle, nunca de preço (por isso NUNCA
   * entram em technicalBriefingFingerprint). O LLM só EXTRAI esses sinais
   * da linguagem do cliente (confirmação explícita do preço mostrado,
   * pergunta sobre prazo, data-limite informada) — quem DECIDE agir sobre
   * eles é sempre o orchestrator/action_executor, nunca o LLM escolhendo
   * chamar uma Tool. Cada um é consumido (limpo) pelo action_executor
   * depois de executado, para nunca reexecutar em loop.
   */
  clientConfirmedQuote?: boolean | null;
  wantsDeadlineCheck?: boolean | null;
  dataNecessidadeCliente?: string | null;
  /**
   * ValerIA 2.0 (Fase B/C, 2026-09-19, revisado) — rastreabilidade opcional:
   * quando a personalização nasceu de uma tentativa de encaixe no catálogo
   * (CUSTOM_REQUESTED/CUSTOM_REQUIRED em product_resolution.ts), guarda a
   * referência de origem. Campos SEPARADOS de propósito (nunca um grupo
   * salvo dentro de um campo "productId", nunca um SKU confundido com id):
   *   baseCatalogGroupId = família/modelo comercial de origem, sempre que
   *                        existir (ex.: "caixa_tampa_de_correr").
   *   baseProductId      = ID REAL do documento vitre_produtos, só quando
   *                        um tamanho específico já havia sido resolvido
   *                        antes do pedido de personalização.
   *   baseProductSku     = SKU correspondente a baseProductId (hoje
   *                        coincidem em valor — vitre_produtos usa o
   *                        próprio SKU como id do documento — mas são
   *                        conceitos diferentes; ver product_resolution.ts).
   * Só contexto para revisão humana e defaults de source=CATALOG_GROUP —
   * NUNCA lidos por computeTechnicalReadiness/resolveRecipe/quote_core
   * (geometria e preço continuam dependendo só dos campos técnicos abaixo).
   */
  baseCatalogGroupId?: string | null;
  baseProductId?: string | null;
  baseProductSku?: string | null;
  /**
   * Fase E.1.2 (2026-09-20) — defesa em profundidade: mesma marca de teste
   * de `atendimentos/{conversationId}.isTeste`, propagada por
   * catalog_tools.ts na primeira vez que o briefing é semeado a partir de
   * CUSTOM_REQUESTED/CUSTOM_REQUIRED (nunca inferida aqui, nunca vinda do
   * LLM). Opcional/nullable porque o TechnicalBriefing legado (V1) nunca
   * preenche este campo — `undefined`/`null` não significa "não é teste",
   * só "origem não propagou" (consumidores que precisarem saber com
   * certeza continuam podendo consultar atendimentos/{conversationId}.isTeste).
   */
  isTest?: boolean | null;
  confirmedFields: string[];
  missingRequiredFields: string[];
}

const CAMPO_ORDEM = ["productId", "larguraMm", "alturaMm", "profundidadeMm", "quantity", "materialId", "thicknessMm"] as const;

export function emptyTechnicalBriefing(): TechnicalBriefing {
  return {
    productId: null,
    recipeVersion: 1,
    dimensions: { larguraMm: null, alturaMm: null, profundidadeMm: null },
    quantity: null,
    materialId: null,
    thicknessMm: null,
    solicitacoesNaoSuportadas: null,
    unsupportedComplexityReasonCodes: null,
    clientConfirmedQuote: null,
    wantsDeadlineCheck: null,
    dataNecessidadeCliente: null,
    baseCatalogGroupId: null,
    baseProductId: null,
    baseProductSku: null,
    isTest: null,
    categoriaComercial: null,
    finalidadeUso: null,
    temTampa: null,
    tampaModelo: null,
    modeloReferencia: null,
    arquivoRecebido: null,
    arquivoEhProdutivo: null,
    conteudoDesejado: null,
    temArte: null,
    catalogoReferenciaOferecido: null,
    confirmedFields: [],
    missingRequiredFields: [...CAMPO_ORDEM],
  };
}

/**
 * Bloco A2 — conversão de unidade na borda, uma única vez.
 * Aceita number (assume mm) ou string com unidade explícita
 * ("15cm", "150mm", "0,15m", "15 cm"). Nunca adivinha unidade por
 * heurística de magnitude — se a Tool não informar unidade e o valor for
 * ambíguo, o chamador deve passar string explícita.
 */
export function parseFlexibleLength(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const s = String(input).trim().toLowerCase().replace(",", ".");
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
  if (!m) return null;
  const valor = parseFloat(m[1]);
  const unidade = m[2] || "mm";
  if (unidade === "mm") return valor;
  if (unidade === "cm") return valor * 10;
  if (unidade === "m") return valor * 1000;
  return null;
}

/**
 * P0.4 (achado real de E2E) — largura/altura/profundidade: quando o
 * cliente fala "40x30x25cm" e o LLM manda um número puro sem unidade, é
 * CENTÍMETRO (convenção do motor de cálculo, calcular_produto_
 * personalizado's larg/alt/prof) — nunca milímetro. parseFlexibleLength()
 * sozinho assume mm num número puro, o que é certo para espessura (ex.
 * "5" = 5mm) mas errado para dimensão (faria "40" virar 40mm em vez de
 * 400mm, encolhendo a peça 10x). Use esta função só para largura/altura/
 * profundidade; espessura continua em parseFlexibleLength() direto.
 */
export function parseDimensionLengthMm(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const s = String(input).trim();
  if (/[a-zA-Z]/.test(s)) return parseFlexibleLength(s); // unidade explícita, ex. "40cm"/"400mm"
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n * 10 : null; // número puro = cm
}

/**
 * Bloco A3 — material canônico. Nunca aceita "acrílico cristal 3mm" como
 * identificador técnico — resolve para o matKey real (cfg_N) comparando
 * com a lista de materiais REAL do ERP (mesma fonte de
 * valeriaListarMateriais). Retorna null se não conseguir resolver com
 * confiança (nunca aproxima "chute").
 *
 * Bloco H (sprint P0.3, achado real de E2E conversacional) — famílias de
 * material real são nomeadas por linha + espessura ("Acrílico Cristal
 * 2mm".."20mm", 11 variantes) — "acrílico cristal" sozinho é
 * genuinamente ambíguo (11 candidatos parciais). Quando o chamador já
 * informou `espMm` NA MESMA chamada (dado real, não inventado), usa isso
 * para desempatar ENTRE os candidatos já filtrados pelo nome — nunca
 * para ampliar a busca, só para escolher entre opções que já bateram no
 * texto. Se não restar exatamente 1 depois do desempate, continua
 * retornando null (mesma disciplina de nunca aproximar).
 *
 * Bloco H (achado real de E2E conversacional via Chatvolt) — o LLM
 * reescreve o texto do material de formas imprevisíveis mesmo quando o
 * cliente disse o nome exato: sem acento ("acrilico cristal"), com
 * underscore no lugar de espaço ("acrilico_cristal"), etc. Comparação
 * por substring exato quebrava a cada variação nova. `tokenizar` reduz
 * tanto o texto recebido quanto o nome real a um conjunto de palavras
 * (remove acento, minúsculo, quebra em qualquer separador não
 * alfanumérico) — o match exige que TODAS as palavras do texto recebido
 * apareçam no nome real, nunca aproxima palavra nenhuma. Ainda é um
 * match exato de conteúdo, só tolerante a formatação/pontuação.
 */
function tokenizar(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function resolveMaterialId(
  textoOuMatKey: string,
  materiaisReais: Array<{ matKey: string; nome: string }>,
  espMm?: number | null
): string | null {
  const alvo = textoOuMatKey.trim();
  if (!alvo) return null;
  // Já é um matKey válido (veio de uma Tool anterior, ex.: consultar_materiais_vr)
  if (materiaisReais.some((m) => m.matKey === alvo)) return alvo;
  const alvoTokens = tokenizar(alvo);
  if (alvoTokens.length === 0) return null;
  // Match exato — mesmo conjunto de palavras, em qualquer ordem/separador
  const porNomeExato = materiaisReais.find((m) => {
    const nomeTokens = tokenizar(m.nome);
    return nomeTokens.length === alvoTokens.length && alvoTokens.every((t) => nomeTokens.includes(t));
  });
  if (porNomeExato) return porNomeExato.matKey;
  // Match parcial (todas as palavras do texto aparecem no nome real, nome pode ter mais) — só aceita se INEQUÍVOCO
  const porNomeParcial = materiaisReais.filter((m) => {
    const nomeTokens = tokenizar(m.nome);
    return alvoTokens.every((t) => nomeTokens.includes(t));
  });
  if (porNomeParcial.length === 1) return porNomeParcial[0].matKey;
  if (porNomeParcial.length > 1 && espMm != null && espMm > 0) {
    const porEspessura = porNomeParcial.filter((m) => {
      const mm = m.nome.match(/(\d+(?:\.\d+)?)\s*mm/i);
      return mm && parseFloat(mm[1]) === espMm;
    });
    if (porEspessura.length === 1) return porEspessura[0].matKey;
  }
  return null;
}

/**
 * Bloco A5 — quoteReadiness técnico: os MESMOS campos que quote_core
 * exige, nunca uma lista paralela. `productId` reconhecido determina se
 * `profundidadeMm` é obrigatório (dim3d).
 */
export function computeTechnicalReadiness(b: TechnicalBriefing): {
  ready: boolean;
  missingRequiredFields: string[];
  reconhecido: boolean;
} {
  const reconhecido = !!b.productId && PLAN_BUILTIN_NAMES.includes(b.productId);
  const rec = b.productId ? resolveRecipe(b.productId) : null;

  // Troféu nunca tem receita/geometria (de propósito — ver nota de
  // CategoriaComercial acima) — nunca exige largura/espessura/material
  // para CÁLCULO DE PREÇO automático (isso sempre segue humano/handoff,
  // igual já era antes desta rodada). Preço continua sem mudança nenhuma
  // para caixa/placa (mesmos 7 campos geométricos de sempre) — só troféu
  // sai do bloqueio de pricing que nunca fazia sentido para ele.
  if (b.categoriaComercial === "trofeu") {
    const missing: string[] = [];
    if (!b.quantity || b.quantity <= 0) missing.push("quantity");
    return { ready: false, missingRequiredFields: missing, reconhecido: false };
  }

  const missing: string[] = [];
  if (!b.productId) missing.push("productId");
  if (!(b.dimensions.larguraMm && b.dimensions.larguraMm > 0)) missing.push("larguraMm");
  if (!(b.dimensions.alturaMm && b.dimensions.alturaMm > 0)) missing.push("alturaMm");
  if (rec?.dim3d && !(b.dimensions.profundidadeMm && b.dimensions.profundidadeMm > 0)) missing.push("profundidadeMm");
  if (!(b.thicknessMm && b.thicknessMm > 0)) missing.push("thicknessMm");
  if (!b.materialId) missing.push("materialId");
  if (!(b.quantity && b.quantity > 0)) missing.push("quantity");

  return { ready: missing.length === 0, missingRequiredFields: missing, reconhecido };
}

/**
 * Rodada "qualificação comercial" (2026-10-21) — camada NOVA, separada de
 * `computeTechnicalReadiness` de propósito: a readiness acima só decide
 * "posso calcular preço automaticamente" (nunca mudou de comportamento
 * nesta rodada, exceto o caso trófeu acima, que já era sempre
 * handoff/humano). Esta função decide "o que a ValerIA deve perguntar
 * AGORA, em que ordem, por tipo de produto" — nunca pergunta tudo de uma
 * vez, nunca repete o que já foi respondido (mesma disciplina de
 * mergeTechnicalBriefing: um campo `null` significa "ainda não
 * perguntado/respondido", nunca "não se aplica").
 *
 * Retorna só CHAVES de campo (strings) — nunca um `NextAction` (esse tipo
 * vive em qualification_engine.ts; manter este módulo sem essa
 * dependência, como já era antes). `qualification_engine.ts` traduz a
 * chave para o `nextAction`/`questionContext` que o LLM recebe.
 */
export function computeQualificationGaps(b: TechnicalBriefing): {
  category: CategoriaComercial;
  missingQualificationFields: string[];
  nextField: string | null;
} {
  const category: CategoriaComercial = b.categoriaComercial ?? "caixa";

  if (category === "trofeu") {
    const ordem: string[] = [];
    if (b.modeloReferencia == null) {
      ordem.push("modeloReferencia"); // nunca perguntado ainda
    } else if (b.modeloReferencia === "sem_modelo" && !b.catalogoReferenciaOferecido) {
      ordem.push("catalogoReferenciaOferecido"); // cliente já disse que não tem — oferecer catálogo
    }
    if (b.arquivoRecebido === true && b.arquivoEhProdutivo == null) ordem.push("arquivoEhProdutivo");
    if (!(b.quantity && b.quantity > 0)) ordem.push("quantity");
    return { category, missingQualificationFields: ordem, nextField: ordem[0] ?? null };
  }

  if (category === "placa") {
    const rec = b.productId ? resolveRecipe(b.productId) : null;
    const ordem: string[] = [];
    if (!(b.dimensions.larguraMm && b.dimensions.larguraMm > 0)) ordem.push("larguraMm");
    if (!(b.dimensions.alturaMm && b.dimensions.alturaMm > 0)) ordem.push("alturaMm");
    if (rec?.dim3d && !(b.dimensions.profundidadeMm && b.dimensions.profundidadeMm > 0)) ordem.push("profundidadeMm");
    if (b.temArte == null) ordem.push("temArte");
    else if (b.temArte === true) {
      if (b.arquivoRecebido !== true) ordem.push("arquivoRecebido"); // pede o arquivo em si
      else if (b.arquivoEhProdutivo == null) ordem.push("arquivoEhProdutivo"); // confirma se é produtivo
    } else if (!b.conteudoDesejado) {
      ordem.push("conteudoDesejado");
    }
    if (!(b.thicknessMm && b.thicknessMm > 0)) ordem.push("thicknessMm");
    if (!b.materialId) ordem.push("materialId");
    if (!(b.quantity && b.quantity > 0)) ordem.push("quantity");
    return { category, missingQualificationFields: ordem, nextField: ordem[0] ?? null };
  }

  // caixa (default — inclui briefings antigos sem categoriaComercial setado)
  const rec = b.productId ? resolveRecipe(b.productId) : null;
  const ordem: string[] = [];
  if (!(b.dimensions.larguraMm && b.dimensions.larguraMm > 0)) ordem.push("larguraMm");
  if (!(b.dimensions.alturaMm && b.dimensions.alturaMm > 0)) ordem.push("alturaMm");
  if (rec?.dim3d && !(b.dimensions.profundidadeMm && b.dimensions.profundidadeMm > 0)) ordem.push("profundidadeMm");
  if (!b.finalidadeUso) ordem.push("finalidadeUso");
  if (!(b.thicknessMm && b.thicknessMm > 0)) ordem.push("thicknessMm");
  if (!b.materialId) ordem.push("materialId");
  if (b.temTampa == null) ordem.push("temTampa");
  else if (b.temTampa === true && !b.tampaModelo) ordem.push("tampaModelo");
  if (!(b.quantity && b.quantity > 0)) ordem.push("quantity");
  return { category, missingQualificationFields: ordem, nextField: ordem[0] ?? null };
}

/**
 * Bloco A4 — adaptador technicalBriefing → quote_core (a ÚNICA conversão
 * mm→cm do sistema). `larg`/`alt`/`prof` de quote_core são em CENTÍMETROS
 * (fórmulas PLAN_RECIPES originais do frontend); `esp` é em MILÍMETROS
 * (mesma unidade que o frontend sempre usou para espessura).
 */
export function toQuoteCoreInput(b: TechnicalBriefing): {
  produto: string; larg: number; alt: number; prof?: number; esp: number; matKey: string; qty: number;
} | null {
  const readiness = computeTechnicalReadiness(b);
  if (!readiness.ready) return null;
  return {
    produto: b.productId!,
    larg: b.dimensions.larguraMm! / 10,
    alt: b.dimensions.alturaMm! / 10,
    prof: b.dimensions.profundidadeMm ? b.dimensions.profundidadeMm / 10 : undefined,
    esp: b.thicknessMm!,
    matKey: b.materialId!,
    qty: b.quantity!,
  };
}

export function materiaisParaResolucao(materiais: MaterialConfig[]): Array<{ matKey: string; nome: string }> {
  return materiais.map((m, i) => ({ matKey: `cfg_${i}`, nome: m.nome || `Material ${i + 1}` }));
}

/**
 * Sprint P0.4 (P0.2) — fingerprint determinístico dos campos que afetam
 * PREÇO, nunca dos campos derivados (confirmedFields/missingRequiredFields/
 * recipeVersion). Usado para detectar se uma simulação já calculada ainda
 * corresponde ao briefing ATUAL da conversa — se qualquer campo aqui
 * mudar (quantidade, material, espessura, largura, altura, profundidade,
 * adesivo, adesivoBranco), o fingerprint muda e a simulação anterior é
 * tratada como desatualizada. Não é um hash criptográfico — só precisa
 * ser determinístico e sensível a qualquer mudança real, uma string JSON
 * normalizada já cumpre isso e fica auditável em log.
 */
export function technicalBriefingFingerprint(b: TechnicalBriefing): string {
  return JSON.stringify({
    productId: b.productId,
    larguraMm: b.dimensions.larguraMm,
    alturaMm: b.dimensions.alturaMm,
    profundidadeMm: b.dimensions.profundidadeMm,
    quantity: b.quantity,
    materialId: b.materialId,
    thicknessMm: b.thicknessMm,
    adesivo: !!b.adesivo,
    adesivoBranco: !!b.adesivoBranco,
    // P0.6 — afeta elegibilidade (HUMAN_VALIDATION_REQUIRED), por isso
    // participa do fingerprint igual a adesivo/adesivoBranco. Ordenado
    // para que a mesma lista em ordem diferente gere o mesmo fingerprint.
    solicitacoesNaoSuportadas: [...(b.solicitacoesNaoSuportadas ?? [])].sort(),
  });
}
