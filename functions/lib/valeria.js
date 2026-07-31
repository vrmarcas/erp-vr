"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.valeriaStatus = exports.valeriaConsultarOS = exports.valeriaProximaAcao = exports.valeriaTransferirHumano = exports.valeriaRegistrarMensagem = exports.valeriaCriarOportunidade = exports.valeriaCriarOrcamento = exports.valeriaCatalogo = exports.valeriaUpsertCliente = exports.valeriaGetCliente = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const COL = "erp_vr";
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Lê documento do Firestore e faz parse do JSON interno */
async function fsRead(key) {
    const db = admin.firestore();
    const doc = await db.collection(COL).doc(key).get();
    if (!doc.exists)
        return null;
    const raw = doc.data()?.data;
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Salva dado no Firestore no mesmo formato do ERP */
async function fsWrite(key, data) {
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
async function checkAuth(req, res) {
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
        try {
            secret = JSON.parse(configRaw).secret || "";
        }
        catch { /* */ }
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
function normTel(tel) {
    return (tel || "").replace(/\D/g, "");
}
/** Data atual no formato dd/mm/yyyy */
function hoje() {
    const d = new Date();
    const dia = String(d.getDate()).padStart(2, "0");
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    return `${dia}/${mes}/${d.getFullYear()}`;
}
/** ID único simples (timestamp + random) */
function uid(prefix = "v") {
    return prefix + Date.now() + Math.floor(Math.random() * 9000 + 1000);
}
// ── 1. buscarCliente ──────────────────────────────────────────────────────────
/**
 * Busca cliente por telefone (ou nome) em CLIENTES_DATA.
 * POST { tel?, nome? }
 * Retorna o cliente encontrado ou null.
 */
exports.valeriaGetCliente = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const { tel, nome } = req.body;
    if (!tel && !nome) {
        res.status(400).json({ ok: false, error: "Informe tel ou nome" });
        return;
    }
    const clientes = await fsRead("clientes");
    if (!clientes) {
        res.json({ ok: true, cliente: null });
        return;
    }
    let found;
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
exports.valeriaUpsertCliente = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const body = req.body;
    if (!body.tel || !body.nome) {
        res.status(400).json({ ok: false, error: "tel e nome são obrigatórios" });
        return;
    }
    const clientes = (await fsRead("clientes")) || [];
    const t = normTel(body.tel);
    const idx = clientes.findIndex((c) => normTel(c.tel || "") === t);
    let cliente;
    let acao;
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
    }
    else {
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
exports.valeriaCatalogo = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    // Tenta ler produtos do Firestore (chave "produtos")
    const produtos = await fsRead("produtos");
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
exports.valeriaCriarOrcamento = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const body = req.body;
    if (!body.nomeCliente || !body.telCliente) {
        res.status(400).json({ ok: false, error: "nomeCliente e telCliente são obrigatórios" });
        return;
    }
    const orcamentos = (await fsRead("orcamentos")) || [];
    // Gera número sequencial
    const maxN = orcamentos.reduce((m, o) => {
        const n = parseInt(String(o.n || 0));
        return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const novoN = maxN + 1;
    const orc = {
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
exports.valeriaCriarOportunidade = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const body = req.body;
    if (!body.nome || !body.tel) {
        res.status(400).json({ ok: false, error: "nome e tel são obrigatórios" });
        return;
    }
    const leads = (await fsRead("crm_leads")) || [];
    const t = normTel(body.tel);
    const idx = leads.findIndex((l) => normTel(l.tel || "") === t);
    let lead;
    let acao;
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
    }
    else {
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
exports.valeriaRegistrarMensagem = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const body = req.body;
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
exports.valeriaTransferirHumano = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const body = req.body;
    if (!body.tel) {
        res.status(400).json({ ok: false, error: "tel é obrigatório" });
        return;
    }
    const leads = (await fsRead("crm_leads")) || [];
    const t = normTel(body.tel);
    const idx = leads.findIndex((l) => normTel(l.tel || "") === t);
    let lead;
    if (idx >= 0) {
        leads[idx].status = "aguardando_humano";
        leads[idx].observacoes = [
            leads[idx].observacoes || "",
            `[${hoje()}] Transferido para humano: ${body.motivo || "sem motivo informado"}`,
        ].filter(Boolean).join("\n");
        lead = leads[idx];
    }
    else {
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
exports.valeriaProximaAcao = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const body = req.body;
    if (!body.tel || !body.acao) {
        res.status(400).json({ ok: false, error: "tel e acao são obrigatórios" });
        return;
    }
    const leads = (await fsRead("crm_leads")) || [];
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
exports.valeriaConsultarOS = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Método não permitido" });
        return;
    }
    const body = req.body;
    if (!body.tel) {
        res.status(400).json({ ok: false, error: "tel é obrigatório" });
        return;
    }
    const t = normTel(body.tel);
    // Busca cliente para pegar IDs de OS
    const clientes = await fsRead("clientes");
    const cliente = clientes?.find((c) => normTel(c.tel || "") === t);
    if (!cliente) {
        res.json({ ok: true, cliente: null, os: [] });
        return;
    }
    // Busca OS no KB_OS
    const kbOs = await fsRead("kb_os");
    const osCliente = [];
    if (kbOs && cliente.os && Array.isArray(cliente.os)) {
        cliente.os.forEach((osId) => {
            const os = kbOs[String(osId)];
            if (os)
                osCliente.push(os);
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
    const STATUS_MAP = {
        iniciada: "Iniciada",
        producao: "Em Produção",
        aguardando_saldo: "Aguardando Saldo",
        pronta: "Pronta ✅",
        entregue: "Entregue 🎉",
        master: "Aguardando Master",
    };
    const osSummary = osCliente.map((os) => ({
        id: os.id,
        descricao: os.descricao || os.cliente || "OS sem descrição",
        status: STATUS_MAP[os.status || ""] || os.status || "desconhecido",
        valor: os.valor,
        data: os.data,
    }));
    res.json({ ok: true, cliente: { nome: cliente.nome, tel: cliente.tel }, os: osSummary });
});
// ── 10. statusIntegracao ──────────────────────────────────────────────────────
/**
 * Health-check — verifica se a integração está ativa.
 * GET
 */
exports.valeriaStatus = functions
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (!await checkAuth(req, res))
        return;
    res.json({ ok: true, versao: "1.0.0", projeto: "ERP VR Marcas", timestamp: Date.now() });
});
//# sourceMappingURL=valeria.js.map