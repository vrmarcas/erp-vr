/**
 * reabertura_apos_resolvido.test.ts — rodada "resolvido reabre com nova
 * mensagem" (2026-10-21).
 *
 * Bug relatado: atendimento marcado como "Resolvido" nunca mais recebia
 * resposta da Valéria, mesmo quando o cliente mandava uma nova mensagem —
 * causa raiz real: `atdResolverAtendimento` nunca restaurava
 * `modoAtendimento`/`isAiEnabled` quando o atendimento tinha sido assumido
 * por um humano antes de ser resolvido (fluxo Assumir→Resolver sem
 * "Devolver para Valéria"), e nada no caminho de mensagem nova reavaliava
 * nenhum dos dois campos.
 *
 * Cobre a matriz completa de `decidirReaberturaAtendimento`, função pura
 * (sem I/O) — não precisa mock de firebase-admin.
 */
import { decidirReaberturaAtendimento } from "../webhook";

describe("decidirReaberturaAtendimento", () => {
  test("TESTE 2 — atendimento ativo (não resolvido): nunca reabre, mesmo com mensagem de entrada", () => {
    const r = decidirReaberturaAtendimento({ status: "aberto", modoAtendimento: "valeria" }, true);
    expect(r).toEqual({ reabrir: false, patch: {}, reativarIA: false });
  });

  test("TESTE 3 — resolvido sem mensagem de entrada nova (eco/saída/nenhuma): nunca reabre sozinho", () => {
    const r = decidirReaberturaAtendimento({ status: "resolvido", modoAtendimento: "valeria" }, false);
    expect(r).toEqual({ reabrir: false, patch: {}, reativarIA: false });
  });

  test("TESTE 7 — resolvido + Valéria: reabre, modoAtendimento continua valeria, IA não precisa ser re-habilitada no Chatvolt", () => {
    const r = decidirReaberturaAtendimento({ status: "resolvido", modoAtendimento: "valeria" }, true);
    expect(r.reabrir).toBe(true);
    expect(r.patch.status).toBe("aberto");
    expect(r.patch.modoAtendimento).toBeUndefined(); // já era valeria, não precisa reescrever
    expect(r.reativarIA).toBe(false);
  });

  test("TESTE 8 — resolvido + humano, SEM trava persistente: reabre e devolve a elegibilidade para a Valéria", () => {
    const r = decidirReaberturaAtendimento({ status: "resolvido", modoAtendimento: "humano" }, true);
    expect(r.reabrir).toBe(true);
    expect(r.patch).toEqual({
      status: "aberto",
      modoAtendimento: "valeria",
      responsavelUid: null,
      responsavelNome: null,
    });
    expect(r.reativarIA).toBe(true);
  });

  test("TESTE 9 — resolvido + humano, COM trava explícita persistente: reabre o status, mas NUNCA ignora a trava (modoAtendimento continua humano)", () => {
    const r = decidirReaberturaAtendimento(
      { status: "resolvido", modoAtendimento: "humano", travaHumanaPermanente: true },
      true
    );
    expect(r.reabrir).toBe(true);
    expect(r.patch).toEqual({ status: "aberto" });
    expect(r.patch.modoAtendimento).toBeUndefined();
    expect(r.reativarIA).toBe(false);
  });

  test("resolvido + modoAtendimento ausente/indefinido: reabre como valeria (nunca trata undefined como humano)", () => {
    const r = decidirReaberturaAtendimento({ status: "resolvido" }, true);
    expect(r.reabrir).toBe(true);
    expect(r.patch).toEqual({ status: "aberto" });
    expect(r.reativarIA).toBe(false);
  });

  test("resolvido + humano + travaHumanaPermanente:false (explícito): trava não está ativa, reabre para valeria normalmente", () => {
    const r = decidirReaberturaAtendimento(
      { status: "resolvido", modoAtendimento: "humano", travaHumanaPermanente: false },
      true
    );
    expect(r.reabrir).toBe(true);
    expect(r.patch.modoAtendimento).toBe("valeria");
    expect(r.reativarIA).toBe(true);
  });

  test("não-resolvido + humano + mensagem de entrada: nunca mexe em modoAtendimento (não é reabertura, é atendimento humano em andamento)", () => {
    const r = decidirReaberturaAtendimento({ status: "aberto", modoAtendimento: "humano" }, true);
    expect(r).toEqual({ reabrir: false, patch: {}, reativarIA: false });
  });
});
