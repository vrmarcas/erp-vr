/**
 * vitre.ts — Catálogo Vitre e Orçamento de Catálogo (FASE G, 2026-08-06).
 *
 * Modelo de dados: documento-por-produto (`vitre_produtos/{produtoId}`),
 * nunca um array agregado — exatamente a lição da correção de estoque
 * desta mesma auditoria (Rules não conseguem proteger "criar" de
 * "aprovar preço" quando ambos são só "sobrescrever o array inteiro").
 * Mesma fronteira de identidade das demais Functions desta auditoria:
 * papel exclusivamente de context.auth, reconferido contra
 * erp_vr_usuarios/{uid}, nunca do payload.
 *
 * Coleções:
 *   vitre_produtos/{produtoId}              — produto/variante (núcleo)
 *   vitre_categorias/{categoriaId}           — categorias
 *   vitre_familias/{familiaId}               — famílias de produto
 *   vitre_produto_historico/{id}             — histórico de preço/mudanças
 *   vitre_produto_auditoria/{id}             — auditoria de CRUD
 *   vitre_importacoes/{id}                   — histórico de importações
 *   vitre_orcamentos/{orcamentoId}           — orçamento de catálogo (snapshot)
 *   vitre_idem_keys/{key}                    — idempotência
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { getCallerVerificado, requireRole, acquireIdem as acquireIdemShared, writeAudit as writeAuditShared } from "./auth_helper";

const COL_PRODUTOS = "vitre_produtos";
const COL_HIST = "vitre_produto_historico";
const COL_IMPORT = "vitre_importacoes";
const COL_ORC = "vitre_orcamentos";
const COL_IDEM = "vitre_idem_keys";
const COL_AUDIT = "vitre_audit_log";

function acquireIdem(key: string) { return acquireIdemShared(COL_IDEM, key); }
function writeAudit(action: string, uid: string, role: string, detail: Record<string, unknown>) {
  return writeAuditShared(COL_AUDIT, action, uid, role, detail);
}

// ══════════════════════════════════════════════════════════════════════════
// Nível de completude (FASE G, B3) — calculado a partir dos campos
// presentes, nunca armazenado "cru" sem recomputar (evita nível
// desatualizado depois de uma edição parcial).
// ══════════════════════════════════════════════════════════════════════════
export interface VitreProduto {
  sku: string;
  nome: string;
  marca: "vitre";
  categoria?: string | null;
  familia?: string | null;
  produtoPaiId?: string | null;
  variante?: string | null;
  status: "ativo" | "inativo";
  // comercial
  custo?: number | null;
  precoVenda?: number | null;
  lucroBruto?: number | null;
  margemBruta?: number | null;
  markup?: number | null;
  descontoMaximoPct?: number | null;
  qtyMinima?: number | null;
  prazoDias?: number | null;
  disponibilidade?: "pronta_entrega" | "sob_encomenda" | "sob_encomenda_opcoes_limitadas" | "indisponivel" | null;
  // estoque de peças já prontas (unidades acabadas em prateleira, não matéria-prima) —
  // usado só pela conversão de orçamento Vitre em OS (Parte 9 da homologação)
  estoqueProntoUnidades?: number | null;
  // dimensões
  espessuraMm?: number | null;
  comprimentoCm?: number | null;
  larguraCm?: number | null;
  alturaCm?: number | null;
  pesoKg?: number | null;
  embalagem?: string | null;
  // venda
  descricaoCurta?: string | null;
  descricaoCompleta?: string | null;
  beneficios?: string[] | null;
  usos?: string[] | null;
  palavrasChave?: string[] | null;
  fotos?: string[] | null;
  // personalização
  personalizacoes?: Array<{ nome: string; preco: number }> | null;
  alteracoesProibidas?: string[] | null;
  // produção
  fichaTecnica?: { componentes?: Array<{ nome: string; material: string; espessuraMm: number; qtd: number }>; tempoCorteMin?: number; tempoMontagemMin?: number } | null;
  arquivoCorte?: { caminho: string; versao: number; checksum: string } | null;
  // integrações
  ativoErp?: boolean;
  ativoValeria?: boolean;
  ativoShopify?: boolean;
  idExterno?: string | null;
  // origem/controle
  origem: "planilha" | "manual" | "integracao" | "importacao";
  criadoPorUid?: string;
  criadoEm?: number;
  atualizadoEm?: number;
  camposEditadosManualmente?: string[]; // campos que reimportação NUNCA sobrescreve
}

export function calcularNivelCompletude(p: Partial<VitreProduto>): number {
  const nivel1 = !!(p.sku && p.nome && p.precoVenda != null && p.custo != null && p.status);
  if (!nivel1) return 0;
  const nivel2 = !!(p.categoria && (p.fotos && p.fotos.length) && p.descricaoCurta && p.prazoDias != null && p.embalagem && p.pesoKg != null);
  if (!nivel2) return 1;
  const nivel3 = !!(p.usos && p.usos.length && p.beneficios && p.beneficios.length && p.palavrasChave && p.palavrasChave.length && p.disponibilidade);
  if (!nivel3) return 2;
  const nivel4 = !!(p.fichaTecnica && p.fichaTecnica.componentes && p.fichaTecnica.componentes.length);
  if (!nivel4) return 3;
  return 4;
}

// Fallback para produtos legados sem camposEditadosManualmente rastreado
// individualmente — usado só quando o produto já existe com origem
// "manual" mas nunca teve o rastreamento fino aplicado.
const CAMPOS_PROTEGIDOS_REIMPORTACAO_FALLBACK = ["precoVenda", "custo", "status", "descricaoCurta", "descricaoCompleta", "fotos"];

// ══════════════════════════════════════════════════════════════════════════
// vitreImportarProdutos — importador idempotente. dryRun=true (padrão)
// nunca escreve. SKU duplicado com dados DIFERENTES bloqueia a linha
// (não escolhe automaticamente); mesma linha reimportada com dados
// idênticos é no-op (idempotente de verdade, não só "não duplica").
// Campos editados manualmente (camposEditadosManualmente) NUNCA são
// sobrescritos por uma reimportação — política de origem explícita.
// ══════════════════════════════════════════════════════════════════════════
interface LinhaImportacao {
  sku: string; nome: string; espessuraMm?: number; comprimentoCm?: number; larguraCm?: number;
  alturaCm?: number; custo?: number; precoVenda?: number; embalagem?: string; pesoKg?: number; descricaoCurta?: string;
}
interface ErroImportacao { linha: number; sku: string; tipo: string; detalhe: string; }

export const vitreImportarProdutos = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, [], "importar produtos do catálogo Vitre"); // master-only

  const linhas = Array.isArray(data?.linhas) ? (data.linhas as LinhaImportacao[]) : [];
  const dryRun = data?.dryRun !== false; // padrão: dry-run
  const requestId = String(data?.requestId || "");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");
  if (!linhas.length) throw new functions.https.HttpsError("invalid-argument", "Nenhuma linha para importar.");

  const idemKey = `import:${requestId}`;
  if (!dryRun) {
    const acquired = await acquireIdem(idemKey);
    if (!acquired) return { ok: true, jaProcessado: true };
  }

  const db = admin.firestore();
  const erros: ErroImportacao[] = [];
  const criados: string[] = [];
  const atualizados: string[] = [];
  const semAlteracao: string[] = [];

  // Agrupa por SKU para detectar duplicatas DENTRO da própria planilha.
  const porSku: Record<string, LinhaImportacao[]> = {};
  linhas.forEach((l) => { const k = String(l.sku || "").trim(); if (!porSku[k]) porSku[k] = []; porSku[k].push(l); });

  const linhasValidas: LinhaImportacao[] = [];
  Object.keys(porSku).forEach((sku) => {
    const grupo = porSku[sku];
    if (!sku) { grupo.forEach((_, i) => erros.push({ linha: i, sku: "(vazio)", tipo: "sku_ausente", detalhe: "Linha sem SKU" })); return; }
    if (grupo.length > 1) {
      const distintos = new Set(grupo.map((g) => JSON.stringify(g)));
      if (distintos.size > 1) {
        erros.push({ linha: 0, sku, tipo: "sku_duplicado_conflitante", detalhe: `${grupo.length} linhas com SKU "${sku}" e dados DIFERENTES entre si — bloqueado, requer decisão humana.` });
        return;
      }
    }
    const l = grupo[0];
    if (l.precoVenda == null || isNaN(Number(l.precoVenda))) erros.push({ linha: 0, sku, tipo: "preco_ausente", detalhe: "Preço de venda ausente ou inválido" });
    if (l.custo == null || isNaN(Number(l.custo))) erros.push({ linha: 0, sku, tipo: "custo_ausente", detalhe: "Custo ausente ou inválido" });
    if (l.comprimentoCm == null && l.larguraCm == null && l.alturaCm == null) erros.push({ linha: 0, sku, tipo: "dimensoes_ausentes", detalhe: "Nenhuma dimensão informada" });
    if (l.pesoKg == null) erros.push({ linha: 0, sku, tipo: "peso_ausente", detalhe: "Peso ausente" });
    if (!l.embalagem) erros.push({ linha: 0, sku, tipo: "embalagem_ausente", detalhe: "Tamanho de embalagem ausente" });
    if (!l.descricaoCurta) erros.push({ linha: 0, sku, tipo: "descricao_ausente", detalhe: "Descrição ausente" });
    linhasValidas.push(l);
  });

  for (const l of linhasValidas) {
    const sku = String(l.sku).trim();
    const ref = db.collection(COL_PRODUTOS).doc(sku);
    const snap = await ref.get();
    const existente = snap.exists ? (snap.data() as VitreProduto) : null;
    const protegidos = existente?.camposEditadosManualmente
      && existente.camposEditadosManualmente.length
      ? existente.camposEditadosManualmente
      : (existente?.origem === "manual" ? CAMPOS_PROTEGIDOS_REIMPORTACAO_FALLBACK : []);

    const novoBase: Partial<VitreProduto> = {
      sku, nome: l.nome, marca: "vitre", status: existente?.status || "ativo",
      espessuraMm: l.espessuraMm ?? null, comprimentoCm: l.comprimentoCm ?? null,
      larguraCm: l.larguraCm ?? null, alturaCm: l.alturaCm ?? null,
      custo: l.custo ?? null, precoVenda: l.precoVenda ?? null,
      lucroBruto: (l.precoVenda != null && l.custo != null) ? +(l.precoVenda - l.custo).toFixed(2) : null,
      margemBruta: (l.precoVenda != null && l.custo != null && l.precoVenda > 0) ? +((l.precoVenda - l.custo) / l.precoVenda).toFixed(4) : null,
      embalagem: l.embalagem ?? null, pesoKg: l.pesoKg ?? null, descricaoCurta: l.descricaoCurta ?? null,
    };
    // Política de origem: campo protegido (editado manualmente) nunca é sobrescrito pela reimportação.
    protegidos.forEach((campo) => { if (existente && campo in existente) (novoBase as any)[campo] = (existente as any)[campo]; });

    if (existente) {
      const mudou = JSON.stringify({ ...existente, atualizadoEm: 0 }) !== JSON.stringify({ ...existente, ...novoBase, atualizadoEm: 0 });
      if (!mudou) { semAlteracao.push(sku); continue; }
      atualizados.push(sku);
      if (!dryRun) {
        await ref.set({ ...novoBase, origem: existente.origem === "manual" ? "manual" : "planilha", atualizadoEm: Date.now() }, { merge: true });
        await db.collection(COL_HIST).add({ produtoId: sku, tipo: "reimportacao", precoAntes: existente.precoVenda ?? null, precoDepois: novoBase.precoVenda ?? null, ts: Date.now(), uid: caller.uid });
      }
    } else {
      criados.push(sku);
      if (!dryRun) {
        await ref.set({ ...novoBase, origem: "planilha", ativoErp: true, ativoValeria: false, ativoShopify: false, criadoPorUid: caller.uid, criadoEm: Date.now(), atualizadoEm: Date.now(), camposEditadosManualmente: [] });
      }
    }
  }

  const relatorio = { criados: criados.length, atualizados: atualizados.length, semAlteracao: semAlteracao.length, erros: erros.length, listaCriados: criados, listaAtualizados: atualizados, listaErros: erros };

  if (!dryRun) {
    await db.collection(COL_IMPORT).add({ ...relatorio, uid: caller.uid, ts: Date.now(), requestId });
    await writeAudit("importacao_executada", caller.uid, caller.role, relatorio);
  }

  return { ok: true, dryRun, ...relatorio };
});

// ══════════════════════════════════════════════════════════════════════════
// CRUD do catálogo
// ══════════════════════════════════════════════════════════════════════════
export const vitreCriarOuEditarProduto = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "criar/editar produto do catálogo Vitre — só ficha técnica"); // produção só ficha técnica, ver checagem de campo abaixo

  const sku = String(data?.sku || "").trim();
  const requestId = String(data?.requestId || "");
  const camposComerciais = ["custo", "precoVenda", "descricaoCurta", "descricaoCompleta", "status", "categoria", "familia"];
  const payloadKeys = Object.keys(data || {}).filter((k) => !["sku", "requestId"].includes(k));
  if (!sku) throw new functions.https.HttpsError("invalid-argument", "sku obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  // Produção não pode alterar campos comerciais — só Master pode.
  if (caller.role !== "master") {
    const tentouComercial = payloadKeys.some((k) => camposComerciais.includes(k));
    if (tentouComercial) throw new functions.https.HttpsError("permission-denied", "Perfil \"" + caller.role + "\" não pode alterar campos comerciais do catálogo — só ficha técnica.");
  }

  const idemKey = `crud:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const ref = db.collection(COL_PRODUTOS).doc(sku);
  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existia = snap.exists;
    const atual = existia ? (snap.data() as VitreProduto) : null;
    const camposManuaisNovos = new Set(atual?.camposEditadosManualmente || []);
    payloadKeys.forEach((k) => camposManuaisNovos.add(k));
    const novo: Record<string, unknown> = { ...(atual || {}), ...(data || {}), sku, marca: "vitre", origem: "manual", camposEditadosManualmente: Array.from(camposManuaisNovos), atualizadoEm: Date.now() };
    delete (novo as any).requestId;
    if (!existia) { (novo as any).criadoPorUid = caller.uid; (novo as any).criadoEm = Date.now(); (novo as any).status = novo.status || "ativo"; (novo as any).ativoErp = true; (novo as any).ativoValeria = false; }
    tx.set(ref, novo, { merge: false });
    return { existia, nivel: calcularNivelCompletude(novo as unknown as VitreProduto) };
  });

  await writeAudit(resultado.existia ? "produto_editado" : "produto_criado", caller.uid, caller.role, { sku, nivel: resultado.nivel });
  return { ok: true, jaProcessado: false, sku, nivel: resultado.nivel };
});

export const vitreAtivarDesativarProduto = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, [], "ativar/desativar produto do catálogo"); // master-only
  const sku = String(data?.sku || "").trim();
  const ativo = data?.ativo !== false;
  const requestId = String(data?.requestId || "");
  if (!sku) throw new functions.https.HttpsError("invalid-argument", "sku obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");
  const idemKey = `ativar:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const ref = db.collection(COL_PRODUTOS).doc(sku);
  await ref.set({ status: ativo ? "ativo" : "inativo", atualizadoEm: Date.now() }, { merge: true });
  await writeAudit(ativo ? "produto_ativado" : "produto_desativado", caller.uid, caller.role, { sku });
  return { ok: true, jaProcessado: false };
});

export const vitreDuplicarProduto = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, [], "duplicar produto do catálogo"); // master-only
  const skuOrigem = String(data?.skuOrigem || "").trim();
  const skuNovo = String(data?.skuNovo || "").trim();
  const requestId = String(data?.requestId || "");
  if (!skuOrigem || !skuNovo) throw new functions.https.HttpsError("invalid-argument", "skuOrigem e skuNovo obrigatórios.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");
  const idemKey = `duplicar:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const origemRef = db.collection(COL_PRODUTOS).doc(skuOrigem);
  const novoRef = db.collection(COL_PRODUTOS).doc(skuNovo);
  const resultado = await db.runTransaction(async (tx) => {
    const [origemSnap, novoSnap] = await Promise.all([tx.get(origemRef), tx.get(novoRef)]);
    if (!origemSnap.exists) throw new functions.https.HttpsError("not-found", "Produto de origem não encontrado.");
    if (novoSnap.exists) throw new functions.https.HttpsError("already-exists", "SKU_JA_EXISTE:" + skuNovo);
    const origem = origemSnap.data() as VitreProduto;
    tx.set(novoRef, { ...origem, sku: skuNovo, produtoPaiId: skuOrigem, origem: "manual", criadoPorUid: caller.uid, criadoEm: Date.now(), atualizadoEm: Date.now() });
    return { skuNovo };
  });
  await writeAudit("produto_duplicado", caller.uid, caller.role, { skuOrigem, skuNovo });
  return { ok: true, jaProcessado: false, ...resultado };
});

// ══════════════════════════════════════════════════════════════════════════
// Orçamento de Catálogo — Vitre. Snapshot do produto no momento da
// criação (nunca recalcula planificação/matéria-prima — B7-B9).
//
// HOTFIX orcamento-vitre-wizard (2026-08-06): cálculo financeiro
// migrado para centavos inteiros como fonte de verdade (nunca ponto
// flutuante) — os campos decimais (subtotal/total/...) continuam
// gravados para compatibilidade com PDF/WhatsApp/telas existentes,
// mas são sempre DERIVADOS dos campos *Centavos, nunca o contrário.
// ══════════════════════════════════════════════════════════════════════════
interface AcrescimoInput { tipo: "fixo" | "pct"; valor: number; motivo?: string | null; visivelCliente?: boolean; }
interface ItemOrcamentoVitre {
  sku: string; nomeSnapshot: string; precoSnapshot: number; precoSnapshotCentavos: number; qtd: number;
  adicionais?: Array<{ nome: string; preco: number }>;
  acrescimo?: AcrescimoInput | null; acrescimoCentavos?: number; itemTotalCentavos?: number;
}
interface ParcelaPagamento { valorCentavos: number; vencimento: string | null; }
interface PagamentoPlano { tipo: "integral" | "entrada_saldo" | "parcelado" | "futuro"; formaPagamento: string; parcelas: ParcelaPagamento[]; }
interface AprovacaoCliente {
  status: "aprovado" | "recusado" | "aguardando_resposta" | "solicitado_ajuste" | "cancelado";
  em: number; porUid: string; canal: string | null; observacao: string | null;
  versao: number; totalCentavos: number | null;
}
// Mesmos literais já usados no fluxo VR (modal "Confirmar Pagamento",
// index.html) — reaproveitados aqui para nunca inventar um vocabulário
// novo de forma de pagamento.
const FORMAS_PAGAMENTO_VALIDAS = ["PIX", "Cartão de Crédito", "Cartão de Débito", "Dinheiro", "Boleto", "Transferência", "Outras"];

function toCentavos(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function centavosParaReais(c: number): number { return +(c / 100).toFixed(2); }

/** Valida e converte um acréscimo (item ou global) em centavos. Nunca aceita
 * fixo+pct simultâneos (a própria estrutura {tipo, valor} já impede isso).
 * Exige motivo/justificativa para qualquer role que não seja master
 * (FASE 8 — "Comercial pode aplicar dentro das regras comerciais
 * configuradas"; a regra aplicada aqui é: acréscimo sempre auditável). */
function validarEAplicarAcrescimo(baseCentavos: number, input: unknown, callerRole: string): { centavos: number; snapshot: AcrescimoInput | null } {
  if (!input) return { centavos: 0, snapshot: null };
  const a = input as Partial<AcrescimoInput>;
  const tipo = a.tipo;
  const valor = Number(a.valor);
  if (tipo !== "fixo" && tipo !== "pct") throw new functions.https.HttpsError("invalid-argument", "Tipo de acréscimo inválido — use \"fixo\" ou \"pct\".");
  if (!Number.isFinite(valor) || valor < 0) throw new functions.https.HttpsError("invalid-argument", "Valor de acréscimo inválido ou negativo.");
  if (tipo === "pct" && valor > 1000) throw new functions.https.HttpsError("invalid-argument", "Percentual de acréscimo implausível.");
  const motivo = typeof a.motivo === "string" ? a.motivo.trim() : "";
  if (callerRole !== "master" && !motivo) {
    throw new functions.https.HttpsError("invalid-argument", "Acréscimo requer motivo/justificativa (exceto para Master).");
  }
  const centavos = tipo === "fixo" ? toCentavos(valor) : Math.round(baseCentavos * valor / 100);
  return { centavos, snapshot: { tipo, valor, motivo: motivo || null, visivelCliente: a.visivelCliente !== false } };
}

/** Valida um plano de pagamento (condição, nunca cobrança real — o hotfix
 * de wizard NÃO está autorizado a emitir cobrança/pagamento real, só a
 * registrar a condição combinada). Garante soma das parcelas === total,
 * em centavos, sem nenhuma parcela negativa ou zerada. */
function validarPagamento(totalCentavos: number, input: unknown): PagamentoPlano | null {
  if (!input) return null;
  const p = input as { tipo?: string; formaPagamento?: string; parcelas?: Array<{ valor: unknown; vencimento?: unknown }> };
  if (!["integral", "entrada_saldo", "parcelado", "futuro"].includes(String(p.tipo))) {
    throw new functions.https.HttpsError("invalid-argument", "Tipo de pagamento inválido.");
  }
  const formaPagamento = FORMAS_PAGAMENTO_VALIDAS.includes(String(p.formaPagamento)) ? String(p.formaPagamento) : "PIX";
  const parcelasInput = Array.isArray(p.parcelas) ? p.parcelas : [];
  if (!parcelasInput.length) throw new functions.https.HttpsError("invalid-argument", "Plano de pagamento sem parcelas.");
  let soma = 0;
  const parcelas: ParcelaPagamento[] = parcelasInput.map((pc) => {
    const valorCentavos = toCentavos(pc.valor);
    if (valorCentavos <= 0) throw new functions.https.HttpsError("invalid-argument", "Parcela com valor inválido.");
    if (valorCentavos > totalCentavos) throw new functions.https.HttpsError("invalid-argument", "ENTRADA_MAIOR_QUE_TOTAL");
    soma += valorCentavos;
    return { valorCentavos, vencimento: pc.vencimento ? String(pc.vencimento) : null };
  });
  if (soma !== totalCentavos) {
    throw new functions.https.HttpsError("invalid-argument", `SOMA_PARCELAS_DIFERENTE_DO_TOTAL:${soma}:${totalCentavos}`);
  }
  return { tipo: p.tipo as PagamentoPlano["tipo"], formaPagamento, parcelas };
}

/** Resolve itens (snapshot + centavos) e totais de um orçamento Vitre.
 * Compartilhado por vitreCriarOrcamento e por vitreAtualizarOrcamento
 * (edição de itens permitida só enquanto status==='rascunho') — nunca
 * duplicar esta lógica de cálculo em dois lugares. */
async function resolverItensEValores(
  db: FirebaseFirestore.Firestore,
  itensInput: unknown[],
  acrescimoGlobalInput: unknown,
  descontoPct: number,
  frete: number,
  callerRole: string
): Promise<{
  itensSnapshot: ItemOrcamentoVitre[]; subtotalProdutosCentavos: number; acrescimosItensCentavos: number;
  acrescimoGlobalCentavos: number; acrescimoGlobalSnapshot: AcrescimoInput | null;
  valorDescontoCentavos: number; freteCentavos: number; totalCentavos: number;
}> {
  const itensSnapshot: ItemOrcamentoVitre[] = [];
  let subtotalProdutosCentavos = 0;
  let acrescimosItensCentavos = 0;
  for (const itRaw of itensInput) {
    const it = itRaw as { sku?: string; qtd?: unknown; adicionais?: Array<{ nome?: string }>; acrescimo?: unknown };
    const sku = String(it.sku || "").trim();
    const qtd = Number(it.qtd);
    if (!sku) throw new functions.https.HttpsError("invalid-argument", "item sem sku.");
    if (!Number.isInteger(qtd) || qtd < 1) throw new functions.https.HttpsError("invalid-argument", "QTD_INVALIDA:" + sku);
    const prodSnap = await db.collection(COL_PRODUTOS).doc(sku).get();
    if (!prodSnap.exists) throw new functions.https.HttpsError("failed-precondition", "PRODUTO_NAO_ENCONTRADO:" + sku);
    const prod = prodSnap.data() as VitreProduto;
    if (prod.status !== "ativo") throw new functions.https.HttpsError("failed-precondition", "PRODUTO_INATIVO:" + sku);
    if (calcularNivelCompletude(prod) < 1) throw new functions.https.HttpsError("failed-precondition", "PRODUTO_ABAIXO_DO_NIVEL_MINIMO:" + sku);
    const adicionaisInput: Array<{ nome?: string }> = Array.isArray(it.adicionais) ? it.adicionais : [];
    // SNAPSHOT — nunca uma referência viva ao produto. Só aceita adicionais
    // que estejam de fato pré-cadastrados no produto (nunca confia no preço vindo do cliente).
    const adicionais: Array<{ nome: string; preco: number }> = adicionaisInput
      .map((a) => (prod.personalizacoes || []).find((p) => p.nome === a?.nome))
      .filter((p): p is { nome: string; preco: number } => !!p);
    const precoSnapshotCentavos = toCentavos(prod.precoVenda);
    const adicionaisCentavosUnit = adicionais.reduce((s: number, a) => s + toCentavos(a.preco), 0);
    const itemBaseCentavos = (precoSnapshotCentavos + adicionaisCentavosUnit) * qtd;
    const { centavos: itemAcrescimoCentavos, snapshot: acrescimoSnapshot } = validarEAplicarAcrescimo(itemBaseCentavos, it.acrescimo, callerRole);
    subtotalProdutosCentavos += itemBaseCentavos;
    acrescimosItensCentavos += itemAcrescimoCentavos;
    itensSnapshot.push({
      sku, nomeSnapshot: prod.nome, precoSnapshot: prod.precoVenda || 0, precoSnapshotCentavos, qtd,
      adicionais, acrescimo: acrescimoSnapshot, acrescimoCentavos: itemAcrescimoCentavos,
      itemTotalCentavos: itemBaseCentavos + itemAcrescimoCentavos,
    });
  }

  // Ordem oficial do cálculo (FASE 7 do hotfix): produtos → acréscimos de
  // item → acréscimo global → desconto → frete → total.
  const { centavos: acrescimoGlobalCentavos, snapshot: acrescimoGlobalSnapshot } =
    validarEAplicarAcrescimo(subtotalProdutosCentavos + acrescimosItensCentavos, acrescimoGlobalInput, callerRole);
  const baseCentavos = subtotalProdutosCentavos + acrescimosItensCentavos + acrescimoGlobalCentavos;
  const valorDescontoCentavos = Math.round(baseCentavos * descontoPct / 100);
  const freteCentavos = toCentavos(frete);
  const totalCentavos = baseCentavos - valorDescontoCentavos + freteCentavos;
  if (totalCentavos < 0) throw new functions.https.HttpsError("invalid-argument", "TOTAL_NEGATIVO");
  return { itensSnapshot, subtotalProdutosCentavos, acrescimosItensCentavos, acrescimoGlobalCentavos, acrescimoGlobalSnapshot, valorDescontoCentavos, freteCentavos, totalCentavos };
}

export const vitreCriarOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  // FASE 13 do hotfix: Produção não cria orçamento comercial — só Comercial (Master sempre passa via requireRole).
  requireRole(caller, ["comercial"], "criar orçamento de catálogo Vitre");

  const clienteNome = String(data?.clienteNome || "").trim();
  const clienteTipo = data?.clienteTipo === "pf" ? "pf" : data?.clienteTipo === "pj" ? "pj" : null;
  const clienteDocumento = data?.clienteDocumento ? String(data.clienteDocumento).trim() : null;
  const clienteEmail = data?.clienteEmail ? String(data.clienteEmail).trim() : null;
  const clienteTel = data?.clienteTel ? String(data.clienteTel).trim() : null;
  const clienteCidade = data?.clienteCidade ? String(data.clienteCidade).trim() : null;
  const clienteExistenteId = data?.clienteExistenteId ? String(data.clienteExistenteId).trim() : null;
  const observacoes = data?.observacoes ? String(data.observacoes).trim() : null;
  const origemAtendimento = data?.origemAtendimento ? String(data.origemAtendimento).trim() : "manual";
  const itensInput = Array.isArray(data?.itens) ? data.itens : [];
  const descontoPct = Number(data?.descontoPct) || 0;
  const frete = Number(data?.frete) || 0;
  const prazoValidadeDias = Number(data?.prazoValidadeDias) || 7;
  const requestId = String(data?.requestId || "");
  if (!clienteNome) throw new functions.https.HttpsError("invalid-argument", "clienteNome obrigatório.");
  if (!itensInput.length) throw new functions.https.HttpsError("invalid-argument", "Ao menos um item é obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");
  if (descontoPct < 0 || descontoPct > 100) throw new functions.https.HttpsError("invalid-argument", "descontoPct inválido.");
  if (frete < 0) throw new functions.https.HttpsError("invalid-argument", "Frete não pode ser negativo.");

  const idemKey = `orc_criar:${requestId}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) {
    const existing = await admin.firestore().collection(COL_ORC).where("requestId", "==", requestId).limit(1).get();
    if (!existing.empty) return { ok: true, jaProcessado: true, id: existing.docs[0].id };
  }

  const db = admin.firestore();
  const {
    itensSnapshot, subtotalProdutosCentavos, acrescimosItensCentavos, acrescimoGlobalCentavos,
    acrescimoGlobalSnapshot, valorDescontoCentavos, freteCentavos, totalCentavos,
  } = await resolverItensEValores(db, itensInput, data?.acrescimoGlobal, descontoPct, frete, caller.role);

  const docRef = db.collection(COL_ORC).doc();
  const registro = {
    id: docRef.id, requestId, tipo: "catalogo_vitre", marca: "vitre", status: "rascunho", versao: 1,
    clienteNome, clienteTipo, clienteDocumento, clienteEmail, clienteTel, clienteCidade, clienteExistenteId,
    observacoes, origemAtendimento,
    itens: itensSnapshot,
    descontoPct,
    acrescimoGlobal: acrescimoGlobalSnapshot,
    // Campos decimais — mantidos por compatibilidade com PDF/WhatsApp/telas
    // existentes; sempre DERIVADOS dos campos *Centavos abaixo.
    subtotal: centavosParaReais(subtotalProdutosCentavos),
    acrescimosItensTotal: centavosParaReais(acrescimosItensCentavos),
    acrescimoGlobalTotal: centavosParaReais(acrescimoGlobalCentavos),
    valorDesconto: centavosParaReais(valorDescontoCentavos),
    frete: centavosParaReais(freteCentavos),
    total: centavosParaReais(totalCentavos),
    // Fonte de verdade — inteiros, nunca ponto flutuante.
    subtotalCentavos: subtotalProdutosCentavos, acrescimosItensCentavos, acrescimoGlobalCentavos,
    valorDescontoCentavos, freteCentavos, totalCentavos,
    prazoValidadeDias, validoAte: Date.now() + prazoValidadeDias * 86400000,
    vendedorUid: caller.uid,
    criadoPorUid: caller.uid, criadoPorRole: caller.role, criadoEm: Date.now(),
  };
  await docRef.set(registro);
  await writeAudit("orcamento_criado", caller.uid, caller.role, { id: docRef.id, total: registro.total });
  return { ok: true, jaProcessado: false, id: docRef.id, total: registro.total, totalCentavos };
});

export const vitreAtualizarOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  // FASE 13 do hotfix: pagamento/status são dados comerciais — Produção não altera (Master sempre passa).
  requireRole(caller, ["comercial"], "atualizar orçamento de catálogo Vitre");
  const id = String(data?.id || "").trim();
  const status = data?.status ? String(data.status) : null;
  if (!id) throw new functions.https.HttpsError("invalid-argument", "id obrigatório.");
  const db = admin.firestore();
  const ref = db.collection(COL_ORC).doc(id);

  // Editar itens/valores só é permitido com o orçamento ainda em rascunho —
  // resolve os produtos ANTES da transação (mesma janela de risco já aceita
  // em vitreCriarOrcamento: o status é revalidado dentro da transação, o
  // preço do produto não — se mudar entre a leitura e o commit, o próximo
  // "salvar" já traz o preço atualizado).
  let itensCalc: Awaited<ReturnType<typeof resolverItensEValores>> | null = null;
  if (Array.isArray(data?.itens)) {
    const descontoPctNovo = Number(data?.descontoPct) || 0;
    const freteNovo = Number(data?.frete) || 0;
    if (!data.itens.length) throw new functions.https.HttpsError("invalid-argument", "Ao menos um item é obrigatório.");
    if (descontoPctNovo < 0 || descontoPctNovo > 100) throw new functions.https.HttpsError("invalid-argument", "descontoPct inválido.");
    if (freteNovo < 0) throw new functions.https.HttpsError("invalid-argument", "Frete não pode ser negativo.");
    itensCalc = await resolverItensEValores(db, data.itens, data?.acrescimoGlobal, descontoPctNovo, freteNovo, caller.role);
  }

  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Orçamento não encontrado.");
    const cur = snap.data()!;
    if (["convertido", "cancelado"].includes(cur.status)) throw new functions.https.HttpsError("failed-precondition", "ORCAMENTO_EM_ESTADO_FINAL:" + cur.status);
    const update: Record<string, unknown> = { atualizadoEm: Date.now() };

    if (itensCalc) {
      if (cur.status !== "rascunho") throw new functions.https.HttpsError("failed-precondition", "SO_PODE_EDITAR_ITENS_EM_RASCUNHO:" + cur.status);
      Object.assign(update, {
        itens: itensCalc.itensSnapshot, descontoPct: Number(data.descontoPct) || 0,
        acrescimoGlobal: itensCalc.acrescimoGlobalSnapshot,
        subtotal: centavosParaReais(itensCalc.subtotalProdutosCentavos),
        acrescimosItensTotal: centavosParaReais(itensCalc.acrescimosItensCentavos),
        acrescimoGlobalTotal: centavosParaReais(itensCalc.acrescimoGlobalCentavos),
        valorDesconto: centavosParaReais(itensCalc.valorDescontoCentavos),
        frete: centavosParaReais(itensCalc.freteCentavos),
        total: centavosParaReais(itensCalc.totalCentavos),
        subtotalCentavos: itensCalc.subtotalProdutosCentavos, acrescimosItensCentavos: itensCalc.acrescimosItensCentavos,
        acrescimoGlobalCentavos: itensCalc.acrescimoGlobalCentavos, valorDescontoCentavos: itensCalc.valorDescontoCentavos,
        freteCentavos: itensCalc.freteCentavos, totalCentavos: itensCalc.totalCentavos,
        // Total pode ter mudado — um plano de pagamento anterior fica inválido, precisa ser refeito.
        pagamento: null,
      });
    }

    if (status && ["rascunho", "enviado", "cancelado"].includes(status)) update.status = status;

    if (data?.pagamento !== undefined) {
      const totalParaValidar = (update.totalCentavos as number | undefined) ?? (Number(cur.totalCentavos) || 0);
      update.pagamento = validarPagamento(totalParaValidar, data.pagamento);
    }

    if (data?.marcarEnviado === true) {
      if (cur.status !== "rascunho") throw new functions.https.HttpsError("failed-precondition", "SO_PODE_ENVIAR_A_PARTIR_DE_RASCUNHO:" + cur.status);
      const versaoAtual = Number(cur.versao) || 1;
      const totalNoEnvio = (update.totalCentavos as number | undefined) ?? (Number(cur.totalCentavos) || 0);
      const itensNoEnvio = (update.itens as unknown[] | undefined) ?? cur.itens;
      update.status = "enviado";
      update.enviadoEm = Date.now();
      update.enviadoPorUid = caller.uid;
      update.enviadoCanal = data?.canal ? String(data.canal) : null;
      update.enviadoVersao = versaoAtual;
      update.enviadoTotalCentavos = totalNoEnvio;
      update.enviadoItensSnapshot = itensNoEnvio;
      update.aprovacao = null; // uma nova rodada de envio zera qualquer aprovação/recusa anterior
    }

    tx.set(ref, update, { merge: true });
    return { statusFinal: update.status || cur.status };
  });
  await writeAudit("orcamento_atualizado", caller.uid, caller.role, { id, ...resultado });
  return { ok: true, ...resultado };
});

// ══════════════════════════════════════════════════════════════════════════
// vitreIniciarNovaVersao — única forma de voltar a editar um orçamento que
// já foi enviado/aprovado/recusado: arquiva a versão atual (itens, totais,
// status, envio, aprovação) numa subcoleção e volta o orçamento para
// "rascunho" com a versão incrementada. Bloqueado depois que a venda já
// foi confirmada — a partir daí, uma correção precisa de um novo
// orçamento, nunca reescrever um já vendido.
// ══════════════════════════════════════════════════════════════════════════
const STATUS_BLOQUEIA_NOVA_VERSAO = ["venda_confirmada", "pagamento_pendente", "pagamento_parcial", "pago", "convertido", "cancelado"];

export const vitreIniciarNovaVersao = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "revisar orçamento de catálogo Vitre");
  const id = String(data?.id || "").trim();
  const requestId = String(data?.requestId || "");
  if (!id) throw new functions.https.HttpsError("invalid-argument", "id obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `nova_versao:${requestId}`;
  if (!(await acquireIdem(idemKey))) return { ok: true, jaProcessado: true };

  const db = admin.firestore();
  const ref = db.collection(COL_ORC).doc(id);
  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Orçamento não encontrado.");
    const cur = snap.data()!;
    if (STATUS_BLOQUEIA_NOVA_VERSAO.includes(cur.status)) {
      throw new functions.https.HttpsError("failed-precondition", "ORCAMENTO_JA_AVANCOU_DEMAIS:" + cur.status);
    }
    const versaoAtual = Number(cur.versao) || 1;
    const versaoRef = ref.collection("versoes").doc(String(versaoAtual));
    tx.set(versaoRef, {
      versao: versaoAtual, status: cur.status, itens: cur.itens ?? [], descontoPct: cur.descontoPct ?? 0,
      acrescimoGlobal: cur.acrescimoGlobal ?? null, subtotalCentavos: cur.subtotalCentavos ?? null,
      acrescimosItensCentavos: cur.acrescimosItensCentavos ?? null, acrescimoGlobalCentavos: cur.acrescimoGlobalCentavos ?? null,
      valorDescontoCentavos: cur.valorDescontoCentavos ?? null, freteCentavos: cur.freteCentavos ?? null,
      totalCentavos: cur.totalCentavos ?? null, enviadoEm: cur.enviadoEm ?? null, aprovacao: cur.aprovacao ?? null,
      arquivadoEm: Date.now(), arquivadoPorUid: caller.uid,
    });
    tx.set(ref, {
      versao: versaoAtual + 1, status: "rascunho", aprovacao: null, pagamento: null,
      atualizadoEm: Date.now(),
    }, { merge: true });
    return { versaoNova: versaoAtual + 1 };
  });
  await writeAudit("orcamento_nova_versao", caller.uid, caller.role, { id, ...resultado });
  return { ok: true, jaProcessado: false, ...resultado };
});

// ══════════════════════════════════════════════════════════════════════════
// vitreRegistrarAprovacaoCliente — registra a resposta do cliente a um
// orçamento já enviado. "aprovado" avança o orçamento para o estado
// "aprovado" (pré-requisito de vitreConfirmarVenda); as demais respostas
// só ficam registradas em `aprovacao`, sem tirar o orçamento de "enviado"
// (uma "recusa" ou "ajuste solicitado" não é um estado final — o
// vendedor pode revisar via vitreIniciarNovaVersao e reenviar).
// ══════════════════════════════════════════════════════════════════════════
const STATUS_APROVACAO_VALIDOS = ["aprovado", "recusado", "aguardando_resposta", "solicitado_ajuste", "cancelado"] as const;

export const vitreRegistrarAprovacaoCliente = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "registrar aprovação do cliente");
  const id = String(data?.id || "").trim();
  const statusAprovacao = String(data?.status || "");
  const canal = data?.canal ? String(data.canal) : null;
  const observacao = data?.observacao ? String(data.observacao) : null;
  if (!id) throw new functions.https.HttpsError("invalid-argument", "id obrigatório.");
  if (!(STATUS_APROVACAO_VALIDOS as readonly string[]).includes(statusAprovacao)) {
    throw new functions.https.HttpsError("invalid-argument", "STATUS_APROVACAO_INVALIDO:" + statusAprovacao);
  }

  const db = admin.firestore();
  const ref = db.collection(COL_ORC).doc(id);
  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Orçamento não encontrado.");
    const cur = snap.data()!;
    if (cur.status !== "enviado") throw new functions.https.HttpsError("failed-precondition", "ORCAMENTO_NAO_ENVIADO:" + cur.status);
    const aprovacao: AprovacaoCliente = {
      status: statusAprovacao as AprovacaoCliente["status"], em: Date.now(), porUid: caller.uid, canal, observacao,
      versao: Number(cur.versao) || 1, totalCentavos: cur.totalCentavos ?? null,
    };
    const update: Record<string, unknown> = { aprovacao, atualizadoEm: Date.now() };
    if (statusAprovacao === "aprovado") update.status = "aprovado";
    else if (statusAprovacao === "cancelado") update.status = "cancelado";
    // recusado / aguardando_resposta / solicitado_ajuste: fica registrado em `aprovacao`, status continua "enviado".
    tx.set(ref, update, { merge: true });
    return { statusFinal: update.status || cur.status, aprovacaoStatus: statusAprovacao };
  });
  await writeAudit("orcamento_aprovacao_registrada", caller.uid, caller.role, { id, ...resultado });
  return { ok: true, ...resultado };
});

// ══════════════════════════════════════════════════════════════════════════
// vitreConfirmarVenda — fecha a venda de um orçamento já aprovado pelo
// cliente, com pagamento já registrado. Cria o(s) lançamento(s) de Contas
// a Receber no MESMO documento agregado `erp_vr/fin_cr` já usado pelo
// fluxo VR (campo `marca` já suporta 'vitre' — um único painel Financeiro
// para as duas marcas, nunca um modelo paralelo). A chave de negócio real
// é o próprio `status` do orçamento, revalidado dentro da transação: uma
// segunda chamada, mesmo com requestId diferente, nunca confirma a venda
// duas vezes. Não emite cobrança real — só registra a condição já
// combinada (mesma regra do hotfix anterior).
// ══════════════════════════════════════════════════════════════════════════
const STATUS_VENDA_JA_CONFIRMADA = ["venda_confirmada", "pagamento_pendente", "pagamento_parcial", "pago", "convertido"];

export const vitreConfirmarVenda = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "confirmar venda de catálogo Vitre");
  const id = String(data?.id || "").trim();
  const requestId = String(data?.requestId || "");
  if (!id) throw new functions.https.HttpsError("invalid-argument", "id obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `venda_confirmar:${requestId}`;
  const acquired = await acquireIdem(idemKey);
  const db = admin.firestore();
  const ref = db.collection(COL_ORC).doc(id);
  if (!acquired) {
    const snap0 = await ref.get();
    if (snap0.exists && STATUS_VENDA_JA_CONFIRMADA.includes(snap0.data()!.status) && snap0.data()!.requestIdVenda === requestId) {
      return { ok: true, jaProcessado: true, id };
    }
  }

  const crRef = db.collection("erp_vr").doc("fin_cr");

  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Orçamento não encontrado.");
    const cur = snap.data()!;
    // Chave de negócio: o status por si só impede uma segunda confirmação,
    // mesmo vinda de um requestId diferente (dois cliques distintos, duas
    // abas, ou um retry com novo requestId nunca criam uma segunda venda).
    if (STATUS_VENDA_JA_CONFIRMADA.includes(cur.status) || cur.status === "cancelado") {
      throw new functions.https.HttpsError("failed-precondition", "VENDA_JA_CONFIRMADA:" + cur.status);
    }
    if (cur.status !== "aprovado") throw new functions.https.HttpsError("failed-precondition", "ORCAMENTO_NAO_APROVADO:" + cur.status);
    const aprovacao = cur.aprovacao as AprovacaoCliente | undefined;
    if (!aprovacao || aprovacao.status !== "aprovado" || aprovacao.versao !== (Number(cur.versao) || 1)) {
      throw new functions.https.HttpsError("failed-precondition", "VERSAO_APROVADA_DIVERGENTE");
    }
    const pagamento = cur.pagamento as PagamentoPlano | null;
    if (!pagamento) throw new functions.https.HttpsError("failed-precondition", "PAGAMENTO_NAO_REGISTRADO");
    const totalCentavos = Number(cur.totalCentavos) || 0;
    const somaParcelas = pagamento.parcelas.reduce((s, p) => s + p.valorCentavos, 0);
    if (somaParcelas !== totalCentavos) throw new functions.https.HttpsError("failed-precondition", "SOMA_PARCELAS_DIFERENTE_DO_TOTAL");

    // Entrada = valor já tratado como recebido no momento da confirmação
    // (integral ou a 1ª parcela de entrada+saldo). Parcelado/futuro: nada é
    // tratado como recebido agora — este hotfix não emite cobrança real.
    let entradaCentavos = 0;
    if (pagamento.tipo === "integral") entradaCentavos = totalCentavos;
    else if (pagamento.tipo === "entrada_saldo") entradaCentavos = pagamento.parcelas[0]?.valorCentavos || 0;
    if (entradaCentavos > totalCentavos) throw new functions.https.HttpsError("failed-precondition", "ENTRADA_MAIOR_QUE_TOTAL");
    const saldoCentavos = totalCentavos - entradaCentavos;
    if (saldoCentavos < 0) throw new functions.https.HttpsError("failed-precondition", "SALDO_NEGATIVO");
    const statusPagamento = saldoCentavos <= 0 ? "pago" : entradaCentavos > 0 ? "pagamento_parcial" : "pagamento_pendente";

    const crSnap = await tx.get(crRef);
    const crAtual: Array<Record<string, unknown>> = crSnap.exists && typeof crSnap.data()?.data === "string"
      ? JSON.parse(crSnap.data()!.data as string) : [];
    const dataStr = new Date().toLocaleDateString("pt-BR"); // mesmo formato DD/MM/YYYY do fluxo VR
    const novosCR: Array<Record<string, unknown>> = [];
    if (entradaCentavos > 0) {
      novosCR.push({
        id: `cr${Date.now()}a`, cliente: cur.clienteNome, descricao: `Entrada — Orçamento Vitre ${id.slice(0, 8)}`,
        valor: centavosParaReais(entradaCentavos), vencimento: dataStr, status: "recebido", marca: "vitre",
        metodo: pagamento.formaPagamento, osRef: "", dataCriacao: dataStr, dataRecebimento: dataStr,
        origem: "vitre_venda_confirmada", orcamentoId: id,
      });
    }
    if (saldoCentavos > 0) {
      novosCR.push({
        id: `cr${Date.now()}b`, cliente: cur.clienteNome, descricao: `Saldo — Orçamento Vitre ${id.slice(0, 8)}`,
        valor: centavosParaReais(saldoCentavos),
        vencimento: pagamento.parcelas[pagamento.parcelas.length - 1]?.vencimento || dataStr,
        status: "pendente", marca: "vitre", metodo: pagamento.formaPagamento, osRef: "",
        dataCriacao: dataStr, dataRecebimento: null, origem: "vitre_venda_confirmada", orcamentoId: id,
      });
    }
    if (novosCR.length) tx.set(crRef, { data: JSON.stringify(crAtual.concat(novosCR)), ts: Date.now() });

    tx.set(ref, {
      status: "venda_confirmada", statusPagamento,
      vendaConfirmadaEm: Date.now(), vendaConfirmadaPorUid: caller.uid, requestIdVenda: requestId,
      entradaCentavos, saldoCentavos, crIds: novosCR.map((c) => c.id as string),
      atualizadoEm: Date.now(),
    }, { merge: true });

    return { statusFinal: "venda_confirmada", statusPagamento, entradaCentavos, saldoCentavos, totalCentavos };
  });

  await writeAudit("venda_confirmada", caller.uid, caller.role, { id, ...resultado });
  return { ok: true, jaProcessado: false, id, ...resultado };
});

// ══════════════════════════════════════════════════════════════════════════
// vitreConverterOrcamentoParaOS (FASE G, Parte 9 da homologação guiada,
// 2026-08-06) — converte um orçamento de catálogo Vitre em Ordem de
// Serviço, classificando CADA item, na hora da conversão (não no
// momento em que o orçamento foi salvo), em exatamente um de três
// caminhos, lendo o estado ATUAL do produto (produção pode ter mudado
// a ficha técnica ou o estoque depois do orçamento — o snapshot
// comercial de preço/nome nunca é usado aqui):
//
//   pronta_entrega       — há unidade(s) já prontas em
//                           estoqueProntoUnidades >= qtd pedida. Baixa
//                           de estoque, sem gerar nenhuma ficha de
//                           produção nova (não é replanificado).
//   produzido_apos_pedido— sem estoque pronto suficiente, mas a ficha
//                           técnica está completa (componentes +
//                           arquivo de corte cadastrados). Gera OS com
//                           SNAPSHOT da ficha técnica/arquivo de corte
//                           — o arquivo nunca é aberto/executado aqui,
//                           só referenciado (caminho+versão+checksum)
//                           para quem for cortar depois, manualmente.
//   ficha_incompleta      — nem estoque pronto nem ficha técnica
//                           completa. NUNCA inventamos material,
//                           tempo ou arquivo de corte.
//
// Fail-closed por design (mesmo padrão do teste 23 do catálogo): se
// QUALQUER item cair em ficha_incompleta (ou o produto tiver sido
// removido do catálogo depois do orçamento), a conversão inteira é
// bloqueada — nenhuma baixa de estoque parcial, nenhuma OS parcial.
// A resposta sempre traz a classificação completa, para a tela
// mostrar exatamente o que falta e para quem decidir.
// ══════════════════════════════════════════════════════════════════════════
const COL_OS = "vitre_os";

interface ItemClassificado {
  sku: string; nomeSnapshot: string; qtd: number;
  tipo: "pronta_entrega" | "produzido_apos_pedido" | "ficha_incompleta" | "produto_removido";
  motivoBloqueio?: string;
  fichaTecnicaSnapshot?: VitreProduto["fichaTecnica"];
  arquivoCorteRef?: VitreProduto["arquivoCorte"];
  prazoProducaoDiasEstimado?: number | null;
}

export const vitreConverterOrcamentoParaOS = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  // Comercial (dono do orçamento) confirma a conversão — mesma fronteira de
  // leitura já em vigor para vitre_orcamentos nas Rules (Produção não lê
  // orçamento comercial diretamente, só o resultado em vitre_os depois).
  requireRole(caller, ["comercial"], "converter orçamento Vitre em OS");

  const orcamentoId = String(data?.orcamentoId || "").trim();
  const requestId = String(data?.requestId || "");
  if (!orcamentoId) throw new functions.https.HttpsError("invalid-argument", "orcamentoId obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const idemKey = `conv_os:${requestId}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) {
    const existing = await admin.firestore().collection(COL_OS).where("requestId", "==", requestId).limit(1).get();
    if (!existing.empty) return { ok: true, jaProcessado: true, id: existing.docs[0].id };
  }

  const db = admin.firestore();
  const orcRef = db.collection(COL_ORC).doc(orcamentoId);
  const orcSnap = await orcRef.get();
  if (!orcSnap.exists) throw new functions.https.HttpsError("not-found", "Orçamento não encontrado.");
  const orc = orcSnap.data()!;
  if (orc.tipo !== "catalogo_vitre") throw new functions.https.HttpsError("failed-precondition", "NAO_E_ORCAMENTO_VITRE");
  if (orc.status === "convertido") throw new functions.https.HttpsError("failed-precondition", "ORCAMENTO_EM_ESTADO_FINAL:convertido");
  if (orc.status === "cancelado") throw new functions.https.HttpsError("failed-precondition", "ORCAMENTO_EM_ESTADO_FINAL:cancelado");
  // Só gera OS depois que a venda foi confirmada (vitreConfirmarVenda) — nunca antes.
  if (!STATUS_VENDA_JA_CONFIRMADA.includes(orc.status)) {
    throw new functions.https.HttpsError("failed-precondition", "VENDA_NAO_CONFIRMADA:" + orc.status);
  }

  // ── 1. Classificar cada item lendo o estado ATUAL do produto ────────────
  const itens: ItemClassificado[] = [];
  for (const it of (orc.itens || []) as Array<{ sku: string; nomeSnapshot: string; qtd: number }>) {
    const prodSnap = await db.collection(COL_PRODUTOS).doc(it.sku).get();
    if (!prodSnap.exists) {
      itens.push({ sku: it.sku, nomeSnapshot: it.nomeSnapshot, qtd: it.qtd, tipo: "produto_removido", motivoBloqueio: "Produto não existe mais no catálogo." });
      continue;
    }
    const prod = prodSnap.data() as VitreProduto;
    const estoquePronto = Number(prod.estoqueProntoUnidades) || 0;
    const temFichaCompleta = !!(prod.fichaTecnica && prod.fichaTecnica.componentes && prod.fichaTecnica.componentes.length && prod.arquivoCorte);
    if (estoquePronto >= it.qtd) {
      itens.push({ sku: it.sku, nomeSnapshot: it.nomeSnapshot, qtd: it.qtd, tipo: "pronta_entrega" });
    } else if (temFichaCompleta) {
      itens.push({
        sku: it.sku, nomeSnapshot: it.nomeSnapshot, qtd: it.qtd, tipo: "produzido_apos_pedido",
        fichaTecnicaSnapshot: prod.fichaTecnica, arquivoCorteRef: prod.arquivoCorte, prazoProducaoDiasEstimado: prod.prazoDias ?? null,
      });
    } else {
      itens.push({
        sku: it.sku, nomeSnapshot: it.nomeSnapshot, qtd: it.qtd, tipo: "ficha_incompleta",
        motivoBloqueio: estoquePronto > 0
          ? `Estoque pronto insuficiente (${estoquePronto}/${it.qtd}) e ficha técnica incompleta — não é possível decidir automaticamente.`
          : "Sem estoque pronto e sem ficha técnica completa (componentes/arquivo de corte) — requer cadastro humano antes de gerar OS.",
      });
    }
  }

  const bloqueado = itens.some((i) => i.tipo === "ficha_incompleta" || i.tipo === "produto_removido");
  if (bloqueado) {
    await writeAudit("conversao_os_bloqueada", caller.uid, caller.role, { orcamentoId, itens });
    return { ok: false, bloqueado: true, itens };
  }

  // ── 2. Todos os itens automatizáveis — baixa de estoque + criação da OS,
  //       tudo dentro de UMA transação (nunca baixa parcial se a OS falhar) ──
  const osRef = db.collection(COL_OS).doc();
  const crRef = db.collection("erp_vr").doc("fin_cr");
  await db.runTransaction(async (tx) => {
    // Rele o orçamento dentro da transação — protege contra conversão
    // concorrente (duas abas/dois cliques) do MESMO orçamento.
    const orcTx = await tx.get(orcRef);
    if (!orcTx.exists) throw new functions.https.HttpsError("not-found", "Orçamento não encontrado.");
    const statusTx = orcTx.data()!.status;
    if (statusTx === "convertido" || statusTx === "cancelado") {
      throw new functions.https.HttpsError("failed-precondition", "ORCAMENTO_EM_ESTADO_FINAL:" + statusTx);
    }
    if (!STATUS_VENDA_JA_CONFIRMADA.includes(statusTx)) {
      throw new functions.https.HttpsError("failed-precondition", "VENDA_NAO_CONFIRMADA:" + statusTx);
    }
    // Firestore exige TODAS as leituras da transação antes de qualquer
    // escrita — lê o fin_cr aqui em cima, mesmo que só seja usado depois.
    const crIds: string[] = Array.isArray(orcTx.data()!.crIds) ? orcTx.data()!.crIds : [];
    const crSnap = crIds.length ? await tx.get(crRef) : null;
    // Rele e baixa o estoque pronto de cada item pronta_entrega dentro da
    // MESMA transação (protege contra duas conversões concorrentes
    // consumindo o mesmo estoque pronto além do disponível).
    for (const it of itens) {
      if (it.tipo !== "pronta_entrega") continue;
      const prodRef = db.collection(COL_PRODUTOS).doc(it.sku);
      const prodTx = await tx.get(prodRef);
      const estoqueAtual = Number(prodTx.data()?.estoqueProntoUnidades) || 0;
      if (estoqueAtual < it.qtd) {
        throw new functions.https.HttpsError("aborted", "ESTOQUE_MUDOU_DURANTE_CONVERSAO:" + it.sku);
      }
      tx.set(prodRef, { estoqueProntoUnidades: estoqueAtual - it.qtd }, { merge: true });
    }
    const temProduzido = itens.some((i) => i.tipo === "produzido_apos_pedido");
    const temProntaEntrega = itens.some((i) => i.tipo === "pronta_entrega");
    const statusOS = temProduzido && temProntaEntrega ? "mista_aguardando_producao" : temProduzido ? "aguardando_producao" : "pronta_expedicao";
    tx.set(osRef, {
      id: osRef.id, orcamentoId, requestId, marca: "vitre",
      clienteNome: orc.clienteNome, clienteTel: orc.clienteTel ?? null, clienteDocumento: orc.clienteDocumento ?? null,
      itens, status: statusOS,
      // Coerência Pagamento ↔ OS (FASE 12 do hotfix) — copia a condição já
      // validada no orçamento; a OS nunca recalcula nem inventa valores.
      pagamento: orc.pagamento ?? null,
      subtotalCentavos: orc.subtotalCentavos ?? null, totalCentavos: orc.totalCentavos ?? null,
      valorDescontoCentavos: orc.valorDescontoCentavos ?? null, freteCentavos: orc.freteCentavos ?? null,
      entradaCentavos: orc.entradaCentavos ?? null, saldoCentavos: orc.saldoCentavos ?? null,
      statusPagamento: orc.statusPagamento ?? null,
      criadoPorUid: caller.uid, criadoPorRole: caller.role, criadoEm: Date.now(),
    });
    tx.set(orcRef, { status: "convertido", osId: osRef.id, atualizadoEm: Date.now() }, { merge: true });

    // Traça de volta a OS nos lançamentos de Contas a Receber já criados em
    // vitreConfirmarVenda (mesmo padrão do fluxo VR: osRef preenchido depois
    // que a OS existe).
    if (crSnap && crSnap.exists && typeof crSnap.data()?.data === "string") {
      const crAtual: Array<Record<string, unknown>> = JSON.parse(crSnap.data()!.data as string);
      const crAtualizado = crAtual.map((c) => (crIds.includes(c.id as string) ? { ...c, osRef: `VTOS-${osRef.id.slice(0, 6)}` } : c));
      tx.set(crRef, { data: JSON.stringify(crAtualizado), ts: Date.now() });
    }
  });

  await writeAudit("conversao_os_realizada", caller.uid, caller.role, { orcamentoId, osId: osRef.id, itens });
  return { ok: true, bloqueado: false, id: osRef.id, itens };
});
