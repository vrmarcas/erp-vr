/**
 * recipes.ts — núcleo puro de geometria de produtos VR personalizados
 * (sprint P0.2 2026-08-23).
 *
 * Porta FIEL (mesmas fórmulas, mesmos nomes) do objeto `PLAN_RECIPES` de
 * `index.html` (linhas ~9267-9385) — a camada de geometria já era pura no
 * frontend (comentário original: peças calculadas por função `pieces(L,A,
 * P,e)` usando só números primitivos, sem DOM). Esta porta NÃO reimplementa
 * matemática nova — apenas move o mesmo código para um módulo Node
 * compartilhável.
 *
 * ESCOPO DELIBERADAMENTE LIMITADO — o que NÃO está aqui, e por quê:
 *   - Receitas "custom" cadastradas em `erp_plan_produtos` (documento-array
 *     único no Firestore, escrito direto pelo client) NÃO são lidas por
 *     este módulo. Só as 13 receitas embutidas (built-in) + o fallback de
 *     peça plana. Motivo: essa coleção é um antipadrão de segurança já
 *     identificado (mesmo padrão que `vitre.ts` corrigiu no lado Vitre) —
 *     não ampliar sua superfície de uso antes de migrá-la é a decisão
 *     mais segura para este sprint.
 *   - Overrides de espessura/consumível POR PEÇA (adesivo, gravação,
 *     spray, extra, espessura divergente por peça) — ver `orcRecalc()`
 *     em index.html, ~250 linhas com dezenas de regras acumuladas ao
 *     longo de várias rodadas de produção real. Extrair isso com paridade
 *     R$0,00 garantida exige um projeto dedicado de portação + testes de
 *     paridade linha a linha — fora do escopo seguro desta sprint (ver
 *     relatório final, seção CORE).
 *   - `recipeSnapshot`/`recipeVersion` (imutabilidade de orçamento antigo)
 *     — este módulo só calcula receita VIGENTE; snapshot continua sendo
 *     responsabilidade exclusiva do fluxo humano (`orcItemVRConstruir`).
 */

export interface RecipePiece {
  qty: number;
  nome: string;
  larg: number;
  alt: number;
}

export interface Recipe {
  dim3d: boolean;
  desc: string;
  /**
   * L=comprimento, A=altura, P=profundidade (0 se dim3d=false), e=espessura mm.
   * `extra` — RODADA DE CORREÇÃO DEFINITIVA (2026-09-01), Bloco 3: mesmo
   * parâmetro opcional já usado por index.html (PLAN_RECIPES) para o
   * toggle "Aplicar descontos de montagem" da receita 'Caixa'. Opcional e
   * ignorado pelas outras 12 receitas — nenhuma delas foi tocada.
   */
  pieces: (L: number, A: number, P: number, e: number, extra?: { descontosMontagemAplicados?: boolean }) => RecipePiece[];
}

// Porta fiel de PLAN_RECIPES (index.html ~9267-9385) — mesmas 13 receitas,
// mesmas fórmulas por peça.
export const PLAN_RECIPES: Record<string, Recipe> = {
  "Armário": {
    dim3d: true, desc: "Laterais, tampo, base, fundo e portas",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Tampo", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Fundo", larg: L - 2 * e, alt: A - 2 * e },
      { qty: 2, nome: "Porta", larg: (L - 2 * e) / 2, alt: A - 2 * e },
    ],
  },
  // RODADA DE CORREÇÃO DEFINITIVA (2026-09-01), Bloco 3 — paridade com
  // index.html: o desconto de montagem (reduzir Lateral/Frente/Fundo pela
  // espessura) deixou de ser incondicional — só aplica quando
  // extra.descontosMontagemAplicados===true. Nenhum caller atual em
  // functions-valeria (quote_core.ts) passa `extra`, então o comportamento
  // automático (Valéria/quote) é o mesmo default do humano: SEM desconto.
  "Caixa": {
    dim3d: true, desc: "Laterais, frente/fundo, base e tampa",
    pieces: (L, A, P, e, extra) => {
      const d = extra?.descontosMontagemAplicados ? e : 0;
      return [
        { qty: 2, nome: "Lateral", larg: P - 2 * d, alt: A - d },
        { qty: 2, nome: "Frente/Fundo", larg: L - 2 * d, alt: A - d },
        { qty: 1, nome: "Base", larg: L, alt: P },
        { qty: 1, nome: "Tampa", larg: L, alt: P },
      ];
    },
  },
  "Expositor": {
    dim3d: true, desc: "Laterais, tampo, base e fundo (sem frente)",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Tampo", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Fundo", larg: L - 2 * e, alt: A - 2 * e },
    ],
  },
  "Organizador": {
    dim3d: true, desc: "Laterais, base e fundo",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Fundo", larg: L - 2 * e, alt: A - e },
    ],
  },
  "Galheteiro": {
    dim3d: true, desc: "Laterais, base, fundo e divisórias",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Fundo", larg: L - 2 * e, alt: A - e },
      { qty: 2, nome: "Divisória", larg: P - e, alt: A - 2 * e },
    ],
  },
  "Porta documentos": {
    dim3d: true, desc: "Laterais, base e fundo",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Fundo", larg: L - 2 * e, alt: A - e },
    ],
  },
  "Porta pasta": {
    dim3d: true, desc: "Laterais, base e fundo",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Fundo", larg: L - 2 * e, alt: A - e },
    ],
  },
  "Porta tablet": {
    dim3d: false, desc: "Frente e base de apoio",
    pieces: (L, A, P, e) => [
      { qty: 1, nome: "Frente", larg: L, alt: A },
      { qty: 1, nome: "Base/Apoio", larg: L, alt: P || 10 },
    ],
  },
  "Prateleira": {
    dim3d: true, desc: "Tampo e suportes laterais",
    pieces: (L, A, P, e) => [
      { qty: 1, nome: "Tampo", larg: L, alt: P },
      { qty: 2, nome: "Suporte", larg: P, alt: A },
    ],
  },
  "Totem": {
    dim3d: true, desc: "Laterais, tampo, base e frente",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Tampo", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Frente", larg: L - 2 * e, alt: A - 2 * e },
    ],
  },
  "Urna": {
    dim3d: true, desc: "Laterais, frente/fundo, base e tampa",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P - 2 * e, alt: A - e },
      { qty: 2, nome: "Frente/Fundo", larg: L - 2 * e, alt: A - e },
      { qty: 1, nome: "Base", larg: L, alt: P },
      { qty: 1, nome: "Tampa", larg: L, alt: P },
    ],
  },
  "Bandeja": {
    dim3d: true, desc: "Fundo e bordas",
    pieces: (L, A, P, e) => [
      { qty: 1, nome: "Fundo", larg: L, alt: A },
      { qty: 2, nome: "Borda longa", larg: L, alt: P || 5 },
      { qty: 2, nome: "Borda curta", larg: A - 2 * e, alt: P || 5 },
    ],
  },
  "Púlpito": {
    dim3d: true, desc: "Laterais, frente inclinada, tampo e base",
    pieces: (L, A, P, e) => [
      { qty: 2, nome: "Lateral", larg: P, alt: A },
      { qty: 1, nome: "Frente", larg: L - 2 * e, alt: A },
      { qty: 1, nome: "Tampo", larg: L - 2 * e, alt: P },
      { qty: 1, nome: "Base", larg: L - 2 * e, alt: Math.round(P * 0.35 * 10) / 10 },
    ],
  },
  "Suporte": {
    dim3d: true, desc: "Base e hastes laterais",
    pieces: (L, A, P, e) => [
      { qty: 1, nome: "Base", larg: L, alt: P || L },
      { qty: 2, nome: "Lateral", larg: P || L, alt: A },
    ],
  },
};

export const PLAN_BUILTIN_NAMES = Object.keys(PLAN_RECIPES);

/**
 * Porta fiel do ramo "built-in + fallback" de `planGetRecipe()`
 * (index.html ~10102-10108) — omite o ramo `recipeSnapshot` (imutabilidade
 * de orçamento antigo, não se aplica a um cálculo novo) e o ramo "custom
 * recipes" (`erp_plan_produtos`, ver aviso no cabeçalho do arquivo).
 */
export function resolveRecipe(produto: string): Recipe {
  if (PLAN_RECIPES[produto]) return PLAN_RECIPES[produto];
  return {
    dim3d: false,
    desc: "Peça plana",
    pieces: (L, A) => [{ qty: 1, nome: produto, larg: L, alt: A }],
  };
}
