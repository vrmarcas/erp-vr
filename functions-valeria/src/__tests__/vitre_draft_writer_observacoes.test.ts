/**
 * vitre_draft_writer_observacoes.test.ts — ValerIA 2.0, Fase E.2.42
 * (2026-09-22).
 *
 * Campo opcional NOVO em CreateVitreDraftInput/buildVitreDraftPayload —
 * carrega a personalização cosmética para o mesmo campo `observacoes` que
 * o wizard manual Vitre já lê/grava (functions/src/vitre.ts,
 * vitreOrcAbrirRascunho em index.html), nunca afeta preço/SKU.
 */
import { buildVitreDraftPayload } from "../vitre_draft_writer";

const BASE_INPUT = {
  conversationId: "conv1",
  organizationId: "org1",
  clienteNome: "Cliente Teste",
  produto: { id: "SKU1", sku: "SKU1", nome: "Produto Teste", precoVenda: 165 },
  quantity: 20,
};

describe("buildVitreDraftPayload — observacoes (Fase E.2.42)", () => {
  test("sem observacoes no input → campo omitido do payload (nunca grava chave vazia/undefined)", () => {
    const payload = buildVitreDraftPayload(BASE_INPUT);
    expect("observacoes" in payload).toBe(false);
  });

  test("com observacoes no input → gravado literalmente no payload", () => {
    const payload = buildVitreDraftPayload({ ...BASE_INPUT, observacoes: "Personalização (ValerIA): Aplicar logo do cliente" });
    expect(payload.observacoes).toBe("Personalização (ValerIA): Aplicar logo do cliente");
  });

  test("observacoes nunca altera preço/subtotal/total — mesmo cálculo com ou sem personalização", () => {
    const semObs = buildVitreDraftPayload(BASE_INPUT);
    const comObs = buildVitreDraftPayload({ ...BASE_INPUT, observacoes: "Personalização (ValerIA): Logo do cliente" });
    expect(comObs.total).toBe(semObs.total);
    expect(comObs.subtotal).toBe(semObs.subtotal);
    expect(comObs.itens[0].precoSnapshot).toBe(semObs.itens[0].precoSnapshot);
    expect(comObs.itens[0].adicionais).toEqual([]); // nunca cria adicional pago automaticamente
    expect(comObs.total).toBe(3300); // 20 × 165, igual ao caso piloto real (E.2.36)
  });

  test("status continua sempre 'rascunho', mesmo com observacoes preenchida", () => {
    const payload = buildVitreDraftPayload({ ...BASE_INPUT, observacoes: "Personalização (ValerIA): Logo do cliente" });
    expect(payload.status).toBe("rascunho");
  });

  test("string vazia em observacoes é tratada como ausente (falsy) — nunca grava chave vazia", () => {
    const payload = buildVitreDraftPayload({ ...BASE_INPUT, observacoes: "" });
    expect("observacoes" in payload).toBe(false);
  });
});
