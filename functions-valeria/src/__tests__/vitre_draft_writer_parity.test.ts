/**
 * vitre_draft_writer_parity.test.ts — ValerIA 2.0, Fase D (2026-09-19).
 *
 * Guarda contra drift silencioso entre vitre_draft_writer.ts (functions-valeria)
 * e valeriaVitreCriarRascunho (functions/src/valeria_vitre.ts) — os dois
 * codebases de deploy separados que gravam em `vitre_orcamentos` (Fase D,
 * seção 0 do plano aprovado). Lê o TEXTO-FONTE REAL do writer oficial (não
 * uma cópia colada aqui) e extrai as chaves do objeto que ele grava — se o
 * writer oficial mudar de campo, este teste quebra, em vez de os dois
 * writers divergirem em silêncio.
 */
import * as fs from "fs";
import * as path from "path";
import { buildVitreDraftPayload } from "../vitre_draft_writer";

const OFFICIAL_WRITER_PATH = path.join(__dirname, "..", "..", "..", "functions", "src", "valeria_vitre.ts");

/** Extrai as chaves de nível 1 do literal de objeto passado para docRef.set(...) em valeriaVitreCriarRascunho. */
function extractOfficialDraftFields(): string[] {
  const src = fs.readFileSync(OFFICIAL_WRITER_PATH, "utf8");
  const start = src.indexOf("await docRef.set({");
  if (start === -1) throw new Error("Não encontrei 'await docRef.set({' em valeria_vitre.ts — o writer oficial pode ter sido refatorado. Revisar este teste.");
  const end = src.indexOf("});", start);
  const bloco = src.slice(start, end);
  // Chaves de nível 1: cobre tanto "nome: valor" quanto shorthand "nome,"/"nome}"
  // (o objeto real usa os dois estilos — ex.: "requestId," é shorthand para "requestId: requestId").
  const matches = [...bloco.matchAll(/(?:{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=[,:}])/g)].map((m) => m[1]);
  return [...new Set(matches)];
}

describe("Paridade vitre_orcamentos — vitre_draft_writer.ts vs. valeriaVitreCriarRascunho (fonte real)", () => {
  test("o arquivo oficial ainda existe e ainda grava em docRef.set({...}) (sentinela de refatoração)", () => {
    expect(fs.existsSync(OFFICIAL_WRITER_PATH)).toBe(true);
    expect(() => extractOfficialDraftFields()).not.toThrow();
  });

  test("todo campo de nível 1 do writer oficial tem par no payload do V2 (nenhum campo esquecido)", () => {
    const oficiais = extractOfficialDraftFields();
    const meuPayload = buildVitreDraftPayload({
      conversationId: "conv1",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "SKU1", sku: "SKU1", nome: "Produto Teste", precoVenda: 100 },
      quantity: 2,
    });
    const minhasChaves = new Set(Object.keys(meuPayload));

    // Diferenças DELIBERADAS documentadas no cabeçalho de vitre_draft_writer.ts
    // — nunca adicionar aqui sem atualizar aquele comentário também.
    const DIFERENCAS_DELIBERADAS = new Set<string>([]); // nenhum campo oficial é OMITIDO hoje — todos têm par.

    const faltando = oficiais.filter((campo) => !minhasChaves.has(campo) && !DIFERENCAS_DELIBERADAS.has(campo));
    expect(faltando).toEqual([]);
  });

  test("meu payload não inventa nenhum campo fora do conjunto oficial + diferenças deliberadas conhecidas", () => {
    const oficiais = new Set(extractOfficialDraftFields());
    const meuPayload = buildVitreDraftPayload({
      conversationId: "conv1",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "SKU1", sku: "SKU1", nome: "Produto Teste", precoVenda: 100 },
      quantity: 2,
    });
    // Campos extras que EU tenho e o oficial não — todos precisam estar
    // documentados no cabeçalho de vitre_draft_writer.ts como deliberados.
    const EXTRAS_DELIBERADOS_MEUS = new Set<string>([]); // meu payload usa exatamente os mesmos nomes de campo do oficial.
    const inesperados = Object.keys(meuPayload).filter((campo) => !oficiais.has(campo) && !EXTRAS_DELIBERADOS_MEUS.has(campo));
    expect(inesperados).toEqual([]);
  });

  test("valores de campos com semântica fixa batem com o comportamento oficial (status/tipo/marca)", () => {
    const meuPayload = buildVitreDraftPayload({
      conversationId: "conv1",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "SKU1", sku: "SKU1", nome: "Produto Teste", precoVenda: 100 },
      quantity: 2,
    });
    expect(meuPayload.status).toBe("rascunho"); // nunca "enviado" — mesmo estado inicial do oficial
    expect(meuPayload.tipo).toBe("catalogo_vitre");
    expect(meuPayload.marca).toBe("vitre");
    // origem é a ÚNICA diferença deliberada de VALOR (não de campo) — documentada no cabeçalho.
    expect(meuPayload.origem).toBe("valeria_v2");
  });

  test("total/subtotal são calculados a partir do preço REAL do produto carregado, nunca de um valor externo", () => {
    const payload = buildVitreDraftPayload({
      conversationId: "conv1",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "SKU1", sku: "SKU1", nome: "Produto Teste", precoVenda: 165 },
      quantity: 3,
    });
    expect(payload.total).toBe(495);
    expect(payload.subtotal).toBe(495);
    expect(payload.itens[0].precoSnapshot).toBe(165);
  });
});
