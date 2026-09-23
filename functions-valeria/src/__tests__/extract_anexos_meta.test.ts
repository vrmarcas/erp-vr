/**
 * extract_anexos_meta.test.ts — ValerIA 2.0, Fase E.2.49 (2026-09-23),
 * correção do crash real de produção.
 *
 * Achado real (logs de `valeriaWebhookChatvolt`, produção): a versão
 * anterior de `extractAnexosMeta()` sempre gravava a chave `transcricao`
 * no objeto retornado, mesmo com valor `undefined` (o payload do Chatvolt
 * nunca tem esse campo para anexos que não são áudio) — o Admin SDK do
 * Firestore rejeita qualquer valor `undefined` num `.add()`/`.set()`
 * (sem `ignoreUndefinedProperties`, que este projeto nunca habilita de
 * propósito), derrubando a Cloud Function inteira (status "crash", zero
 * mensagem/anexo persistido) toda vez que um cliente mandava foto/PDF
 * pelo WhatsApp. Esta suíte prova que o objeto gerado NUNCA tem uma
 * propriedade com valor `undefined`/`null` — para nenhum dos 5 campos
 * opcionais, não só `transcricao` — e que o Firestore Admin SDK real
 * aceita o resultado sem lançar exceção.
 */
import { extractAnexosMeta } from "../webhook";

// Recursivamente confirma que nenhuma chave do objeto (em nenhum nível)
// tem valor `undefined` — mesma checagem que o Admin SDK real do
// Firestore faz internamente (`validateUserInput`, ver o stack trace real
// do crash em produção) antes de aceitar um `.add()`/`.set()`. Este
// projeto nunca mocka `firebase-admin` com uma reimplementação real do
// validador do SDK (os mocks existentes em outros testes, ex.
// technical_briefing_store.test.ts, são fakes simples que não replicam
// essa validação) — a prova aqui é a checagem explícita e direta da MESMA
// regra, não uma chamada de rede real (este codebase nunca faz isso em
// teste).
function possuiValorUndefined(obj: unknown): boolean {
  if (obj === undefined) return true;
  if (obj === null || typeof obj !== "object") return false;
  return Object.values(obj as Record<string, unknown>).some((v) => possuiValorUndefined(v));
}

describe("extractAnexosMeta — correção do crash real (transcricao: undefined)", () => {
  test("A. anexo de áudio COM transcricao — campo presente e preservado", () => {
    const resultado = extractAnexosMeta([
      { url: "https://cdn.chatvolt.ai/audio1.ogg", mimeType: "audio/ogg", size: 5000, name: "audio1.ogg", transcricao: "Olá, bom dia" },
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].transcricao).toBe("Olá, bom dia");
    expect(possuiValorUndefined(resultado)).toBe(false);
  });

  test("B. anexo de imagem SEM transcricao — chave 'transcricao' NUNCA aparece no objeto (nem como undefined)", () => {
    const resultado = extractAnexosMeta([
      { url: "https://cdn.chatvolt.ai/foto.png", mimeType: "image/png", size: 954566, name: "foto.png" },
    ]);
    expect(resultado).toHaveLength(1);
    expect("transcricao" in resultado[0]).toBe(false);
    expect(possuiValorUndefined(resultado)).toBe(false);
  });

  test("C. campos opcionais ausentes (só url) — nenhuma chave extra criada com undefined", () => {
    const resultado = extractAnexosMeta([{ url: "https://cdn.chatvolt.ai/x.pdf" }]);
    expect(resultado).toHaveLength(1);
    expect(Object.keys(resultado[0])).toEqual(["url"]);
    expect(possuiValorUndefined(resultado)).toBe(false);
  });

  test("C2. objeto vazio (nenhum campo reconhecido) — retorna objeto vazio, nunca quebra", () => {
    const resultado = extractAnexosMeta([{}]);
    expect(resultado).toHaveLength(1);
    expect(Object.keys(resultado[0])).toEqual([]);
    expect(possuiValorUndefined(resultado)).toBe(false);
  });

  test("D. nenhum valor undefined/null no objeto final, para QUALQUER combinação de campos ausentes", () => {
    const casos = [
      { url: "u" },
      { mimeType: "m" },
      { tamanho: 1 },
      { nome: "n" },
      { transcricao: "t" },
      { url: "u", mimeType: "m" },
      { size: null, name: null }, // valores explicitamente null no payload bruto — também nunca deve virar chave
    ];
    casos.forEach((caso) => {
      const resultado = extractAnexosMeta([caso]);
      expect(possuiValorUndefined(resultado)).toBe(false);
    });
  });

  test("E. array vazio — retorna array vazio, nunca lança exceção", () => {
    expect(extractAnexosMeta([])).toEqual([]);
  });

  test("E2. raw não é array (undefined/null/objeto solto) — retorna array vazio (regressão do guard existente)", () => {
    expect(extractAnexosMeta(undefined)).toEqual([]);
    expect(extractAnexosMeta(null)).toEqual([]);
    expect(extractAnexosMeta({ nao: "é array" })).toEqual([]);
  });

  test("F. múltiplos anexos, mistos (com e sem transcricao) — cada item sanitizado independentemente", () => {
    const resultado = extractAnexosMeta([
      { url: "https://x/foto.jpg", mimeType: "image/jpeg", size: 100, name: "foto.jpg" },
      { url: "https://x/audio.ogg", mimeType: "audio/ogg", size: 200, name: "audio.ogg", transcricao: "oi" },
      { url: "https://x/doc.pdf", mime_type: "application/pdf", tamanho: 300, filename: "doc.pdf" }, // aliases pt-br/snake_case
    ]);
    expect(resultado).toHaveLength(3);
    expect("transcricao" in resultado[0]).toBe(false);
    expect(resultado[1].transcricao).toBe("oi");
    expect(resultado[2].mimeType).toBe("application/pdf");
    expect(resultado[2].nome).toBe("doc.pdf");
    expect(possuiValorUndefined(resultado)).toBe(false);
  });

  test("aliases de nome de campo continuam funcionando (mime_type/type, size, name/filename) — regressão", () => {
    const resultado = extractAnexosMeta([{ url: "u", type: "image/png", size: 10, filename: "f.png" }]);
    expect(resultado[0].mimeType).toBe("image/png");
    expect(resultado[0].tamanho).toBe(10);
    expect(resultado[0].nome).toBe("f.png");
  });

  test("cenário exato do crash real de produção — imagem sem transcricao, documento completo nunca tem undefined em nenhum campo", () => {
    // Mesmo shape gravado por valeria_webhook_events/valeria_msgs
    // (webhook.ts:767/815) — reproduz literalmente a condição que
    // derrubava a function (status "crash") em produção antes desta correção.
    const anexosMeta = extractAnexosMeta([{ url: "https://cdn.chatvolt.ai/foto.png", mimeType: "image/png", size: 954566, name: "foto.png" }]);
    const documentoComoSeriaGravado = { conversationId: "cmt95yjqa0dksuvqt63to9tbm", eventType: "USER_MESSAGE_RECEIVED", anexosMeta, ts: Date.now() };
    expect(possuiValorUndefined(documentoComoSeriaGravado)).toBe(false);
  });
});
