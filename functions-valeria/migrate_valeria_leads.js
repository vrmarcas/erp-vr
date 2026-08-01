/**
 * migrate_valeria_leads.js — Migração one-time: valeria_leads[] → crm_leads{}
 *
 * Execução MANUAL no ambiente local com credenciais de service account:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node migrate_valeria_leads.js
 *
 * O que faz:
 *  1. Lê erp_vr/valeria_leads (array antigo de leads da Valéria)
 *  2. Para cada lead, adapta ao formato CrmLead unificado (dict ERP)
 *  3. Faz merge com erp_vr/crm_leads existente (preserva leads ERP já existentes)
 *  4. Grava erp_vr/crm_leads com os novos leads integrados
 *  5. NÃO apaga valeria_leads (rollback simples)
 *
 * Idempotente: re-executar não duplica dados (usa lead.id como chave do dict).
 */

const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const COL = "erp_vr";

// ── Mapeamento de etapas (formato antigo → formato ERP Kanban) ──────────────
const VALERIA_TO_ERP_ETAPA = {
  NOVO_LEAD: "ia_novo", CONTATO_FEITO: "qualificando",
  BRIEFING_COLETADO: "qualificando", ORCAMENTO_ENVIADO: "orc_emitido",
  NEGOCIACAO: "negociacao", GANHO: "fechado", PERDIDO: "fechado",
  REABERTO: "qualificando", aguardando_humano: "qualificando",
};
const ETAPA_TO_TEMP = {
  NOVO_LEAD: "frio", CONTATO_FEITO: "morno", BRIEFING_COLETADO: "morno",
  ORCAMENTO_ENVIADO: "quente", NEGOCIACAO: "quente",
  GANHO: "quente", PERDIDO: "frio", REABERTO: "morno",
};
const TEMP_TO_COR = { quente: "#FCA5A5", morno: "#FCD34D", frio: "#93C5FD" };

/** Adapta um lead antigo (valeria_leads array) para o formato CrmLead unificado */
function adaptLead(old) {
  const status    = old.etapa ?? old.status ?? "NOVO_LEAD";
  const erpEtapa  = VALERIA_TO_ERP_ETAPA[status] ?? "ia_novo";
  const temp      = ETAPA_TO_TEMP[status] ?? "frio";
  const cor       = TEMP_TO_COR[temp];
  const id        = old.id ?? old.leadId ?? `v_${old.conversationId ?? Date.now()}`;

  return {
    // ── Campos ERP (primeiro nível — Kanban) ──
    id,
    nome:    old.nome     ?? old.nomeCliente ?? "Lead Valéria",
    tel:     old.tel      ?? old.telefone    ?? "",
    email:   old.email    ?? undefined,
    etapa:   erpEtapa,
    marca:   old.marca    ?? "vr",
    sub:     old.tel      ?? "",
    temp,
    score:   old.score    ?? (temp === "quente" ? 70 : temp === "morno" ? 40 : 20),
    cor,
    origem:  "valeria",
    cidade:  old.cidade   ?? undefined,
    segmento: old.segmento ?? undefined,
    dores:   old.dores    ?? undefined,
    resumo_ia: old.resumoIa ?? old.resumo ?? undefined,

    // ── Sub-objeto Valéria (não afeta o Kanban) ──
    valeria: {
      status:         status,
      conversationId: old.conversationId ?? id,
      agentId:        old.agentId        ?? "",
      organizationId: old.organizationId ?? "",
      observacoes:    old.observacoes    ?? undefined,
      proximaAcao:    old.proximaAcao    ?? undefined,
      historico:      old.historico      ?? [],
      dataEntrada:    old.dataEntrada    ?? old.createdAt ?? new Date().toISOString(),
      updatedAt:      old.updatedAt      ?? new Date().toISOString(),
      briefing:       old.briefing       ?? undefined,
    },
  };
}

async function fsRead(key) {
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return null;
  const raw = doc.data()?.data;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function fsWrite(key, data) {
  await db.collection(COL).doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

async function main() {
  console.log("=== migrate_valeria_leads.js ===\n");

  // 1. Ler valeria_leads (array antigo)
  const oldLeads = await fsRead("valeria_leads");
  if (!oldLeads || !Array.isArray(oldLeads)) {
    console.log("valeria_leads não encontrado ou não é array — nada a migrar.");
    process.exit(0);
  }
  console.log(`valeria_leads: ${oldLeads.length} lead(s) encontrado(s)`);

  // 2. Ler crm_leads atual (dict)
  const existingDict = (await fsRead("crm_leads")) ?? {};
  console.log(`crm_leads: ${Object.keys(existingDict).length} lead(s) existente(s)`);

  // 3. Converter e fazer merge (idempotente — usa id como chave)
  let added = 0, skipped = 0;
  for (const old of oldLeads) {
    const adapted = adaptLead(old);
    if (!existingDict[adapted.id]) {
      existingDict[adapted.id] = adapted;
      added++;
      console.log(`  [ADD] ${adapted.id} — ${adapted.nome} (${adapted.valeria.status})`);
    } else {
      // Preserva lead ERP existente mas faz merge do sub-objeto valeria se não existir
      if (!existingDict[adapted.id].valeria) {
        existingDict[adapted.id].valeria = adapted.valeria;
        console.log(`  [MERGE valeria] ${adapted.id}`);
      } else {
        console.log(`  [SKIP] ${adapted.id} — já existe no crm_leads`);
        skipped++;
      }
    }
  }

  // 4. Gravar crm_leads atualizado
  await fsWrite("crm_leads", existingDict);
  console.log(`\n✅ Migração concluída: ${added} adicionado(s), ${skipped} pulado(s)`);
  console.log(`crm_leads final: ${Object.keys(existingDict).length} lead(s)`);
  console.log("\nvaleria_leads NÃO foi apagado (rollback disponível).");

  process.exit(0);
}

main().catch(e => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
