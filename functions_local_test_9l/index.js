/**
 * index.js — entrypoint ISOLADO só para teste local (Etapa 9L).
 *
 * NUNCA editar functions/src/index.ts (decisão de segurança mantida
 * desde a Etapa 9I) — este diretório é inteiramente separado do pacote
 * de deploy real (functions/), nunca referenciado por firebase.json ou
 * firebase-valeria.json de produção, nunca instalado/deployado.
 *
 * Reexporta, via require() do build JÁ COMPILADO em ../functions/lib
 * (nenhuma compilação própria, nenhuma duplicação de código), só as
 * Cloud Functions novas das Etapas 9I/9J/9K — todas onRequest/onCall já
 * auditadas e testadas via Firestore Emulator direto (Core functions).
 * Esta etapa (9L) só precisa que elas fiquem de fato alcançáveis por
 * `firebase.functions().httpsCallable(...)`/fetch a partir da interface
 * local, o que exige um Functions Emulator real rodando — algo que
 * `index.ts` de produção, por decisão explícita, nunca provê para elas.
 */
// IMPORTANTE: inicializa a MESMA instância de firebase-admin que os
// módulos requeridos abaixo resolvem internamente (via Node walking up
// de ../functions/lib/ até ../functions/node_modules/firebase-admin) —
// nunca a instância separada do node_modules deste diretório isolado,
// que seria um singleton diferente e nunca veria este initializeApp().
const admin = require("../functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp();

const identidade = require("../functions/lib/valeria_pre_orcamento_identidade");
const revisao = require("../functions/lib/valeria_pre_orcamento_revisao");
const estado = require("../functions/lib/valeria_pre_orcamento_estado");

exports.valeriaConsultarClientePorTelefone = identidade.valeriaConsultarClientePorTelefone;
exports.valeriaPrepararCadastroProvisorio = identidade.valeriaPrepararCadastroProvisorio;
exports.vendedorAssumirRevisaoPreOrcamento = revisao.vendedorAssumirRevisaoPreOrcamento;
exports.vendedorConcluirRevisaoPreOrcamento = revisao.vendedorConcluirRevisaoPreOrcamento;
exports.valeriaConsultarEstadoRevisao = estado.valeriaConsultarEstadoRevisao;
