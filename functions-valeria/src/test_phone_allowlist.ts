/**
 * test_phone_allowlist.ts — allowlist de números de teste para o pipeline
 * determinístico de WhatsApp real (sprint P1.2, item 10).
 *
 * Config-driven (Firestore, `erp_vr/valeria_test_phone_numbers`), nunca
 * hardcoded no código. Comportamento por design:
 *   - allowlist VAZIA ou ausente → SEM restrição, pipeline roda para
 *     qualquer número (comportamento de produção normal, o mesmo de hoje).
 *   - allowlist NÃO-VAZIA → só os números listados passam pelo pipeline
 *     determinístico (identidade/confirmação/complexidade/handoff/
 *     execução comercial); qualquer outro número é tratado como
 *     "fora da allowlist" — quem chama decide o que fazer com isso (ver
 *     webhook.ts: mensagem continua sendo logada/persistida no
 *     atendimento, só o pipeline de AÇÃO comercial é pulado).
 *
 * IMPORTANTE (documentado para quem for operar isto): esta allowlist só
 * controla o QUE O NOSSO BACKEND faz a partir do evento de webhook — ela
 * NUNCA impede o próprio agente Chatvolt de responder automaticamente no
 * WhatsApp, porque essa resposta acontece inteiramente dentro da
 * infraestrutura do Chatvolt, antes/independente do nosso webhook ser
 * chamado. Para garantir que a Valéria não responda clientes reais
 * durante um teste, é preciso pausar o canal no lado Chatvolt/Meta — esta
 * allowlist é uma segunda camada de segurança (nunca cria orçamento/
 * altera estado comercial fora da allowlist), não substitui a pausa do
 * canal.
 */
import * as admin from "firebase-admin";
import { telefonesEquivalentes } from "./telefone";

const COL = "erp_vr";
const DOC_ID = "valeria_test_phone_numbers";
const CACHE_TTL_MS = 15_000; // curto o bastante pra editar a allowlist sem esperar redeploy

let _cache: { numeros: string[]; at: number } | null = null;

async function loadAllowlist(): Promise<string[]> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.numeros;
  try {
    const snap = await admin.firestore().collection(COL).doc(DOC_ID).get();
    const numeros = snap.exists ? ((snap.data()?.numeros as string[] | undefined) ?? []) : [];
    _cache = { numeros: Array.isArray(numeros) ? numeros : [], at: now };
  } catch (e) {
    console.error("[test_phone_allowlist] falha ao ler allowlist (tratando como vazia — sem restrição):", (e as Error).message);
    _cache = { numeros: [], at: now };
  }
  return _cache.numeros;
}

/**
 * true = pipeline determinístico deve rodar para este telefone (número na
 * allowlist OU allowlist vazia/ausente = sem restrição, comportamento
 * padrão de produção).
 */
export async function permitidoParaPipeline(channelPhone: string | null): Promise<boolean> {
  const numeros = await loadAllowlist();
  if (numeros.length === 0) return true; // sem restrição configurada — produção normal
  if (!channelPhone) return false;
  return numeros.some((n) => telefonesEquivalentes(n, channelPhone));
}

/** Só para testes — nunca chamado em produção. */
export function _resetCacheParaTeste(): void {
  _cache = null;
}
