/**
 * provision_homolog_vendedor_sintetico.js — "Operação Valéria", autorização
 * explícita do Gabriel (2026-10-29, "AUTORIZO ... EXCLUSIVAMENTE em
 * erp-vrmarcas-homolog") para destravar a revisão visual de fotos.
 *
 * Cria (idempotente — nunca duplica) UMA conta sintética de vendedor
 * SÓ no projeto erp-vrmarcas-homolog, com o papel mínimo ("comercial")
 * necessário para vendedorListarFotosAtendimento/
 * vendedorVisualizarFotoAtendimento. NUNCA toca erp-vrmarcas (produção),
 * nunca copia usuário/senha real, nunca lê/grava dado financeiro.
 *
 * Uso: HOMOLOG_SYNTH_PASSWORD="<senha gerada>" node scripts/provision_homolog_vendedor_sintetico.js
 * A senha nunca é gerada ou impressa por este script — vem só do ambiente,
 * para nunca ficar em histórico de shell nem em log deste arquivo.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "erp-vrmarcas-homolog" });

const EMAIL = "vendedor.sintetico.homolog@erp-vrmarcas-homolog.test";
const PASSWORD = process.env.HOMOLOG_SYNTH_PASSWORD;
if (!PASSWORD) { console.error("defina HOMOLOG_SYNTH_PASSWORD no ambiente"); process.exit(1); }

async function main() {
  let user;
  try {
    user = await admin.auth().getUserByEmail(EMAIL);
    console.log("Usuário sintético já existia:", user.uid);
  } catch (e) {
    user = await admin.auth().createUser({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Vendedor Sintético Homolog (teste)",
      disabled: false,
    });
    console.log("Usuário sintético criado:", user.uid);
  }
  await admin.auth().setCustomUserClaims(user.uid, { role: "comercial" });
  console.log("Custom claim role=comercial aplicada.");

  const db = admin.firestore();
  await db.collection("erp_vr_usuarios").doc(user.uid).set({
    uid: user.uid,
    nome: "Vendedor Sintético Homolog (teste)",
    funcao: "comercial",
    ativo: 1,
    origem: "provisionamento_sintetico_2026-10-29",
  }, { merge: true });
  console.log("Doc erp_vr_usuarios/" + user.uid + " gravado.");
  console.log("UID:", user.uid);
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
