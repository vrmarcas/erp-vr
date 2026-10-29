/**
 * seed_painel_sintetico.js — "Operação Valéria", Frente B (2026-10-29).
 * Semeia dados 100% sintéticos no Firebase Emulator (demo-erp-homolog)
 * para validar visualmente o painel de Atendimentos no browser.
 * Nunca toca erp-vrmarcas real. Cria usuário comercial sintético no Auth
 * Emulator + custom claim role + erp_vr_usuarios doc (mesmo padrão de
 * auth_helper.ts: role só é aceita se claim E doc baterem).
 */
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "demo-erp-homolog" });

async function main() {
  const db = admin.firestore();
  const auth = admin.auth();

  // ── 1. Usuário vendedor sintético (comercial) ──────────────────────
  const email = "vendedor.e2e@teste.local";
  const senha = "e2eSenha123!";
  let user;
  try {
    user = await auth.createUser({ email, password: senha, displayName: "Vendedor E2E Sintético" });
  } catch (e) {
    if (e.code === "auth/email-already-exists") user = await auth.getUserByEmail(email);
    else throw e;
  }
  await auth.setCustomUserClaims(user.uid, { role: "comercial" });
  await db.collection("erp_vr_usuarios").doc(user.uid).set({
    uid: user.uid, nome: "Vendedor E2E Sintético", email, funcao: "comercial", ativo: 1,
  });
  console.log("Vendedor sintético:", { uid: user.uid, email, senha });

  // ── 2. Atendimento Valéria sintético, precisando de humano ─────────
  const atendimentoId = "meta_cmmmk6oqi02hmlcxugbddv62q__1422716937597859__556299396135"; // MESMO id real existente em erp-vrmarcas-homolog (atendimentos + valeria_meta_image_intake) — reuso deliberado para validar a ponte de fotos real a partir do painel local, sem criar atendimento novo em homolog.
  const now = Date.now();
  await db.collection("atendimentos").doc(atendimentoId).set({
    id: atendimentoId, nome: "Cliente Sintético Painel E2E", telefoneE164: "+5562999990099",
    channel: "whatsapp", modoAtendimento: "valeria", status: "aberto",
    ultimaMensagem: "Quero uma caixa personalizada para presente, pode ser com foto?",
    ultimaInteracaoEm: now, naoLidas: 1, requiresHuman: true, humanReason: "CUSTOM_COMPLEX",
    priority: "URGENT", isTeste: true, createdAt: now, updatedAt: now,
  });
  await db.collection("atendimentos").doc(atendimentoId).collection("mensagens").doc("m1").set({
    id: "m1", atendimentoId, providerMessageId: "wamid_e2e_1", idempotencyKey: null,
    actorType: "customer", actorId: "cliente", actorName: "Cliente Sintético Painel E2E",
    text: "Olá! Quero uma caixa personalizada para presente, pode ser com foto?",
    attachments: [], deliveryStatus: "received", provider: "whatsapp", createdAt: now - 60000,
  });
  await db.collection("atendimentos").doc(atendimentoId).collection("mensagens").doc("m2").set({
    id: "m2", atendimentoId, providerMessageId: "wamid_e2e_2", idempotencyKey: null,
    actorType: "ai", actorId: "valeria", actorName: "Valéria",
    text: "Posso te ajudar! Pode me mandar uma foto do que você imagina ou de uma referência?",
    attachments: [], deliveryStatus: "sent", provider: "whatsapp", createdAt: now - 30000,
  });

  // ── 3. Briefing estruturado (qualificação) — valeria_briefings — schema
  // real lido por atdBriefingHtml()/atdRevisarCriarOrcamento() em
  // index.html: produto/familia/quantidade/material/acabamento/
  // larguraMm/alturaMm/prazo/referencia/observacoes + camposFaltando +
  // completude + classificacao. ───────────────────────────────────────
  await db.collection("valeria_briefings").doc(atendimentoId).set({
    atendimentoId,
    produto: "Caixa personalizada para presente", quantidade: 1,
    material: "MDF 3mm", prazo: "até sexta-feira",
    observacoes: "Cliente quer com foto/referência — ver imagem enviada.",
    classificacao: "personalizada",
    camposFaltando: ["larguraMm", "alturaMm", "acabamento"],
    completude: 60,
    updatedAt: now,
  });

  // ── 4. NOTA (achado desta rodada): o painel chama
  // vendedorListarFotosAtendimento/vendedorVisualizarFotoAtendimento
  // (index.html, orcEnvPatchFotosValeria/orcEnvVerFotoValeria), mas essas
  // duas Cloud Functions só existem em
  // functions-valeria/src/meta_image_review_access.ts — deliberadamente
  // NÃO registradas em nenhum index.ts (mesma decisão de segurança do
  // valeriaOrcamentosIntegrityGuard). Como o emulator desta rodada roda
  // só a codebase functions/ (go-live), essas chamadas vão falhar com
  // "function não encontrada" — comportamento ESPERADO e já tratado sem
  // quebrar o modal (catch em orcEnvPatchFotosValeria deixa a caixa
  // vazia). Não registramos essas Functions aqui: ativá-las é uma decisão
  // de segurança separada (cross-codebase), fora do escopo desta rodada
  // (ver relatório final, item D do manifesto). ───────────────────────

  // ── 5. Rascunho personalizado (pré-orçamento) vinculado ao atendimento,
  // usando o schema real de valeria_pre_orcamento_personalizado.ts (grava
  // em erp_vr/orcamentos, array serializado). ────────────────────────
  const orcId = "pers_e2e_painel_" + Date.now();
  const refOrc = db.collection("erp_vr").doc("orcamentos");
  const snapOrc = await refOrc.get();
  const arrOrc = snapOrc.exists && snapOrc.data().data ? JSON.parse(snapOrc.data().data) : [];
  arrOrc.unshift({
    id: orcId, n: arrOrc.length + 1, nomeCliente: "Cliente Sintético Painel E2E",
    tel: "+5562999990099", conversationId: atendimentoId, atendimentoId,
    status: "pre_orc_valeria", marca: "vr",
    itens: [{ prod: "Caixa personalizada para presente", qty: 1, mat: "MDF 3mm", total: "R$ 150,00" }],
    total: 150, dataSalvo: new Date().toISOString(), origem: "valeria_v2",
  });
  await refOrc.set({ data: JSON.stringify(arrOrc), ts: Date.now() });
  console.log("Pré-orçamento personalizado sintético:", orcId, "— atendimento:", atendimentoId);

  console.log("\nSeed concluído. Abra: http://127.0.0.1:5050/?emulator=1");
  console.log("Login:", email, "/", senha);
  console.log("Atendimento sintético:", atendimentoId);
  process.exit(0);
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });
