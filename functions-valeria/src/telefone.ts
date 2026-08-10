/**
 * telefone.ts — Identidade canônica de telefone (E.164 BR) e matching robusto
 *
 * O identificador primário vindo do WhatsApp é o telefone em E.164
 * (+5516999990001). O ERP, porém, guarda telefones em formatos legados
 * variados: "(16) 99999-0001", "016 9999-0001", "5516999990001",
 * "16 9999 0001" (fixo/celular de 8 dígitos pré-migração do 9º dígito).
 *
 * Estratégia de matching (ordem exigida pela instrução da rodada):
 *   1. telefone exato        — dígitos idênticos;
 *   2. telefone normalizado  — mesma chave canônica DDD+últimos 8 dígitos,
 *      o que torna equivalentes o formato com/sem +55, com/sem 0 de
 *      operadora antes do DDD e com/sem o 9º dígito de celular;
 *   3. cliente existente     — busca em CLIENTES_DATA (quem chama decide);
 *   4. lead existente        — busca em crm_leads (quem chama decide).
 *
 * A chave canônica usa DDD + ÚLTIMOS 8 dígitos porque o 9º dígito de
 * celular BR é um prefixo "9" adicionado ao número antigo — os últimos 8
 * dígitos permaneceram estáveis na migração nacional. Números curtos ou
 * estrangeiros (sem DDD BR reconhecível) caem no fallback de igualdade
 * exata de dígitos — nunca um "match" aproximado.
 */

/** Só dígitos. */
export function somenteDigitos(tel: string | null | undefined): string {
  return (tel ?? "").replace(/\D/g, "");
}

/**
 * Remove prefixos de discagem: 00 internacional, 55 do Brasil e o 0 de
 * operadora antes do DDD. Devolve o "miolo" DDD+numero quando reconhecível.
 */
function removerPrefixosBR(digits: string): string {
  let d = digits;
  if (d.startsWith("00")) d = d.slice(2);
  // 55 + (10|11 dígitos) = país Brasil + DDD + número
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  // 0 de operadora antes do DDD (011, 016...) — só quando sobra tamanho válido
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1);
  return d;
}

/**
 * Chave canônica de comparação: DDD + últimos 8 dígitos.
 * Retorna null quando o número não tem forma BR reconhecível
 * (nesses casos o matching deve usar igualdade exata de dígitos).
 */
export function chaveCanonicaBR(tel: string | null | undefined): string | null {
  const d = removerPrefixosBR(somenteDigitos(tel));
  if (d.length !== 10 && d.length !== 11) return null; // DDD(2) + 8|9 dígitos
  const ddd = d.slice(0, 2);
  const numero = d.slice(2);
  return ddd + numero.slice(-8);
}

/**
 * Normaliza para E.164 brasileiro (+55DDDNÚMERO). Números de 8 dígitos
 * começando em 6-9 (celular pré-9º dígito) ganham o "9" na frente, como na
 * migração oficial. Retorna null quando não é possível normalizar com
 * segurança — nunca inventa um número.
 */
export function paraE164BR(tel: string | null | undefined): string | null {
  const d = removerPrefixosBR(somenteDigitos(tel));
  if (d.length === 11) return "+55" + d;
  if (d.length === 10) {
    const ddd = d.slice(0, 2);
    const numero = d.slice(2);
    // celular antigo de 8 dígitos (6-9) → prefixa o 9 da migração nacional
    if (/^[6-9]/.test(numero)) return "+55" + ddd + "9" + numero;
    return "+55" + d; // fixo de 8 dígitos permanece como está
  }
  return null;
}

/**
 * Dois telefones apontam para a mesma pessoa?
 * 1º exato (dígitos idênticos); 2º chave canônica BR.
 */
export function telefonesEquivalentes(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = somenteDigitos(a);
  const db = somenteDigitos(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const ka = chaveCanonicaBR(a);
  const kb = chaveCanonicaBR(b);
  return ka !== null && kb !== null && ka === kb;
}

/**
 * Encontra o primeiro item de `lista` cujo telefone (extraído por
 * `getTel`) é equivalente a `tel`. Passa duas vezes: primeiro igualdade
 * exata de dígitos (mais forte), depois chave canônica — garantindo que
 * um match exato nunca perde para um canônico de outro registro.
 */
export function encontrarPorTelefone<T>(
  tel: string | null | undefined,
  lista: T[],
  getTel: (item: T) => string | null | undefined
): T | null {
  const alvo = somenteDigitos(tel);
  if (!alvo) return null;
  const exato = lista.find((item) => somenteDigitos(getTel(item)) === alvo);
  if (exato) return exato;
  const chave = chaveCanonicaBR(tel);
  if (chave === null) return null;
  return lista.find((item) => chaveCanonicaBR(getTel(item)) === chave) ?? null;
}
