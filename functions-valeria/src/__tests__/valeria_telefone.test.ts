/**
 * valeria_telefone.test.ts — Identidade E.164 BR + matching robusto (Fase 0/1)
 *
 * Cobre a estratégia exigida: telefone exato → normalizado (com/sem +55,
 * 0 de operadora, 9º dígito) → nunca match aproximado para números não-BR.
 * Também valida que extractContext aceita o campo REAL do webhook ChatVolt
 * (userPhoneNumber) como fonte do telefone do cliente.
 */

import {
  somenteDigitos,
  chaveCanonicaBR,
  paraE164BR,
  telefonesEquivalentes,
  encontrarPorTelefone,
} from "../telefone";
import { extractContext } from "../auth";

describe("TELEFONE — paraE164BR", () => {
  test("1. E.164 já correto permanece igual", () => {
    expect(paraE164BR("+5516999990001")).toBe("+5516999990001");
  });
  test("2. dígitos com 55 e 11 dígitos → E.164", () => {
    expect(paraE164BR("5516999990001")).toBe("+5516999990001");
  });
  test("3. formato humano (16) 99999-0001 → E.164", () => {
    expect(paraE164BR("(16) 99999-0001")).toBe("+5516999990001");
  });
  test("4. 0 de operadora antes do DDD (016...) é removido", () => {
    expect(paraE164BR("016999990001")).toBe("+5516999990001");
  });
  test("5. celular antigo de 8 dígitos ganha o 9 da migração", () => {
    expect(paraE164BR("(16) 9999-0001")).toBe("+5516999990001");
  });
  test("6. fixo de 8 dígitos (começa 2-5) NÃO ganha 9", () => {
    expect(paraE164BR("(16) 3333-0001")).toBe("+551633330001");
  });
  test("7. número irreconhecível → null (nunca inventa)", () => {
    expect(paraE164BR("123")).toBeNull();
    expect(paraE164BR("")).toBeNull();
    expect(paraE164BR(null)).toBeNull();
  });
});

describe("TELEFONE — chaveCanonicaBR / telefonesEquivalentes", () => {
  test("8. com e sem +55 são equivalentes", () => {
    expect(telefonesEquivalentes("+5516999990001", "(16) 99999-0001")).toBe(true);
  });
  test("9. com e sem 9º dígito são equivalentes (migração BR)", () => {
    expect(telefonesEquivalentes("+5516999990001", "(16) 9999-0001")).toBe(true);
  });
  test("10. com 0 de operadora é equivalente", () => {
    expect(telefonesEquivalentes("016999990001", "+5516999990001")).toBe(true);
  });
  test("11. DDDs diferentes NÃO são equivalentes", () => {
    expect(telefonesEquivalentes("+5516999990001", "+5511999990001")).toBe(false);
  });
  test("12. últimos 8 dígitos diferentes NÃO são equivalentes", () => {
    expect(telefonesEquivalentes("+5516999990001", "+5516999990002")).toBe(false);
  });
  test("13. números curtos só casam por igualdade exata", () => {
    expect(chaveCanonicaBR("12345")).toBeNull();
    expect(telefonesEquivalentes("12345", "12345")).toBe(true);
    expect(telefonesEquivalentes("12345", "12346")).toBe(false);
  });
  test("14. vazio/null nunca casa com nada", () => {
    expect(telefonesEquivalentes("", "+5516999990001")).toBe(false);
    expect(telefonesEquivalentes(null, null)).toBe(false);
  });
});

describe("TELEFONE — encontrarPorTelefone (ordem exato → canônico)", () => {
  const lista = [
    { id: "c1", tel: "(16) 9999-0001" },   // 8 dígitos legado
    { id: "c2", tel: "16999990001" },       // 9 dígitos sem 55
    { id: "c3", tel: "+5511988887777" },    // outro DDD
  ];

  test("15. match exato de dígitos vence (c2 tem os mesmos dígitos)", () => {
    const r = encontrarPorTelefone("16 99999-0001", lista, (x) => x.tel);
    expect(r?.id).toBe("c2");
  });

  test("16. match canônico encontra o legado de 8 dígitos vindo do E.164 do WhatsApp", () => {
    const soLegado = [lista[0], lista[2]];
    const r = encontrarPorTelefone("+5516999990001", soLegado, (x) => x.tel);
    expect(r?.id).toBe("c1");
  });

  test("17. sem equivalente → null (nunca aproxima para outro DDD)", () => {
    const r = encontrarPorTelefone("+5521900001111", lista, (x) => x.tel);
    expect(r).toBeNull();
  });

  test("18. somenteDigitos remove tudo que não é dígito", () => {
    expect(somenteDigitos("+55 (16) 99999-0001")).toBe("5516999990001");
  });
});

describe("CONTEXT — telefone do webhook real da ChatVolt", () => {
  const base = { conversationId: "conv_x", agentId: "ag_x", organizationId: "org_x" };

  test("19. userPhoneNumber (campo real do webhook) alimenta ctx.channelPhone", () => {
    const r = extractContext({ ...base, userPhoneNumber: "+5516999990001" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.channelPhone).toBe("+5516999990001");
  });

  test("20. channelPhone explícito tem precedência sobre userPhoneNumber", () => {
    const r = extractContext({ ...base, channelPhone: "+5511900000000", userPhoneNumber: "+5516999990001" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.channelPhone).toBe("+5511900000000");
  });

  test("21. sem nenhum campo de telefone → ctx.channelPhone undefined (nunca inventa)", () => {
    const r = extractContext({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.channelPhone).toBeUndefined();
  });
});
