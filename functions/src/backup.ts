/**
 * backup.ts — backup automático diário do ERP.
 *
 * RODADA CURTA pós-Rodada 9, Objetivo 2. Causa raiz do "[Backup] Falhou"
 * (console.warn silencioso, index.html): erpBackupAutomatico() escrevia
 * direto em `erp_backups/{date}` a partir do NAVEGADOR de quem quer que
 * carregasse a página, 3s após o carregamento inicial — e essa coleção
 * nunca teve nenhuma Rule própria em firestore.rules, então caía no
 * catch-all `allow read, write: if false` do fim do arquivo. Todo cliente,
 * incluindo master, sempre recebia permission-denied.
 *
 * Movido para cá (Admin SDK, agendado — mesmo padrão de
 * syncMarketingMetricsData em syncMetrics.ts) em vez de simplesmente abrir
 * Rules de escrita para o client:
 *   1. Backup é operação de sistema, não interação de usuário — não
 *      precisa de reatividade em tempo real nem de rodar no navegador.
 *   2. Tirar do client remove duas fragilidades que o mecanismo antigo
 *      tinha: (a) só rodava se ALGUÉM carregasse a página naquele dia —
 *      sem esse acesso, não havia backup nenhum; (b) não checava papel —
 *      qualquer usuário autenticado disparava a tentativa de escrita.
 *   3. Admin SDK ignora Rules por natureza — a Rule de `erp_backups` pode
 *      ficar mínima (leitura só para master; escrita sempre negada ao
 *      client, só a própria função grava).
 *
 * Mesmas 13 chaves já documentadas no tooltip do botão "Exportar Dados"
 * (index.html) — escopo do QUE é salvo é o mesmo desta rodada, só o
 * mecanismo de escrita mudou. Isto não é um backup completo do sistema
 * (não inclui kb_os/kb_os_fin, compras, audit log) — limitação
 * pré-existente e documentada, fora do escopo desta rodada.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const COL_ERP = "erp_vr";
const COL_BACKUP = "erp_backups";

// Mesmo conjunto de chaves do tooltip "Exportar Dados" (index.html,
// erpBackupExportar/_BACKUP_KEYS) — nunca alterar um sem revisar o outro.
const BACKUP_KEYS = [
  "erp_config", "stock", "erp_stock_log", "orcamentos", "clientes",
  "crm_leads", "fin_cr", "fin_cp", "fin_tx", "erp_fornecedores",
  "retalhos", "erp_bank_config", "erp_mat_prices",
];

// Nunca havia checagem de tamanho antes — concatenar 13 documentos
// inteiros em um único campo `data` de um único doc pode ultrapassar o
// limite real de 1 MiB por documento do Firestore. Margem de segurança.
const LIMITE_SEGURO_BYTES = 900 * 1024;

async function gerarBackupDiario(): Promise<{ ok: boolean; motivo?: string; bytes?: number; chaves?: number }> {
  const db = admin.firestore();
  const hoje = new Date().toISOString().slice(0, 10);
  const result: Record<string, unknown> = {};
  let chavesLidas = 0;

  for (const key of BACKUP_KEYS) {
    const doc = await db.collection(COL_ERP).doc(key).get();
    const raw = doc.exists ? (doc.data()?.data as string | undefined) : undefined;
    if (raw) {
      try {
        result[key] = JSON.parse(raw);
        chavesLidas++;
      } catch {
        // Chave corrompida/ilegível não trava o backup das demais.
        console.warn(`[erpBackupDiario] Chave '${key}' com JSON inválido — ignorada nesta rodada de backup.`);
      }
    }
  }

  const payload = JSON.stringify(result);
  const bytes = Buffer.byteLength(payload, "utf8");
  if (bytes > LIMITE_SEGURO_BYTES) {
    console.error(
      `[erpBackupDiario] Payload de ${bytes} bytes excede o limite seguro de ${LIMITE_SEGURO_BYTES} ` +
      `bytes — backup de ${hoje} NÃO foi salvo (evita erro de limite de documento do Firestore). ` +
      `Reduza BACKUP_KEYS ou divida em múltiplos documentos.`
    );
    return { ok: false, motivo: "payload_excede_limite_seguro", bytes, chaves: chavesLidas };
  }

  await db.collection(COL_BACKUP).doc(hoje).set({ data: payload, ts: Date.now(), chaves: chavesLidas, bytes });
  return { ok: true, bytes, chaves: chavesLidas };
}

export const erpBackupDiario = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "America/Sao_Paulo",
    memory: "256MiB",
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    const r = await gerarBackupDiario();
    if (!r.ok) throw new Error("Backup diário falhou: " + r.motivo);
    console.log(`[erpBackupDiario] Backup de hoje salvo — ${r.chaves} chave(s), ${r.bytes} bytes.`);
  }
);
