/**
 * vitre_draft_writer.ts — ValerIA 2.0, Fase C.1 (endurecimento operacional, 2026-09-19).
 *
 * Elimina a cadeia "LLM chama valeria_update_catalog_qualification → LLM
 * decide chamar criar_rascunho_vitre depois" (seção 2 do plano aprovado).
 * `functions-valeria` e `functions/src` são codebases de deploy separados
 * (auditoria de arquitetura) — não existe módulo compartilhável para
 * importar `valeriaVitreCriarRascunho` diretamente. Das 4 opções ordenadas
 * pelo plano (reusar módulo / persistir direto na estrutura canônica com a
 * mesma validação / chamar endpoint interno / cadeia LLM), esta é a opção
 * 2: escreve direto em `vitre_orcamentos` com O MESMO shape e a MESMA
 * disciplina de `functions/src/valeria_vitre.ts:245-300`
 * (`valeriaVitreCriarRascunho`) — nunca aceita preço externo, sempre
 * `precoSnapshot` vindo do documento Vitre real lido agora. Mesma
 * disciplina de mirror já usada 4x neste codebase (detectores +
 * vitre_eligibility.ts).
 *
 * Por que NÃO a opção 3 (chamar o endpoint HTTP `criar_rascunho_vitre`
 * cross-codebase): dentro de uma ÚNICA chamada síncrona que o Chatvolt
 * está esperando, isso dobraria a superfície de falha (2 handshakes de
 * auth com segredos diferentes, 2 sistemas de idempotência a reconciliar,
 * 1 hop de rede extra) sem necessidade — a escrita de `vitre_orcamentos`
 * é simples/estável o bastante para replicar com segurança. (Já para o
 * handoff humano — ver human_handoff.ts — a decisão foi a oposta, porque
 * `solicitarHumanoCore` tem efeitos colaterais que não é seguro adivinhar.)
 *
 * IDEMPOTÊNCIA: doc ID DETERMINÍSTICO (`valeria2_catalog_{conversationId}`)
 * — uma única conversa nunca produz 2 rascunhos de catálogo desta Tool,
 * mesmo sob retry/webhook duplicado, sem precisar de uma collection de
 * idempotency-keys separada. `Firestore .create()` falha (ALREADY_EXISTS)
 * se o doc já existir — tratado como "já processado", nunca sobrescreve.
 */
import * as admin from "firebase-admin";

const COL_ORC = "vitre_orcamentos";

export interface VitreDraftProductInput {
  id: string; // ID real do doc vitre_produtos
  sku: string;
  nome: string;
  precoVenda: number;
}

export interface CreateVitreDraftInput {
  conversationId: string;
  organizationId: string;
  clienteNome: string;
  produto: VitreDraftProductInput;
  quantity: number;
}

export interface CreateVitreDraftResult {
  id: string;
  jaProcessado: boolean;
  total: number;
}

export function draftDocId(conversationId: string): string {
  return `valeria2_catalog_${conversationId}`;
}

/**
 * PARIDADE DE CONTRATO (Fase D, seção 0, 2026-09-19) — todo campo aqui tem
 * um par direto no doc que `valeriaVitreCriarRascunho`
 * (`functions/src/valeria_vitre.ts:277-289`) grava, MESMO conjunto de
 * chaves. Testado por comparação estática contra o texto-fonte real desse
 * arquivo em `__tests__/vitre_draft_writer_parity.test.ts` — se o writer
 * oficial ganhar/renomear um campo lá, o teste quebra aqui, nunca diverge
 * em silêncio. Diferenças DELIBERADAS (documentadas, não drift):
 *   - `origem: "valeria_v2"` (oficial usa "valeria") — rastreabilidade
 *     explícita de qual pipeline criou o rascunho; nenhum consumidor hoje
 *     filtra por origem==="valeria" na collection vitre_orcamentos (só em
 *     erp_vr.orcamentos, domínio diferente — auditado em index.html:36004).
 *   - `requestId`/`id` usam o MESMO valor determinístico (doc id), em vez
 *     de um requestId externo — decisão de idempotência (ver cabeçalho).
 *   - `adicionais` sempre `[]` — V2 ainda não coleta personalização
 *     precificada nesta fase (Fase D trata só o catálogo-base).
 */
export function buildVitreDraftPayload(input: CreateVitreDraftInput) {
  const docId = draftDocId(input.conversationId);
  const total = +(input.produto.precoVenda * input.quantity).toFixed(2);
  return {
    id: docId,
    requestId: docId,
    tipo: "catalogo_vitre",
    marca: "vitre",
    status: "rascunho",
    clienteNome: input.clienteNome,
    itens: [
      {
        sku: input.produto.sku,
        nomeSnapshot: input.produto.nome,
        precoSnapshot: input.produto.precoVenda,
        qtd: input.quantity,
        adicionais: [] as Array<{ nome: string; preco: number }>,
      },
    ],
    descontoPct: 0,
    valorDesconto: 0,
    frete: 0,
    subtotal: total,
    total,
    prazoValidadeDias: 7,
    validoAte: Date.now() + 7 * 86400000,
    origem: "valeria_v2",
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    criadoEm: Date.now(),
  };
}

/**
 * Cria (ou reconhece já criado) o rascunho Vitre para esta conversa —
 * status SEMPRE "rascunho" (nunca "enviado"), nunca comunicado ao cliente
 * por esta função. Idempotente por conversationId.
 */
export async function createVitreDraftIfNotExists(input: CreateVitreDraftInput): Promise<CreateVitreDraftResult> {
  const db = admin.firestore();
  const docId = draftDocId(input.conversationId);
  const docRef = db.collection(COL_ORC).doc(docId);
  const payload = buildVitreDraftPayload(input);

  try {
    await docRef.create(payload);
    return { id: docId, jaProcessado: false, total: payload.total };
  } catch (e) {
    const code = (e as { code?: number | string }).code;
    // gRPC ALREADY_EXISTS = 6 (admin SDK) — único caso esperado de conflito.
    if (code === 6 || code === "already-exists") {
      const existing = await docRef.get();
      const existingTotal = (existing.data()?.total as number) ?? payload.total;
      return { id: docId, jaProcessado: true, total: existingTotal };
    }
    throw e;
  }
}
