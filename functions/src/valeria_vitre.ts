/**
 * valeria_vitre.ts — Integração Valéria (Chatvolt) com o Catálogo Vitre
 * (FASE G, Parte C — 2026-08-06).
 *
 * PREPARAÇÃO APENAS: nenhum destes endpoints foi configurado no Chatvolt
 * nesta rodada, nenhum agente real foi conectado a eles. Deploy real e
 * configuração de Actions no Chatvolt ficam para uma rodada futura,
 * explicitamente autorizada — ver relatório final, Parte C.
 *
 * Reaproveita a infraestrutura já existente de valeria.ts (autenticação
 * Bearer via checkAuth) e de auth_helper.ts (acquireIdem/writeAudit —
 * mesmos helpers usados por vitre.ts/compras.ts/estoque.ts), em vez de
 * inventar um padrão novo. Diferente de vitre.ts (Cloud Functions onCall,
 * chamadas pelo próprio ERP com sessão de staff via Firebase Auth), este
 * módulo é onRequest (HTTPS simples) — a Valéria não é um usuário do ERP,
 * é um serviço externo autenticado só pelo Bearer token compartilhado.
 *
 * Regra de negócio central (C1 — nunca "CPF=Vitre / CNPJ=VR"): CPF/CNPJ é
 * só um sinal comercial, NUNCA a regra de decisão. A decisão real segue:
 * entender a necessidade → buscar no catálogo → existe SKU compatível? →
 * existe variante? → a personalização pedida é permitida? → prazo/
 * disponibilidade são confiáveis? → oferecer Vitre quando o catálogo
 * satisfaz (com ou sem adicional permitido) → encaminhar para
 * VR/Personalizado quando exige medida nova, material fora do padrão,
 * alteração não permitida, arquivo/projeto exclusivo.
 *
 * Nunca exposto ao agente (C2): custo, margem, markup, caminho de
 * arquivo/rede, configuração interna, produto desativado, produto abaixo
 * do nível mínimo definido, prazo não confiável, preço não confirmado.
 * Só produtos elegíveis (ver produtoElegivelValeria) são retornados nas
 * buscas — produtos incompletos nunca são "inventados", apenas omitidos.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { checkAuth } from "./valeria";
import { acquireIdem, writeAudit } from "./auth_helper";

const COL_PRODUTOS = "vitre_produtos";
const COL_ORC = "vitre_orcamentos";
const COL_IDEM = "valeria_vitre_idem_keys";
const COL_AUDIT = "valeria_vitre_audit_log";
const COL_HANDOFF = "valeria_handoffs";

// Nível mínimo de completude (0-4, mesma escala de vitre.ts) que a Valéria
// exige para oferecer um produto automaticamente sem intervenção humana —
// deliberadamente mais alto que o mínimo de vitre.ts (nível 1, usado para
// permitir que Comercial/Master orcem manualmente produtos ainda
// incompletos) porque aqui não há um humano revisando antes do envio.
const NIVEL_MINIMO_VALERIA = 2;

interface VitreProdutoValeria {
  sku: string; nome: string; marca?: string; categoria?: string | null; familia?: string | null;
  variante?: string | null; status?: string; ativoValeria?: boolean;
  custo?: number | null; precoVenda?: number | null; prazoDias?: number | null;
  disponibilidade?: string | null; descricaoCurta?: string | null; fotos?: string[] | null;
  usos?: string[] | null; palavrasChave?: string[] | null; personalizacoes?: Array<{ nome: string; preco: number }> | null;
  pesoKg?: number | null; embalagem?: string | null; comprimentoCm?: number | null; larguraCm?: number | null;
  beneficios?: string[] | null;
}

function calcularNivelCompletude(p: Partial<VitreProdutoValeria>): number {
  const nivel1 = !!(p.sku && p.nome && p.precoVenda != null && p.custo != null && p.status);
  if (!nivel1) return 0;
  const nivel2 = !!(p.categoria && p.fotos && p.fotos.length && p.descricaoCurta && p.prazoDias != null && p.embalagem && p.pesoKg != null);
  if (!nivel2) return 1;
  const nivel3 = !!(p.usos && p.usos.length && p.beneficios && p.beneficios.length && p.palavrasChave && p.palavrasChave.length && p.disponibilidade);
  if (!nivel3) return 2;
  return 3; // nível 4 (ficha técnica) não é exigido pela Valéria — produção, não venda
}

// Único ponto de decisão "posso oferecer isto automaticamente?" — C3.
function produtoElegivelValeria(p: VitreProdutoValeria): boolean {
  return p.status === "ativo"
    && p.ativoValeria === true
    && p.precoVenda != null && p.precoVenda > 0
    && p.prazoDias != null
    && !!p.descricaoCurta
    && calcularNivelCompletude(p) >= NIVEL_MINIMO_VALERIA;
}

// Whitelist explícita de campos — nunca custo/margem/markup/fichaTecnica/
// arquivoCorte/camposEditadosManualmente/criadoPorUid/origem.
function produtoParaValeria(p: VitreProdutoValeria) {
  return {
    sku: p.sku, nome: p.nome, categoria: p.categoria || null, familia: p.familia || null,
    variante: p.variante || null, precoVenda: p.precoVenda, prazoDias: p.prazoDias,
    disponibilidade: p.disponibilidade || null, descricaoCurta: p.descricaoCurta,
    fotos: p.fotos || [], usos: p.usos || [], palavrasChave: p.palavrasChave || [],
    personalizacoesPermitidas: (p.personalizacoes || []).map((x) => ({ nome: x.nome, preco: x.preco })),
  };
}

function requireEnv(body: Record<string, unknown>): { conversationId: string; organizationId: string } | null {
  const conversationId = String(body?.conversationId || "").trim();
  const organizationId = String(body?.organizationId || "").trim();
  if (!conversationId || !organizationId) return null;
  return { conversationId, organizationId };
}

function cors(res: functions.Response) { res.set("Access-Control-Allow-Origin", "*"); }

// ══════════════════════════════════════════════════════════════════════════
// 1. valeriaVitreBuscarCatalogo — busca por nome/sinônimo/categoria/uso/
//    faixa de preço. GET ?q=&categoria=&precoMin=&precoMax=&limite=
// ══════════════════════════════════════════════════════════════════════════
export const valeriaVitreBuscarCatalogo = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!await checkAuth(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const q = String(req.query.q || "").trim().toLowerCase();
  const categoria = String(req.query.categoria || "").trim().toLowerCase();
  const precoMin = req.query.precoMin != null ? Number(req.query.precoMin) : null;
  const precoMax = req.query.precoMax != null ? Number(req.query.precoMax) : null;
  const limite = Math.min(Number(req.query.limite) || 10, 30);

  const snap = await admin.firestore().collection(COL_PRODUTOS).get();
  const elegiveis = snap.docs.map((d) => d.data() as VitreProdutoValeria).filter(produtoElegivelValeria);

  const filtrados = elegiveis.filter((p) => {
    if (categoria && (p.categoria || "").toLowerCase() !== categoria) return false;
    if (precoMin != null && (p.precoVenda || 0) < precoMin) return false;
    if (precoMax != null && (p.precoVenda || 0) > precoMax) return false;
    if (q) {
      const alvo = [p.nome, p.categoria, p.descricaoCurta, ...(p.usos || []), ...(p.palavrasChave || [])].filter(Boolean).join(" ").toLowerCase();
      if (alvo.indexOf(q) < 0) return false;
    }
    return true;
  }).slice(0, limite);

  res.json({ ok: true, total: filtrados.length, produtos: filtrados.map(produtoParaValeria) });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. valeriaVitreConsultarProduto — GET ?sku=. Nunca inventa: se o produto
//    não existir ou não for elegível, responde ok:true, elegivel:false,
//    nunca aproxima/adivinha outro produto.
// ══════════════════════════════════════════════════════════════════════════
export const valeriaVitreConsultarProduto = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!await checkAuth(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const sku = String(req.query.sku || "").trim();
  if (!sku) { res.status(400).json({ ok: false, error: "sku obrigatório" }); return; }

  const snap = await admin.firestore().collection(COL_PRODUTOS).doc(sku).get();
  if (!snap.exists) { res.json({ ok: true, elegivel: false, motivo: "SKU_NAO_ENCONTRADO" }); return; }
  const p = snap.data() as VitreProdutoValeria;
  if (!produtoElegivelValeria(p)) { res.json({ ok: true, elegivel: false, motivo: "PRODUTO_ABAIXO_DO_NIVEL_MINIMO_OU_INATIVO" }); return; }
  res.json({ ok: true, elegivel: true, produto: produtoParaValeria(p) });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. valeriaVitreSimularOrcamento — POST { itens:[{sku,qtd}], descontoPct?,
//    frete? }. Só calcula, NUNCA persiste — nunca inventa preço/prazo:
//    se qualquer item não for elegível, a simulação inteira falha
//    (fail-closed, igual à Function real vitreCriarOrcamento).
// ══════════════════════════════════════════════════════════════════════════
// Resolve os "adicionais" (personalização) pedidos por nome contra a lista
// de personalizações REALMENTE cadastradas no produto — o preço nunca vem
// do que o agente/cliente informou, sempre do catálogo. Nome pedido que não
// existir na lista do produto é devolvido em `rejeitados` (nunca aplicado
// silenciosamente) — o agente precisa saber que aquela personalização não é
// permitida para explicar ao cliente, em vez de calcular um total que
// finge incluir algo que não foi de fato adicionado.
function resolverAdicionais(p: VitreProdutoValeria, pedidos: Array<{ nome?: string }> | undefined) {
  const permitidos = p.personalizacoes || [];
  const aplicados: Array<{ nome: string; preco: number }> = [];
  const rejeitados: string[] = [];
  for (const pedido of Array.isArray(pedidos) ? pedidos : []) {
    const nome = String(pedido?.nome || "").trim();
    if (!nome) continue;
    const match = permitidos.find((x) => x.nome === nome);
    if (match) aplicados.push({ nome: match.nome, preco: match.preco });
    else rejeitados.push(nome);
  }
  return { aplicados, rejeitados };
}

export const valeriaVitreSimularOrcamento = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!await checkAuth(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const body = req.body as { itens?: Array<{ sku: string; qtd: number; adicionais?: Array<{ nome?: string }> }>; descontoPct?: number; frete?: number };
  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (!itens.length) { res.status(400).json({ ok: false, error: "itens obrigatório" }); return; }

  const db = admin.firestore();
  const resolvidos: Array<{ sku: string; nome: string; precoVenda: number; qtd: number; adicionais: Array<{ nome: string; preco: number }>; adicionaisRejeitados: string[] }> = [];
  for (const it of itens) {
    const sku = String(it.sku || "").trim();
    const qtd = Number(it.qtd) || 1;
    if (!sku) { res.json({ ok: false, error: "ITEM_SEM_SKU" }); return; }
    const snap = await db.collection(COL_PRODUTOS).doc(sku).get();
    if (!snap.exists) { res.json({ ok: false, error: "PRODUTO_NAO_ENCONTRADO:" + sku }); return; }
    const p = snap.data() as VitreProdutoValeria;
    if (!produtoElegivelValeria(p)) { res.json({ ok: false, error: "PRODUTO_NAO_ELEGIVEL:" + sku }); return; }
    const { aplicados, rejeitados } = resolverAdicionais(p, it.adicionais);
    resolvidos.push({ sku, nome: p.nome, precoVenda: p.precoVenda as number, qtd, adicionais: aplicados, adicionaisRejeitados: rejeitados });
  }
  const descontoPct = Math.max(0, Math.min(100, Number(body.descontoPct) || 0));
  const frete = Math.max(0, Number(body.frete) || 0);
  const subtotal = resolvidos.reduce((s, it) => s + (it.precoVenda + it.adicionais.reduce((a, ad) => a + ad.preco, 0)) * it.qtd, 0);
  const valorDesconto = +(subtotal * (descontoPct / 100)).toFixed(2);
  const total = +(subtotal - valorDesconto + frete).toFixed(2);
  res.json({ ok: true, itens: resolvidos, subtotal, descontoPct, valorDesconto, frete, total });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. valeriaVitreCriarRascunho — POST cria de verdade um vitre_orcamentos
//    (mesmo formato/snapshot da Function real vitreCriarOrcamento), com
//    origem='valeria', isolado por conversationId/organizationId,
//    idempotente por requestId (fail-closed, sem retry automático além do
//    já garantido pela idempotência).
// ══════════════════════════════════════════════════════════════════════════
export const valeriaVitreCriarRascunho = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!await checkAuth(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const body = req.body as {
    clienteNome?: string; itens?: Array<{ sku: string; qtd: number; adicionais?: Array<{ nome?: string }> }>;
    descontoPct?: number; frete?: number; prazoValidadeDias?: number; requestId?: string;
  };
  const env = requireEnv(body as unknown as Record<string, unknown>);
  if (!env) { res.status(400).json({ ok: false, error: "conversationId e organizationId são obrigatórios (isolamento de conversa)" }); return; }
  const requestId = String(body.requestId || "").trim();
  if (!requestId) { res.status(400).json({ ok: false, error: "requestId obrigatório (idempotência)" }); return; }
  const clienteNome = String(body.clienteNome || "").trim();
  if (!clienteNome) { res.status(400).json({ ok: false, error: "clienteNome obrigatório" }); return; }
  const itensInput = Array.isArray(body.itens) ? body.itens : [];
  if (!itensInput.length) { res.status(400).json({ ok: false, error: "itens obrigatório" }); return; }

  const idemKey = `valeria_orc:${env.conversationId}:${requestId}`;
  const acquired = await acquireIdem(COL_IDEM, idemKey);
  if (!acquired) {
    const existing = await admin.firestore().collection(COL_ORC).where("requestId", "==", requestId).limit(1).get();
    if (!existing.empty) { res.json({ ok: true, jaProcessado: true, id: existing.docs[0].id }); return; }
  }

  const db = admin.firestore();
  const itensSnapshot: Array<{ sku: string; nomeSnapshot: string; precoSnapshot: number; qtd: number; adicionais: Array<{ nome: string; preco: number }> }> = [];
  const adicionaisRejeitadosGlobal: Array<{ sku: string; nome: string }> = [];
  for (const it of itensInput) {
    const sku = String(it.sku || "").trim();
    const qtd = Number(it.qtd) || 1;
    const snap = await db.collection(COL_PRODUTOS).doc(sku).get();
    if (!snap.exists) { res.json({ ok: false, error: "PRODUTO_NAO_ENCONTRADO:" + sku }); return; }
    const p = snap.data() as VitreProdutoValeria;
    if (!produtoElegivelValeria(p)) { res.json({ ok: false, error: "PRODUTO_NAO_ELEGIVEL:" + sku }); return; }
    const { aplicados, rejeitados } = resolverAdicionais(p, it.adicionais);
    rejeitados.forEach((nome) => adicionaisRejeitadosGlobal.push({ sku, nome }));
    itensSnapshot.push({ sku, nomeSnapshot: p.nome, precoSnapshot: p.precoVenda as number, qtd, adicionais: aplicados });
  }
  const descontoPct = Math.max(0, Math.min(100, Number(body.descontoPct) || 0));
  const frete = Math.max(0, Number(body.frete) || 0);
  const prazoValidadeDias = Number(body.prazoValidadeDias) || 7;
  const subtotal = itensSnapshot.reduce((s, it) => s + (it.precoSnapshot + it.adicionais.reduce((a, ad) => a + ad.preco, 0)) * it.qtd, 0);
  const valorDesconto = +(subtotal * (descontoPct / 100)).toFixed(2);
  const total = +(subtotal - valorDesconto + frete).toFixed(2);

  const docRef = db.collection(COL_ORC).doc();
  await docRef.set({
    id: docRef.id, requestId, tipo: "catalogo_vitre", marca: "vitre", status: "rascunho",
    clienteNome, itens: itensSnapshot, descontoPct, valorDesconto, frete, subtotal, total,
    prazoValidadeDias, validoAte: Date.now() + prazoValidadeDias * 86400000,
    origem: "valeria", conversationId: env.conversationId, organizationId: env.organizationId,
    criadoEm: Date.now(),
  });
  await writeAudit(COL_AUDIT, "orcamento_criado_valeria", "valeria", "valeria_agent", { id: docRef.id, total, conversationId: env.conversationId });
  res.json({ ok: true, jaProcessado: false, id: docRef.id, total, adicionaisRejeitados: adicionaisRejeitadosGlobal });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. valeriaVitreEncaminharVR — POST registra que a demanda saiu das
//    regras de catálogo (C1) e precisa do fluxo Personalizado VR com um
//    humano — nunca tenta "resolver" sozinha. Grava um registro de
//    handoff auditável, isolado por conversationId/organizationId.
// ══════════════════════════════════════════════════════════════════════════
export const valeriaVitreEncaminharVR = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!await checkAuth(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const body = req.body as {
    clienteNome?: string; clienteTel?: string; motivo?: string; detalhe?: string; requestId?: string;
  };
  const env = requireEnv(body as unknown as Record<string, unknown>);
  if (!env) { res.status(400).json({ ok: false, error: "conversationId e organizationId são obrigatórios" }); return; }
  const clienteNome = String(body.clienteNome || "").trim();
  if (!clienteNome) { res.status(400).json({ ok: false, error: "clienteNome obrigatório" }); return; }
  const motivosValidos = [
    "medida_fora_do_padrao", "material_nao_catalogado", "alteracao_nao_permitida",
    "arquivo_projeto_exclusivo", "sku_inexistente", "produto_incompleto", "cliente_indeciso", "outro",
  ];
  const motivo = motivosValidos.includes(String(body.motivo)) ? String(body.motivo) : "outro";
  const requestId = String(body.requestId || "").trim();
  if (!requestId) { res.status(400).json({ ok: false, error: "requestId obrigatório" }); return; }

  const idemKey = `valeria_handoff:${env.conversationId}:${requestId}`;
  if (!(await acquireIdem(COL_IDEM, idemKey))) { res.json({ ok: true, jaProcessado: true }); return; }

  const db = admin.firestore();
  const docRef = db.collection(COL_HANDOFF).doc();
  await docRef.set({
    id: docRef.id, clienteNome, clienteTel: String(body.clienteTel || "").trim() || null,
    motivo, detalhe: String(body.detalhe || "").trim() || null, status: "pendente",
    conversationId: env.conversationId, organizationId: env.organizationId, criadoEm: Date.now(),
  });
  await writeAudit(COL_AUDIT, "encaminhado_para_vr", "valeria", "valeria_agent", { id: docRef.id, motivo, conversationId: env.conversationId });
  res.json({ ok: true, id: docRef.id });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. valeriaVitreAtualizarRascunho — POST atualiza itens/valores de um
//    rascunho existente (status='rascunho') que pertença à mesma conversa.
//    Idempotente por requestId — retry seguro.
// ══════════════════════════════════════════════════════════════════════════
export const valeriaVitreAtualizarRascunho = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!await checkAuth(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const body = req.body as {
    orcamentoId?: string;
    itens?: Array<{ sku: string; qtd: number; adicionais?: Array<{ nome?: string }> }>;
    descontoPct?: number; frete?: number; requestId?: string;
  };
  const env = requireEnv(body as unknown as Record<string, unknown>);
  if (!env) { res.status(400).json({ ok: false, error: "conversationId e organizationId são obrigatórios" }); return; }
  const orcamentoId = String(body.orcamentoId || "").trim();
  if (!orcamentoId) { res.status(400).json({ ok: false, error: "orcamentoId obrigatório" }); return; }
  const requestId = String(body.requestId || "").trim();
  if (!requestId) { res.status(400).json({ ok: false, error: "requestId obrigatório (idempotência)" }); return; }
  const itensInput = Array.isArray(body.itens) ? body.itens : [];
  if (!itensInput.length) { res.status(400).json({ ok: false, error: "itens obrigatório" }); return; }

  const idemKey = `valeria_orc_upd:${env.conversationId}:${requestId}`;
  const acquired = await acquireIdem(COL_IDEM, idemKey);
  if (!acquired) { res.json({ ok: true, jaProcessado: true, orcamentoId }); return; }

  const db = admin.firestore();
  const docRef = db.collection(COL_ORC).doc(orcamentoId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) { res.status(404).json({ ok: false, error: "ORCAMENTO_NAO_ENCONTRADO" }); return; }
  const docData = docSnap.data() as { conversationId?: string; status?: string };
  if (docData.conversationId !== env.conversationId) { res.status(403).json({ ok: false, error: "ORCAMENTO_OUTRA_CONVERSA" }); return; }
  if (docData.status !== "rascunho") { res.status(400).json({ ok: false, error: "ORCAMENTO_NAO_EDITAVEL:status=" + docData.status }); return; }

  const itensSnapshot: Array<{ sku: string; nomeSnapshot: string; precoSnapshot: number; qtd: number; adicionais: Array<{ nome: string; preco: number }> }> = [];
  const adicionaisRejeitadosGlobal: Array<{ sku: string; nome: string }> = [];
  for (const it of itensInput) {
    const sku = String(it.sku || "").trim();
    const qtd = Number(it.qtd) || 1;
    const snap = await db.collection(COL_PRODUTOS).doc(sku).get();
    if (!snap.exists) { res.json({ ok: false, error: "PRODUTO_NAO_ENCONTRADO:" + sku }); return; }
    const p = snap.data() as VitreProdutoValeria;
    if (!produtoElegivelValeria(p)) { res.json({ ok: false, error: "PRODUTO_NAO_ELEGIVEL:" + sku }); return; }
    const { aplicados, rejeitados } = resolverAdicionais(p, it.adicionais);
    rejeitados.forEach((nome) => adicionaisRejeitadosGlobal.push({ sku, nome }));
    itensSnapshot.push({ sku, nomeSnapshot: p.nome, precoSnapshot: p.precoVenda as number, qtd, adicionais: aplicados });
  }
  const descontoPct = Math.max(0, Math.min(100, Number(body.descontoPct) || 0));
  const frete = Math.max(0, Number(body.frete) || 0);
  const subtotal = itensSnapshot.reduce((s, it) => s + (it.precoSnapshot + it.adicionais.reduce((a, ad) => a + ad.preco, 0)) * it.qtd, 0);
  const valorDesconto = +(subtotal * (descontoPct / 100)).toFixed(2);
  const total = +(subtotal - valorDesconto + frete).toFixed(2);

  await docRef.update({ itens: itensSnapshot, descontoPct, valorDesconto, frete, subtotal, total, atualizadoEm: Date.now() });
  await writeAudit(COL_AUDIT, "orcamento_atualizado_valeria", "valeria", "valeria_agent", { id: orcamentoId, total, conversationId: env.conversationId });
  res.json({ ok: true, orcamentoId, total, adicionaisRejeitados: adicionaisRejeitadosGlobal });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. valeriaVitreConsultarRascunho — GET ?orcamentoId=&conversationId=&
//    organizationId=. Retorna dados não sensíveis do rascunho para que a
//    Valéria possa confirmar o que foi salvo antes de apresentar ao cliente.
// ══════════════════════════════════════════════════════════════════════════
export const valeriaVitreConsultarRascunho = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!await checkAuth(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const orcamentoId = String(req.query.orcamentoId || "").trim();
  const conversationId = String(req.query.conversationId || "").trim();
  const organizationId = String(req.query.organizationId || "").trim();
  if (!orcamentoId || !conversationId || !organizationId) {
    res.status(400).json({ ok: false, error: "orcamentoId, conversationId e organizationId são obrigatórios" });
    return;
  }

  const db = admin.firestore();
  const docSnap = await db.collection(COL_ORC).doc(orcamentoId).get();
  if (!docSnap.exists) { res.status(404).json({ ok: false, error: "ORCAMENTO_NAO_ENCONTRADO" }); return; }
  const d = docSnap.data() as {
    conversationId?: string; status?: string; clienteNome?: string;
    itens?: unknown[]; subtotal?: number; valorDesconto?: number; frete?: number; total?: number;
    descontoPct?: number; prazoValidadeDias?: number; criadoEm?: number; atualizadoEm?: number;
  };
  if (d.conversationId !== conversationId) { res.status(403).json({ ok: false, error: "ORCAMENTO_OUTRA_CONVERSA" }); return; }

  res.json({
    ok: true,
    orcamentoId,
    status: d.status,
    clienteNome: d.clienteNome,
    itens: d.itens,
    subtotal: d.subtotal,
    descontoPct: d.descontoPct,
    valorDesconto: d.valorDesconto,
    frete: d.frete,
    total: d.total,
    prazoValidadeDias: d.prazoValidadeDias,
    criadoEm: d.criadoEm,
    atualizadoEm: d.atualizadoEm,
  });
});
