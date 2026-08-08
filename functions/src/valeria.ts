/**
 * valeria.ts — Integração Valéria (Chatvolt) com o ERP VR Marcas
 *
 * Endpoints HTTPS para o chatbot Valéria consumir dados do Firestore.
 * Autenticação via Bearer token (variável de ambiente VALERIA_SECRET).
 *
 * Estrutura Firestore:
 *   Coleção: "erp_vr"
 *   Cada documento: { data: JSON.stringify(valor), ts: number }
 *   Documentos usados: clientes, orcamentos, kb_os, crm_leads
 *
 * Deploy: firebase deploy --only functions (NÃO fazer agora — apenas criar arquivo)
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const COL = "erp_vr";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Lê documento do Firestore e faz parse do JSON interno */
async function fsRead<T>(key: string): Promise<T | null> {
  const db = admin.firestore();
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return null;
  const raw = doc.data()?.data;
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Salva dado no Firestore no mesmo formato do ERP */
async function fsWrite(key: string, data: unknown): Promise<void> {
  const db = admin.firestore();
  await db.collection(COL).doc(key).set({
    data: JSON.stringify(data),
    ts: Date.now(),
  });
}

/**
 * Middleware de autenticação — Bearer token comparado com o valor salvo em
 * Firestore em erp_vr/valeria_config { data: JSON.stringify({ secret: "..." }) }
 * Para configurar: salve o token diretamente no Firebase Console ou pelo ERP.
 */
export async function checkAuth(req: functions.https.Request, res: functions.Response): Promise<boolean> {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    res.status(401).json({ ok: false, error: "Authorization header ausente" });
    return false;
  }

  // Lê secret do Firestore (evita depender de Firebase Secret Manager)
  const db = admin.firestore();
  const configDoc = await db.collection(COL).doc("valeria_config").get();
  const configRaw = configDoc.exists ? configDoc.data()?.data : null;
  let secret = "";
  if (configRaw) {
    try { secret = (JSON.parse(configRaw) as { secret?: string }).secret || ""; } catch { /* */ }
  }

  if (!secret) {
    res.status(500).json({ ok: false, error: "VALERIA_SECRET não configurado. Salve em Firestore: erp_vr/valeria_config { data: JSON.stringify({secret:'SEU_TOKEN'}) }" });
    return false;
  }
  if (token !== secret) {
    res.status(401).json({ ok: false, error: "Token inválido" });
    return false;
  }
  return true;
}

/** Normaliza telefone para comparação (apenas dígitos) */
function normTel(tel: string): string {
  return (tel || "").replace(/\D/g, "");
}

/** Data atual no formato dd/mm/yyyy */
function hoje(): string {
  const d = new Date();
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

/** ID único simples (timestamp + random) */
function uid(prefix = "v"): string {
  return prefix + Date.now() + Math.floor(Math.random() * 9000 + 1000);
}

// ── Tipos locais ──────────────────────────────────────────────────────────────

interface Cliente {
  id: string;
  nome: string;
  tipo?: string;
  cidade?: string;
  marca?: string;
  tel?: string;
  email?: string;
  doc?: string;
  contato?: string;
  ultimoPedido?: string;
  os?: string[];
  [key: string]: unknown;
}

interface OrcamentoEnviado {
  id?: string;
  n?: number | string;
  nomeCliente?: string;
  telCliente?: string;
  emailCliente?: string;
  total?: number | string;
  status?: string;
  data?: string;
  marca?: string;
  [key: string]: unknown;
}

interface KbOs {
  id?: string;
  cliente?: string;
  tel?: string;
  status?: string;
  valor?: number | string;
  descricao?: string;
  data?: string;
  [key: string]: unknown;
}

interface CrmLead {
  id?: string;
  nome?: string;
  tel?: string;
  email?: string;
  status?: string;
  origem?: string;
  observacoes?: string;
  dataEntrada?: string;
  proximaAcao?: string;
  dataProximaAcao?: string;
  [key: string]: unknown;
}

// ── 1. buscarCliente ──────────────────────────────────────────────────────────
/**
 * Busca cliente por telefone (ou nome) em CLIENTES_DATA.
 * POST { tel?, nome? }
 * Retorna o cliente encontrado ou null.
 */
export const valeriaGetCliente = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const { tel, nome } = req.body as { tel?: string; nome?: string };
    if (!tel && !nome) {
      res.status(400).json({ ok: false, error: "Informe tel ou nome" });
      return;
    }

    const clientes = await fsRead<Cliente[]>("clientes");
    if (!clientes) { res.json({ ok: true, cliente: null }); return; }

    let found: Cliente | undefined;

    if (tel) {
      const t = normTel(tel);
      found = clientes.find((c) => normTel(c.tel || "") === t);
    }

    if (!found && nome) {
      const n = nome.toLowerCase().trim();
      found = clientes.find((c) => (c.nome || "").toLowerCase().trim() === n);
    }

    res.json({ ok: true, cliente: found || null });
  });

// ── 2. upsertCliente ──────────────────────────────────────────────────────────
/**
 * Cria ou atualiza cliente.
 * POST { tel, nome, email?, cidade?, tipo?, doc?, contato?, marca? }
 * Se já existe pelo tel, atualiza. Senão, cria novo.
 */
export const valeriaUpsertCliente = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const body = req.body as Partial<Cliente> & { tel?: string; nome?: string };
    if (!body.tel || !body.nome) {
      res.status(400).json({ ok: false, error: "tel e nome são obrigatórios" });
      return;
    }

    const clientes = (await fsRead<Cliente[]>("clientes")) || [];
    const t = normTel(body.tel);
    const idx = clientes.findIndex((c) => normTel(c.tel || "") === t);

    let cliente: Cliente;
    let acao: string;

    if (idx >= 0) {
      // Atualiza campos recebidos (sem sobrescrever os omitidos)
      Object.assign(clientes[idx], {
        nome: body.nome,
        ...(body.email !== undefined && { email: body.email }),
        ...(body.cidade !== undefined && { cidade: body.cidade }),
        ...(body.tipo !== undefined && { tipo: body.tipo }),
        ...(body.doc !== undefined && { doc: body.doc }),
        ...(body.contato !== undefined && { contato: body.contato }),
        ...(body.marca !== undefined && { marca: body.marca }),
      });
      cliente = clientes[idx];
      acao = "atualizado";
    } else {
      // Cria novo
      cliente = {
        id: uid("c"),
        nome: body.nome,
        tipo: body.tipo || "PF",
        cidade: body.cidade || "—",
        marca: body.marca || "vr",
        tel: body.tel,
        email: body.email || "",
        doc: body.doc || "",
        contato: body.contato || "",
        ultimoPedido: hoje(),
        os: [],
      };
      clientes.unshift(cliente);
      acao = "criado";
    }

    await fsWrite("clientes", clientes);
    res.json({ ok: true, acao, cliente });
  });

// ── 3. catalogoProdutos ───────────────────────────────────────────────────────
/**
 * Retorna lista de produtos/serviços com preços.
 * GET (sem body)
 * Lê da coleção "erp_vr" doc "produtos" (se existir) ou retorna catálogo estático base.
 */
export const valeriaCatalogo = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    // Tenta ler produtos do Firestore (chave "produtos")
    const produtos = await fsRead<unknown[]>("produtos");

    // Se não tiver catálogo salvo, retorna estrutura mínima para a Valéria
    const catalogo = produtos || [
      { tipo: "Acrílico", descricao: "Painel acrílico sob medida", unidade: "m²", precoBase: null, observacao: "Solicitar orçamento" },
      { tipo: "Sinalização", descricao: "Placa de sinalização personalizada", unidade: "un", precoBase: null, observacao: "Solicitar orçamento" },
      { tipo: "Adesivo", descricao: "Adesivo plotado", unidade: "m²", precoBase: null, observacao: "Solicitar orçamento" },
    ];

    res.json({ ok: true, catalogo });
  });

// ── 4. criarOrcamento ─────────────────────────────────────────────────────────
/**
 * Cria pré-orçamento via Valéria (salvo em _ORC_ENVIADOS_DATA / "orcamentos").
 * POST { nomeCliente, telCliente, emailCliente?, descricao, itens?, total?, marca? }
 */
export const valeriaCriarOrcamento = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const body = req.body as {
      nomeCliente?: string;
      telCliente?: string;
      emailCliente?: string;
      descricao?: string;
      itens?: unknown[];
      total?: number;
      marca?: string;
    };

    if (!body.nomeCliente || !body.telCliente) {
      res.status(400).json({ ok: false, error: "nomeCliente e telCliente são obrigatórios" });
      return;
    }

    const orcamentos = (await fsRead<OrcamentoEnviado[]>("orcamentos")) || [];

    // Gera número sequencial
    const maxN = orcamentos.reduce((m, o) => {
      const n = parseInt(String(o.n || 0));
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const novoN = maxN + 1;

    const orc: OrcamentoEnviado = {
      id: uid("orc"),
      n: novoN,
      nomeCliente: body.nomeCliente,
      telCliente: body.telCliente,
      emailCliente: body.emailCliente || "",
      descricao: body.descricao || "",
      itens: body.itens || [],
      total: body.total || 0,
      status: "pre_orc_valeria", // status especial — identificar origens da Valéria
      data: hoje(),
      marca: body.marca || "vr",
      origem: "valeria",
    };

    orcamentos.unshift(orc);
    await fsWrite("orcamentos", orcamentos);

    res.json({ ok: true, orcamento: orc });
  });

// ── 5. criarOportunidadeCRM ───────────────────────────────────────────────────
/**
 * Cria ou atualiza lead no CRM Pipeline (crm_leads).
 * POST { nome, tel, email?, origem?, observacoes?, proximaAcao?, dataProximaAcao? }
 */
export const valeriaCriarOportunidade = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const body = req.body as Partial<CrmLead> & { tel?: string; nome?: string };
    if (!body.nome || !body.tel) {
      res.status(400).json({ ok: false, error: "nome e tel são obrigatórios" });
      return;
    }

    const leads = (await fsRead<CrmLead[]>("crm_leads")) || [];
    const t = normTel(body.tel);
    const idx = leads.findIndex((l) => normTel(l.tel || "") === t);

    let lead: CrmLead;
    let acao: string;

    if (idx >= 0) {
      Object.assign(leads[idx], {
        nome: body.nome,
        ...(body.email !== undefined && { email: body.email }),
        ...(body.observacoes !== undefined && { observacoes: body.observacoes }),
        ...(body.proximaAcao !== undefined && { proximaAcao: body.proximaAcao }),
        ...(body.dataProximaAcao !== undefined && { dataProximaAcao: body.dataProximaAcao }),
      });
      lead = leads[idx];
      acao = "atualizado";
    } else {
      lead = {
        id: uid("lead"),
        nome: body.nome,
        tel: body.tel,
        email: body.email || "",
        status: "novo",
        origem: body.origem || "valeria",
        observacoes: body.observacoes || "",
        dataEntrada: hoje(),
        proximaAcao: body.proximaAcao || "",
        dataProximaAcao: body.dataProximaAcao || "",
      };
      leads.unshift(lead);
      acao = "criado";
    }

    await fsWrite("crm_leads", leads);
    res.json({ ok: true, acao, lead });
  });

// ── 6. registrarMensagem ──────────────────────────────────────────────────────
/**
 * Registra log de mensagem/conversa no CRM do lead.
 * POST { tel, mensagem, direcao? ('entrada'|'saida'), tipo? }
 * Adiciona ao campo "historico_valeria" do lead ou cria entrada no Firestore.
 */
export const valeriaRegistrarMensagem = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const body = req.body as {
      tel?: string;
      mensagem?: string;
      direcao?: string;
      tipo?: string;
    };
    if (!body.tel || !body.mensagem) {
      res.status(400).json({ ok: false, error: "tel e mensagem são obrigatórios" });
      return;
    }

    const db = admin.firestore();
    const t = normTel(body.tel);

    // Salva em subcoleção valeria_msgs para não inflar o documento principal
    await db.collection("valeria_msgs").add({
      tel: t,
      mensagem: body.mensagem,
      direcao: body.direcao || "entrada",
      tipo: body.tipo || "texto",
      ts: Date.now(),
      data: hoje(),
    });

    res.json({ ok: true });
  });

// ── 7. transferirHumano ───────────────────────────────────────────────────────
/**
 * Sinaliza que o lead precisa de atendimento humano.
 * POST { tel, nome?, motivo? }
 * Atualiza status do lead para "aguardando_humano" e salva no CRM.
 */
export const valeriaTransferirHumano = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const body = req.body as { tel?: string; nome?: string; motivo?: string };
    if (!body.tel) { res.status(400).json({ ok: false, error: "tel é obrigatório" }); return; }

    const leads = (await fsRead<CrmLead[]>("crm_leads")) || [];
    const t = normTel(body.tel);
    const idx = leads.findIndex((l) => normTel(l.tel || "") === t);

    let lead: CrmLead;
    if (idx >= 0) {
      leads[idx].status = "aguardando_humano";
      leads[idx].observacoes = [
        leads[idx].observacoes || "",
        `[${hoje()}] Transferido para humano: ${body.motivo || "sem motivo informado"}`,
      ].filter(Boolean).join("\n");
      lead = leads[idx];
    } else {
      // Cria lead mesmo sem dados completos
      lead = {
        id: uid("lead"),
        nome: body.nome || body.tel,
        tel: body.tel,
        status: "aguardando_humano",
        origem: "valeria",
        observacoes: `[${hoje()}] Transferido para humano: ${body.motivo || "sem motivo informado"}`,
        dataEntrada: hoje(),
      };
      leads.unshift(lead);
    }

    await fsWrite("crm_leads", leads);

    // Registra alerta em coleção separada para o ERP poder exibir notificação
    const db = admin.firestore();
    await db.collection("valeria_alertas").add({
      tipo: "transferir_humano",
      tel: t,
      nome: body.nome || t,
      motivo: body.motivo || "",
      ts: Date.now(),
      data: hoje(),
      lido: false,
    });

    res.json({ ok: true, lead });
  });

// ── 8. proximasAcoes ──────────────────────────────────────────────────────────
/**
 * Agenda próxima ação para um lead (follow-up).
 * POST { tel, acao, data? }
 * Atualiza campo proximaAcao/dataProximaAcao no lead.
 */
export const valeriaProximaAcao = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const body = req.body as { tel?: string; acao?: string; data?: string };
    if (!body.tel || !body.acao) {
      res.status(400).json({ ok: false, error: "tel e acao são obrigatórios" });
      return;
    }

    const leads = (await fsRead<CrmLead[]>("crm_leads")) || [];
    const t = normTel(body.tel);
    const idx = leads.findIndex((l) => normTel(l.tel || "") === t);

    if (idx < 0) {
      res.status(404).json({ ok: false, error: "Lead não encontrado. Use criarOportunidade primeiro." });
      return;
    }

    leads[idx].proximaAcao = body.acao;
    leads[idx].dataProximaAcao = body.data || hoje();

    await fsWrite("crm_leads", leads);
    res.json({ ok: true, lead: leads[idx] });
  });

// ── 9. consultarOS ───────────────────────────────────────────────────────────
/**
 * Consulta OS de um cliente pelo telefone.
 * POST { tel }
 * Retorna as OS encontradas em KB_OS para o cliente.
 */
export const valeriaConsultarOS = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

    const body = req.body as { tel?: string };
    if (!body.tel) { res.status(400).json({ ok: false, error: "tel é obrigatório" }); return; }

    const t = normTel(body.tel);

    // Busca cliente para pegar IDs de OS
    const clientes = await fsRead<Cliente[]>("clientes");
    const cliente = clientes?.find((c) => normTel(c.tel || "") === t);

    if (!cliente) { res.json({ ok: true, cliente: null, os: [] }); return; }

    // Busca OS no KB_OS (operacional) + kb_os_fin (financeiro, separado desde o
    // split P0.6). "valor" só existia em kb_os antes do split; hoje o campo
    // financeiro mora em kb_os_fin e precisa ser mesclado aqui — ver contrato
    // documentado na Rodada 3 (seção 36). Isto não reabre a brecha de
    // privacidade da Produção: valeriaConsultarOS roda com Admin SDK (ignora
    // Rules por natureza) e devolve ao PRÓPRIO CLIENTE apenas o valor do seu
    // próprio pedido — nunca custo/margem/markup internos.
    const kbOs = await fsRead<Record<string, KbOs>>("kb_os");
    const kbOsFin = await fsRead<Record<string, { valor?: number; totalGeral?: number }>>("kb_os_fin");
    const osCliente: KbOs[] = [];

    if (kbOs && cliente.os && Array.isArray(cliente.os)) {
      cliente.os.forEach((osId) => {
        const os = kbOs[String(osId)];
        if (os) osCliente.push(os);
      });
    }

    // Fallback: buscar por nome do cliente nas OS
    if (osCliente.length === 0 && kbOs) {
      const nome = (cliente.nome || "").toLowerCase();
      Object.values(kbOs).forEach((os) => {
        if ((os.cliente || "").toLowerCase().includes(nome)) {
          osCliente.push(os);
        }
      });
    }

    const STATUS_MAP: Record<string, string> = {
      iniciada: "Iniciada",
      producao: "Em Produção",
      aguardando_saldo: "Aguardando Saldo",
      pronta: "Pronta ✅",
      entregue: "Entregue 🎉",
      master: "Aguardando Master",
    };

    const osSummary = osCliente.map((os) => {
      const fin = kbOsFin?.[String(os.id)];
      return {
        id: os.id,
        descricao: os.descricao || os.cliente || "OS sem descrição",
        status: STATUS_MAP[os.status || ""] || os.status || "desconhecido",
        valor: fin?.totalGeral ?? fin?.valor ?? os.valor,
        data: os.data,
      };
    });

    res.json({ ok: true, cliente: { nome: cliente.nome, tel: cliente.tel }, os: osSummary });
  });

// ── 10. statusIntegracao ──────────────────────────────────────────────────────
/**
 * Health-check — verifica se a integração está ativa.
 * GET
 */
export const valeriaStatus = functions
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!await checkAuth(req, res)) return;
    res.json({ ok: true, versao: "1.0.0", projeto: "ERP VR Marcas", timestamp: Date.now() });
  });
