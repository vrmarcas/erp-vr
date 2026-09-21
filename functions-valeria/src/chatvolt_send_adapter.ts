/**
 * chatvolt_send_adapter.ts — ValerIA 2.0, Fase E.2.13 (2026-09-21).
 *
 * ÚNICA responsabilidade: enviar um texto JÁ PRONTO e JÁ VALIDADO pelo
 * `POST /conversation/message/{type}/{value}` do ChatVolt, uma única vez
 * por chamada, e devolver o id/status que o ChatVolt confirmou. Não gera
 * texto, não decide se deve enviar, não sabe o que é um nextAction — quem
 * chama (active_pilot_runner.ts) decide tudo isso antes.
 *
 * Endpoint documentado em VALERIA_FASE_E2_6_ARQUITETURA_ASSINCRONA
 * (auditoria, não executada até esta fase): resposta inclui o objeto
 * `message` completo (id/conversationId/createdAt), autoria sempre
 * "from":"human" no schema documentado — por isso a guarda anti-loop em
 * active_pilot_send_ledger.ts nunca confia em `from`, só no `id`
 * devolvido aqui.
 *
 * NUNCA chamado nesta fase (E.2.13): `activePilotEnabled=false` em
 * produção — este arquivo existe para a orquestração ficar pronta e
 * testável, sem que nenhuma chamada de rede real ocorra enquanto o gate
 * estiver desligado (active_pilot_config.ts decide isso, não este
 * arquivo).
 */

const API_BASE = "https://api.chatvolt.ai";

export interface ChatvoltSendResult {
  id: string;
  raw: unknown;
}

export async function sendChatvoltMessage(conversationId: string, text: string): Promise<ChatvoltSendResult> {
  const apiKey = process.env.CHATVOLT_API_KEY;
  if (!apiKey) throw new Error("CHATVOLT_API_KEY ausente — não é possível enviar");

  const res = await fetch(`${API_BASE}/conversation/message/id/${conversationId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`send-message falhou: ${res.status} ${bodyText.slice(0, 200)}`);
  }

  const body = (await res.json()) as { id?: string; message?: { id?: string } };
  const id = body.id ?? body.message?.id;
  if (!id) throw new Error("send-message respondeu 2xx mas sem id de mensagem — não é possível confirmar o envio");

  return { id, raw: body };
}
