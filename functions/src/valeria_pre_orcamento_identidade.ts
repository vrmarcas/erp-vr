/**
 * valeria_pre_orcamento_identidade.ts — Etapa 9I (2026-10-27).
 *
 * MÓDULO ISOLADO, NÃO REGISTRADO em `index.ts` — por decisão explícita
 * desta etapa, nenhum export daqui entra na superfície de deploy
 * (`firebase deploy` só publica o que `index.ts` reexporta). Implementação
 * local, testada só via Firestore Emulator — nunca conectado à Chatvolt,
 * nunca chamado por nada em produção.
 *
 * ACHADO DESTA ETAPA: `valeriaGetCliente` (valeria.ts:153, JÁ DEPLOYADO em
 * produção) já faz busca por telefone/nome em `erp_vr/clientes`, mas (a)
 * usa `normTel` — dígitos crus, mais fraco que a chave canônica BR usada
 * pela Central — e (b) sempre devolve o PRIMEIRO match (`.find`), nunca
 * sinaliza ambiguidade. `valeriaUpsertCliente` (valeria.ts:190, existe no
 * código mas NÃO está em index.ts — não deployado) escreveria direto no
 * array oficial sem decisão de ambiguidade. Nenhum dos dois é modificado
 * aqui — este módulo é só um READ mais rigoroso (nunca escreve em
 * erp_vr/clientes) + um registro PROVISÓRIO isolado, nunca uma segunda
 * via de escrita do cadastro oficial.
 */
import * as admin from "firebase-admin";

const COL = "erp_vr";
const PROVISORIOS_COL = "valeria_pre_orcamento_pre_cadastros_provisorios";

interface ClienteRegistro {
  id: string;
  nome: string;
  tel?: string;
  email?: string;
  cidade?: string;
  tipo?: string;
  marca?: string;
  [key: string]: unknown;
}

export interface ClienteProvisorio {
  id: string;
  telefoneE164: string;
  chaveCanonica: string;
  nome: string | null;
  vinculadoClienteIdOficial: string | null;
  createdAt: number;
  updatedAt: number;
  atendimentoIds: string[];
}

export type IdentificacaoClienteResultado =
  | { status: "cliente_oficial_unico"; clienteId: string; nome: string | null; telefoneE164: string }
  | { status: "cliente_oficial_ambiguo"; candidateClienteIds: string[]; telefoneE164: string }
  | { status: "cliente_provisorio"; clienteProvisorioId: string; telefoneE164: string; novoRegistro: boolean }
  | { status: "telefone_invalido" };

async function fsReadClientes(): Promise<ClienteRegistro[]> {
  const doc = await admin.firestore().collection(COL).doc("clientes").get();
  if (!doc.exists) return [];
  const raw = doc.data()?.data;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClienteRegistro[]) : [];
  } catch {
    return [];
  }
}

function somenteDigitos(tel: string | null | undefined): string {
  return (tel ?? "").replace(/\D/g, "");
}

function removerPrefixosBR(digits: string): string {
  let d = digits;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1);
  return d;
}

/** Chave canônica DDD+8 últimos dígitos — mesmo algoritmo de telefone.ts (duplicado por decisão arquitetural: functions/ e functions-valeria/ são pacotes de deploy independentes, nunca importam um do outro). */
export function chaveCanonicaBR(tel: string | null | undefined): string | null {
  const d = removerPrefixosBR(somenteDigitos(tel));
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2);
  const numero = d.slice(2);
  return ddd + numero.slice(-8);
}

export function paraE164BR(tel: string | null | undefined): string | null {
  const d = removerPrefixosBR(somenteDigitos(tel));
  if (d.length === 11) return "+55" + d;
  if (d.length === 10) {
    const ddd = d.slice(0, 2);
    const numero = d.slice(2);
    if (/^[6-9]/.test(numero)) return "+55" + ddd + "9" + numero;
    return "+55" + d;
  }
  return null;
}

/**
 * Consulta READ-ONLY em `erp_vr/clientes` usando a chave canônica (mais
 * robusta que o `normTel` de valeria.ts) — nunca escreve, nunca escolhe
 * "o primeiro" quando há mais de um candidato (ao contrário de
 * `valeriaGetCliente`).
 */
export async function consultarClientePorTelefoneCore(telefoneBruto: string): Promise<
  | { status: "no_match" }
  | { status: "single_match"; clienteId: string; nome: string | null }
  | { status: "ambiguous"; candidateClienteIds: string[] }
> {
  const chave = chaveCanonicaBR(telefoneBruto);
  if (!chave) return { status: "no_match" };
  const clientes = await fsReadClientes();
  const candidatos = clientes.filter((c) => chaveCanonicaBR(c.tel) === chave);
  if (candidatos.length === 0) return { status: "no_match" };
  if (candidatos.length === 1) return { status: "single_match", clienteId: candidatos[0].id, nome: candidatos[0].nome ?? null };
  return { status: "ambiguous", candidateClienteIds: candidatos.map((c) => c.id) };
}

/**
 * Ponto único de identificação desta etapa: consulta o cadastro oficial
 * (read-only) e só cria/reusa um registro PROVISÓRIO (isolado, nunca
 * `erp_vr/clientes`) quando não há match oficial. Concorrência resolvida
 * por id determinístico (derivado da chave canônica) + transação — duas
 * conversas concorrentes do mesmo número convergem para o MESMO registro.
 */
export async function identificarOuPrepararClienteCore(
  telefoneBruto: string,
  atendimentoId: string
): Promise<IdentificacaoClienteResultado> {
  const e164 = paraE164BR(telefoneBruto);
  const chave = chaveCanonicaBR(telefoneBruto);
  if (!e164 || !chave) return { status: "telefone_invalido" };

  const erpResult = await consultarClientePorTelefoneCore(telefoneBruto);
  if (erpResult.status === "single_match") {
    return { status: "cliente_oficial_unico", clienteId: erpResult.clienteId, nome: erpResult.nome, telefoneE164: e164 };
  }
  if (erpResult.status === "ambiguous") {
    return { status: "cliente_oficial_ambiguo", candidateClienteIds: erpResult.candidateClienteIds, telefoneE164: e164 };
  }

  const db = admin.firestore();
  const docId = `preorc_prov_${chave}`;
  const ref = db.collection(PROVISORIOS_COL).doc(docId);
  const novoRegistro = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (!snap.exists) {
      const registro: ClienteProvisorio = {
        id: docId, telefoneE164: e164, chaveCanonica: chave, nome: null,
        vinculadoClienteIdOficial: null, createdAt: now, updatedAt: now, atendimentoIds: [atendimentoId],
      };
      tx.set(ref, registro);
      return true;
    }
    const atual = snap.data() as ClienteProvisorio;
    if (!atual.atendimentoIds.includes(atendimentoId)) {
      tx.set(ref, { ...atual, atendimentoIds: [...atual.atendimentoIds, atendimentoId], updatedAt: now });
    }
    return false;
  });

  return { status: "cliente_provisorio", clienteProvisorioId: docId, telefoneE164: e164, novoRegistro };
}

/** Só preenche campos ainda vazios (ex.: nome) — nunca sobrescreve um valor já presente. */
export async function completarClienteProvisorioCore(clienteProvisorioId: string, patch: { nome?: string }): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection(PROVISORIOS_COL).doc(clienteProvisorioId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const atual = snap.data() as ClienteProvisorio;
    const next: Partial<ClienteProvisorio> = { updatedAt: Date.now() };
    if (patch.nome && !atual.nome) next.nome = patch.nome;
    tx.set(ref, { ...atual, ...next });
  });
}

// ── Wrappers HTTP (Bearer, mesmo padrão de valeria.ts/valeria_vitre.ts) ──────
// NÃO exportados em index.ts nesta etapa — nunca entram na superfície de
// deploy. Import local e tardio de checkAuth evita qualquer custo em quem
// só usa as funções Core acima (ex.: o script de verificação desta etapa).
import * as functions from "firebase-functions";

function cors(res: functions.Response) { res.set("Access-Control-Allow-Origin", "*"); }

export const valeriaConsultarClientePorTelefone = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  // Rodada "fechamento da publicação controlada" (2026-10-28): secret
  // DEDICADO da ponte (erp_bridge_auth.ts), nunca o Bearer administrativo
  // genérico de valeria.ts — este endpoint não tem nenhum chamador legado.
  const { checkBridgeAuth } = await import("./erp_bridge_auth");
  if (!await checkBridgeAuth(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }
  const telefone = String(req.query.telefone || "").trim();
  if (!telefone) { res.status(400).json({ ok: false, error: "telefone obrigatório" }); return; }
  const r = await consultarClientePorTelefoneCore(telefone);
  res.json({ ok: true, ...r });
});

export const valeriaPrepararCadastroProvisorio = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  const { checkBridgeAuth } = await import("./erp_bridge_auth");
  if (!await checkBridgeAuth(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }
  const body = req.body as { telefone?: string; atendimentoId?: string };
  const telefone = String(body.telefone || "").trim();
  const atendimentoId = String(body.atendimentoId || "").trim();
  if (!telefone || !atendimentoId) { res.status(400).json({ ok: false, error: "telefone e atendimentoId são obrigatórios" }); return; }
  const r = await identificarOuPrepararClienteCore(telefone, atendimentoId);
  res.json({ ok: true, ...r });
});
