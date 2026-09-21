/**
 * shadow_diagnostics.ts — ValerIA 2.0, Fase E.2.8 (2026-09-21).
 *
 * Canal de observabilidade via Firestore (comprovadamente funcional,
 * diferente de console.log/console.error desta function — ver
 * investigação anterior). Não depende de Cloud Logging.
 *
 * 1 documento por execução lógica (`valeria_shadow_diagnostics/{diagKey}`),
 * `diagKey` = mesma chave de idempotência já usada pelo webhook
 * (`explicitMsgId ?? idempKey`) — retry escreve no MESMO doc via
 * `merge:true` + caminho de campo `stages.<STAGE>`, nunca cria duplicado.
 *
 * Restrito, pelo CHAMADOR, a números allowlisted/isTest durante esta
 * investigação — este módulo em si não decide isso, só grava o que
 * mandarem gravar (mesmo padrão de shadow_runner.ts: fronteira de I/O
 * fina, decisão fica de quem chama).
 *
 * Nunca lança para o chamador — uma falha ao gravar diagnóstico nunca
 * pode quebrar o fluxo real nem o próprio shadow.
 */
import * as admin from "firebase-admin";

const COL = "valeria_shadow_diagnostics";

export type ShadowDiagnosticStage =
  | "WEBHOOK_EVENT_STORED"
  | "CONTEXT_RESOLVED"
  | "SHADOW_GATE_EVALUATED"
  | "SHADOW_RUNNER_ENTERED"
  | "SHADOW_PIPELINE_COMPLETED"
  | "SHADOW_RESULT_WRITE_ATTEMPTED"
  | "SHADOW_RESULT_WRITE_CONFIRMED"
  | "SHADOW_ERROR";

export async function recordShadowDiagnosticStage(
  diagKey: string,
  stage: ShadowDiagnosticStage,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    await admin
      .firestore()
      .collection(COL)
      .doc(diagKey)
      .set(
        {
          diagKey,
          [`stages.${stage}`]: { ...data, at: Date.now() },
          lastStage: stage,
          lastStageAt: Date.now(),
          diagnostico: "Dado de diagnóstico — Fase E.2.8, nunca lido por fluxo real de atendimento.",
        },
        { merge: true }
      );
  } catch (e) {
    // Diagnóstico nunca pode quebrar o fluxo real (webhook ou shadow) —
    // se nem isso conseguir escrever, não há mais nada a fazer aqui.
    console.error("[shadow_diagnostics] falha ao gravar estágio (não bloqueia):", (e as Error).message);
  }
}
