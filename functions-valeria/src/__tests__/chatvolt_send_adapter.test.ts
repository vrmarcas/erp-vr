import { sendChatvoltMessage } from "../chatvolt_send_adapter";

const ORIGINAL_ENV = process.env.CHATVOLT_API_KEY;
const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  process.env.CHATVOLT_API_KEY = ORIGINAL_ENV;
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

describe("sendChatvoltMessage — adapter de envio (Fase E.2.13, nunca chamado em produção enquanto activePilotEnabled=false)", () => {
  test("sem CHATVOLT_API_KEY → lança sem tentar rede", async () => {
    delete process.env.CHATVOLT_API_KEY;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    await expect(sendChatvoltMessage("conv1", "texto")).rejects.toThrow(/CHATVOLT_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("resposta 2xx com id → devolve id e raw, chama o endpoint documentado com o texto exato", async () => {
    process.env.CHATVOLT_API_KEY = "fake_key_for_test";
    const fetchSpy = jest.fn(async (url: string, opts: RequestInit) => {
      expect(url).toBe("https://api.chatvolt.ai/conversation/message/id/conv1");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body as string)).toEqual({ message: "texto final validado" });
      return { ok: true, json: async () => ({ id: "msg_123" }) } as Response;
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const result = await sendChatvoltMessage("conv1", "texto final validado");
    expect(result.id).toBe("msg_123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("resposta 2xx sem id em nenhum lugar esperado → lança (nunca confirma envio sem id)", async () => {
    process.env.CHATVOLT_API_KEY = "fake_key_for_test";
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) } as Response)) as unknown as typeof fetch;
    await expect(sendChatvoltMessage("conv1", "texto")).rejects.toThrow(/sem id/);
  });

  test("id aninhado em message.id também é aceito", async () => {
    process.env.CHATVOLT_API_KEY = "fake_key_for_test";
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ message: { id: "msg_456" } }) } as Response)) as unknown as typeof fetch;
    const result = await sendChatvoltMessage("conv1", "texto");
    expect(result.id).toBe("msg_456");
  });

  test("resposta não-ok → lança com status", async () => {
    process.env.CHATVOLT_API_KEY = "fake_key_for_test";
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => "erro interno" } as Response)) as unknown as typeof fetch;
    await expect(sendChatvoltMessage("conv1", "texto")).rejects.toThrow(/500/);
  });
});
