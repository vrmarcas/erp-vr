/**
 * identity_detector.ts — extração determinística de nome/telefone do
 * texto do cliente (sprint P0.9).
 *
 * Achado real de E2E (sprint P0.7): mesmo com nome/telefone declarados
 * explicitamente pelo cliente na conversa, o LLM às vezes nunca chama
 * `criar_ou_atualizar_cliente`/`abrir_oportunidade` — travando
 * identify_customer indefinidamente. Este módulo extrai nome+telefone do
 * texto de forma pura e determinística; o chamador (atendimentos.ts)
 * persiste via chamada direta ao endpoint real, nunca dependendo do LLM
 * decidir chamar uma Tool.
 *
 * Escopo deliberadamente conservador: só reconhece nome+telefone quando
 * AMBOS aparecem com um padrão claro de autoidentificação (nunca tenta
 * extrair um nome de qualquer substantivo capitalizado do texto — isso
 * geraria falsos positivos). Se não reconhecer com confiança, não
 * extrai nada — nunca "chuta" identidade.
 */

export interface ExtractedIdentity {
  nome: string | null;
  telefone: string | null;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Sequência de 1-4 palavras capitalizadas (nome próprio em PT-BR) —
// exige que CADA palavra comece maiúscula, então "Gabriel, do GoJovem"
// para naturalmente em "Gabriel" (vírgula/"do" quebram a sequência).
const NOME_TOKEN = "[A-ZÀ-Ý][a-zà-ÿ]+(?:\\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}";

// Prefixo com alternância explícita de maiúscula/minúscula (NUNCA flag "i"
// no regex inteiro — isso faria NOME_TOKEN também casar minúsculas,
// quebrando a exigência real de "cada palavra do nome começa maiúscula").
const NOME_PATTERNS: RegExp[] = [
  new RegExp(`\\b[Ss]ou\\s+(?:o\\s+|a\\s+)?(${NOME_TOKEN})`),
  // "é" já chega normalizado como "e" (normalize() remove acentos antes do match).
  new RegExp(`\\b[Mm]eu nome\\s*(?:e|eh|:)?\\s*(${NOME_TOKEN})`),
  new RegExp(`\\b[Aa]qui\\s*(?:e|eh)?\\s*(?:o\\s+|a\\s+)?(${NOME_TOKEN})`),
  new RegExp(`\\b[Mm]e chamo\\s+(${NOME_TOKEN})`),
];

export function extrairNome(textoOriginal: string): string | null {
  const texto = normalize(textoOriginal);
  for (const pattern of NOME_PATTERNS) {
    const m = texto.match(pattern);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// Telefone BR: DDD (2 díg) + 8/9 díg, com ou sem +55/parênteses/traços.
const TELEFONE_PATTERN = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/;

export function extrairTelefone(texto: string): string | null {
  const m = texto.match(TELEFONE_PATTERN);
  if (!m) return null;
  let digits = m[0].replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55")) digits = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 11) return null;
  return digits;
}

export function extrairIdentidade(texto: string): ExtractedIdentity {
  return { nome: extrairNome(texto), telefone: extrairTelefone(texto) };
}
