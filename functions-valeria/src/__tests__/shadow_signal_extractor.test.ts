import { extractShadowSignals } from "../shadow_signal_extractor";
import type { CatalogGroup } from "../product_resolution";

const CATALOG: CatalogGroup[] = [
  {
    catalogGroupId: "caixa_tampa_de_correr",
    categoria: "caixas",
    nome: "Caixa com tampa de correr",
    aliases: ["tampa de correr", "caixa"],
    tamanhos: [],
    toleranciaCm: null,
  },
];

describe("extractShadowSignals", () => {
  test("reconhece alias de grupo por substring", () => {
    const { signals } = extractShadowSignals("Quero uma caixa tampa de correr", CATALOG);
    expect(signals.categoria).toBe("caixas");
    expect(signals.groupNameOrAlias).toBe("tampa de correr");
  });

  test("extrai dimensões explícitas", () => {
    const { signals } = extractShadowSignals("Quero uma placa 30x20", CATALOG);
    expect(signals.exactDimensionsCm).toEqual({ largura: 30, altura: 20, profundidade: null });
  });

  test("extrai quantidade de 'preciso de N'", () => {
    const { fieldUpdate } = extractShadowSignals("Preciso de 10 troféus", CATALOG);
    expect(fieldUpdate.quantity).toBe(10);
  });

  test("sem sinal nenhum, devolve nulls, nunca lança", () => {
    const { signals, fieldUpdate } = extractShadowSignals("Oi, bom dia", CATALOG);
    expect(signals.groupNameOrAlias).toBeNull();
    expect(fieldUpdate.quantity).toBeUndefined();
  });

  test("determinismo", () => {
    const a = extractShadowSignals("Quero uma caixa 30x20", CATALOG);
    const b = extractShadowSignals("Quero uma caixa 30x20", CATALOG);
    expect(a).toEqual(b);
  });
});
