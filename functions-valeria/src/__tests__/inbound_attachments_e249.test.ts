/**
 * inbound_attachments_e249.test.ts — ValerIA 2.0, Fase E.2.49 (2026-09-23),
 * implementação final de anexos INBOUND reais do cliente.
 *
 * Cobre as peças testáveis isoladamente da nova lógica (`baixarAnexoComLimite`
 * e `processarAnexosInbound`, exportadas para teste, mesma disciplina de
 * `extractAnexosMeta`): download com limite real de bytes (nunca confia só
 * no Content-Length declarado), validação de MIME (declarado x real),
 * geração de nome de arquivo (nunca a partir de `anexosMeta.nome`, que o
 * payload real confirmou ser um placeholder "📸" não confiável), path do
 * Storage, e nunca lançar em nenhum cenário de falha (fail-safe por item).
 */
const savedFiles: Record<string, { buffer: Buffer; contentType?: string }> = {};
let saveShouldThrow: string | null = null;

jest.mock("firebase-admin", () => ({
  apps: [true],
  initializeApp: jest.fn(),
  storage: jest.fn(() => ({
    bucket: () => ({
      file: (path: string) => ({
        save: jest.fn(async (buffer: Buffer, opts?: { contentType?: string }) => {
          if (saveShouldThrow) throw new Error(saveShouldThrow);
          savedFiles[path] = { buffer, contentType: opts?.contentType };
        }),
      }),
    }),
  })),
}));

import { baixarAnexoComLimite, processarAnexosInbound, decidirTextoFinalInbound } from "../webhook";

const ORIGINAL_FETCH = global.fetch;

function respostaSimples(status: number, body: Buffer | null, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    body: null,
    arrayBuffer: async () => (body ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0)),
  } as unknown as Response;
}

/** Simula um corpo em streaming (Web ReadableStream) para exercitar o corte por bytes reais, não só Content-Length. */
function respostaEmStream(status: number, chunks: Buffer[], headers: Record<string, string> = {}) {
  let i = 0;
  const reader = {
    read: async () => {
      if (i >= chunks.length) return { done: true, value: undefined };
      const value = new Uint8Array(chunks[i]);
      i++;
      return { done: false, value };
    },
    cancel: async () => {},
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    body: { getReader: () => reader },
  } as unknown as Response;
}

beforeEach(() => {
  Object.keys(savedFiles).forEach((k) => delete savedFiles[k]);
  saveShouldThrow = null;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("baixarAnexoComLimite", () => {
  test("A. download bem-sucedido, dentro do limite — retorna buffer e content-type", async () => {
    const buf = Buffer.from("conteudo-fake-jpeg");
    global.fetch = jest.fn(async () => respostaSimples(200, buf, { "content-type": "image/jpeg", "content-length": String(buf.byteLength) })) as unknown as typeof fetch;
    const r = await baixarAnexoComLimite("https://x/foto.jpg", 8 * 1024 * 1024, 5000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.buffer.equals(buf)).toBe(true);
      expect(r.contentType).toBe("image/jpeg");
    }
  });

  test("B. HTTP não-2xx — falha com motivo http_<status>", async () => {
    global.fetch = jest.fn(async () => respostaSimples(404, null)) as unknown as typeof fetch;
    const r = await baixarAnexoComLimite("https://x/inexiste.jpg", 8 * 1024 * 1024, 5000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("http_404");
  });

  test("C. Content-Length declarado excede o limite — nunca lê o corpo, falha antes", async () => {
    const arrayBufferSpy = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? "999999999" : null) },
      body: null,
      arrayBuffer: arrayBufferSpy,
    })) as unknown as typeof fetch;
    const r = await baixarAnexoComLimite("https://x/gigante.pdf", 8 * 1024 * 1024, 5000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("content_length_excede_limite");
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  test("D. sem Content-Length confiável, mas corpo real (streaming) excede o limite — corta durante o download", async () => {
    const chunkGrande = Buffer.alloc(6 * 1024 * 1024, 1);
    global.fetch = jest.fn(async () => respostaEmStream(200, [chunkGrande, chunkGrande])) as unknown as typeof fetch;
    const r = await baixarAnexoComLimite("https://x/mentiu-tamanho.pdf", 8 * 1024 * 1024, 5000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("corpo_excede_limite");
  });

  test("E. corpo dentro do limite via streaming — concatena os chunks corretamente", async () => {
    const c1 = Buffer.from("parte1-");
    const c2 = Buffer.from("parte2");
    global.fetch = jest.fn(async () => respostaEmStream(200, [c1, c2], { "content-type": "application/pdf" })) as unknown as typeof fetch;
    const r = await baixarAnexoComLimite("https://x/doc.pdf", 8 * 1024 * 1024, 5000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.buffer.toString()).toBe("parte1-parte2");
  });

  test("F. exceção de rede/timeout — nunca lança, devolve motivo tipado", async () => {
    global.fetch = jest.fn(async () => { const e = new Error("aborted"); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
    const r = await baixarAnexoComLimite("https://x/lento.jpg", 8 * 1024 * 1024, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("timeout");
  });
});

describe("processarAnexosInbound", () => {
  test("G. anexo válido (jpeg) — baixa, valida, salva no Storage, nunca usa anexosMeta.nome no arquivo gerado", async () => {
    const buf = Buffer.from("bytes-da-foto");
    global.fetch = jest.fn(async () => respostaSimples(200, buf, { "content-type": "image/jpeg" })) as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_1", "msg_abc", [
      { url: "https://s3/foto.jpeg", mimeType: "image/jpeg", tamanho: buf.byteLength, nome: "📸" },
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].name).toBe("imagem_msg_abc.jpg");
    expect(resultado[0].name).not.toContain("📸");
    expect(resultado[0].storagePath).toBe("atendimentos_inbound/atd_1/msg_abc/imagem_msg_abc.jpg");
    expect(resultado[0].mimeType).toBe("image/jpeg");
    expect(resultado[0].size).toBe(buf.byteLength);
    expect(resultado[0].providerMessageId).toBe("msg_abc");
    expect(savedFiles["atendimentos_inbound/atd_1/msg_abc/imagem_msg_abc.jpg"]).toBeDefined();
  });

  test("H. PDF válido — prefixo 'documento', extensão .pdf", async () => {
    const buf = Buffer.from("%PDF-fake");
    global.fetch = jest.fn(async () => respostaSimples(200, buf, { "content-type": "application/pdf" })) as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_2", "msg_pdf1", [
      { url: "https://s3/orc.pdf", mimeType: "application/pdf", tamanho: buf.byteLength },
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].name).toBe("documento_msg_pdf1.pdf");
  });

  test("I. MIME declarado não suportado (ex: video/mp4) — nunca baixa, item omitido", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_3", "msg_vid", [
      { url: "https://s3/video.mp4", mimeType: "video/mp4", tamanho: 1000 },
    ]);
    expect(resultado).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("J. Content-Type real diverge do declarado — rejeita, nunca salva no Storage", async () => {
    const buf = Buffer.from("na-verdade-e-outra-coisa");
    global.fetch = jest.fn(async () => respostaSimples(200, buf, { "content-type": "text/html" })) as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_4", "msg_div", [
      { url: "https://s3/nao-e-imagem", mimeType: "image/png", tamanho: buf.byteLength },
    ]);
    expect(resultado).toHaveLength(0);
    expect(Object.keys(savedFiles)).toHaveLength(0);
  });

  test("K. sem url no anexo — nunca chama fetch, item omitido", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_5", "msg_sem_url", [{ mimeType: "image/png", tamanho: 10 }]);
    expect(resultado).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("L. array de anexosMeta vazio — retorna [] imediatamente, nunca chama fetch", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_6", "msg_vazio", []);
    expect(resultado).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("M. falha no Storage (save lança) — não derruba a função, item omitido do resultado", async () => {
    const buf = Buffer.from("ok-mas-storage-falha");
    global.fetch = jest.fn(async () => respostaSimples(200, buf, { "content-type": "image/png" })) as unknown as typeof fetch;
    saveShouldThrow = "bucket indisponível (simulado)";
    const resultado = await processarAnexosInbound("atd_7", "msg_storage_fail", [
      { url: "https://s3/foto.png", mimeType: "image/png", tamanho: buf.byteLength },
    ]);
    expect(resultado).toEqual([]);
  });

  test("N. download falha (HTTP 500) — item omitido, nunca lança", async () => {
    global.fetch = jest.fn(async () => respostaSimples(500, null)) as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_8", "msg_500", [
      { url: "https://s3/instavel.jpg", mimeType: "image/jpeg", tamanho: 10 },
    ]);
    expect(resultado).toEqual([]);
  });

  test("O. dois anexos válidos na mesma mensagem — nomes com sufixo de índice, sem colisão de path", async () => {
    const buf = Buffer.from("img");
    global.fetch = jest.fn(async () => respostaSimples(200, buf, { "content-type": "image/jpeg" })) as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_9", "msg_multi", [
      { url: "https://s3/1.jpg", mimeType: "image/jpeg", tamanho: buf.byteLength },
      { url: "https://s3/2.jpg", mimeType: "image/jpeg", tamanho: buf.byteLength },
    ]);
    expect(resultado).toHaveLength(2);
    expect(resultado[0].name).toBe("imagem_msg_multi_0.jpg");
    expect(resultado[1].name).toBe("imagem_msg_multi_1.jpg");
    expect(resultado[0].storagePath).not.toBe(resultado[1].storagePath);
  });

  test("P. um anexo falha e outro é válido na mesma mensagem — o válido é persistido mesmo assim", async () => {
    let chamada = 0;
    global.fetch = jest.fn(async () => {
      chamada++;
      if (chamada === 1) return respostaSimples(404, null);
      return respostaSimples(200, Buffer.from("ok"), { "content-type": "image/png" });
    }) as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_10", "msg_misto", [
      { url: "https://s3/quebrado.jpg", mimeType: "image/jpeg", tamanho: 10 },
      { url: "https://s3/ok.png", mimeType: "image/png", tamanho: 2 },
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].name).toBe("imagem_msg_misto_1.png");
  });

  test("Q. nunca inclui a URL original (temporária) do Chatvolt no objeto persistido", async () => {
    const buf = Buffer.from("x");
    global.fetch = jest.fn(async () => respostaSimples(200, buf, { "content-type": "image/png" })) as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_11", "msg_url", [
      { url: "https://chatvolt-bucket.s3.amazonaws.com/segredo-temporario.png", mimeType: "image/png", tamanho: buf.byteLength },
    ]);
    expect(resultado).toHaveLength(1);
    expect(JSON.stringify(resultado[0])).not.toContain("chatvolt-bucket");
  });

  test("R. mimeType ausente no anexo — tratado como não suportado, nunca lança", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const resultado = await processarAnexosInbound("atd_12", "msg_sem_mime", [{ url: "https://s3/x", tamanho: 10 }]);
    expect(resultado).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * decidirTextoFinalInbound — homologação real (Teste 2, 2026-09-23) achou
 * um segundo placeholder técnico real ("📄", PDF) além do "📸" (imagem) já
 * confirmado. Ajuste mínimo: lista fechada de 2 placeholders confirmados,
 * nunca regex ampla, nunca decisão só por MIME.
 */
describe("decidirTextoFinalInbound", () => {
  test("imagem + '📸' com anexo persistido — texto vira vazio", () => {
    expect(decidirTextoFinalInbound("📸", 1)).toBe("");
  });

  test("PDF + '📄' com anexo persistido — texto vira vazio", () => {
    expect(decidirTextoFinalInbound("📄", 1)).toBe("");
  });

  test("imagem + legenda real — preserva o texto exatamente como veio", () => {
    expect(decidirTextoFinalInbound("Segue a arte aprovada", 1)).toBe("Segue a arte aprovada");
  });

  test("PDF + texto real — preserva o texto exatamente como veio", () => {
    expect(decidirTextoFinalInbound("Segue o boleto", 1)).toBe("Segue o boleto");
  });

  test("'📄' SEM anexo persistido (download/validação falhou) — preserva o placeholder, nunca suprime sem attachment real", () => {
    expect(decidirTextoFinalInbound("📄", 0)).toBe("📄");
  });

  test("emoji diferente, não confirmado como placeholder (ex: '📎'), mesmo com anexo — preserva, nunca generaliza", () => {
    expect(decidirTextoFinalInbound("📎", 1)).toBe("📎");
  });

  test("texto nulo/ausente, sem anexo — vira string vazia (nunca undefined/null no Firestore)", () => {
    expect(decidirTextoFinalInbound(null, 0)).toBe("");
    expect(decidirTextoFinalInbound(undefined, 0)).toBe("");
  });
});
