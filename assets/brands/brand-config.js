/**
 * brand-config.js — configuração central de marca (FASE G, 2026-08-06;
 * corrigida na rodada de homologação guiada, mesma data).
 *
 * Fonte única de verdade para nome, cores, logo e textos comerciais de
 * cada marca — usada pela UI, geração de PDF e prévia de WhatsApp, para
 * nunca deixar as três divergirem nem misturar elementos de uma marca com
 * dados de outra.
 *
 * CORREÇÃO desta rodada: a versão anterior deste arquivo marcava CNPJ/
 * endereço/telefone/e-mail como "(PENDENTE)" sem checar se esses dados já
 * existiam no restante do ERP. Eles já existiam — o template real de
 * `orcImprimirOrcamentoPDF()` (index.html, ambos os ramos VR e Vitre) já
 * usa esses valores há mais tempo que esta auditoria de Fase G. Os
 * valores abaixo foram copiados literalmente dali (mesma string, char por
 * char), não reinventados. Logo path também corrigido: apontava para uma
 * cópia redundante em `assets/brands/` (plural, criada nesta auditoria);
 * agora aponta para `assets/brand/` (singular), a pasta já em uso real
 * pelo login, sidebar, favicon e PDF VR — fonte única, sem duplicidade.
 *
 * Pix NÃO é um valor estático — é gerenciado por conta em Config >
 * Bancos (`bankFPixVR`/`bankFPixVT`, populados em tempo real por
 * `orcPopularBancos()`). Por isso não aparece aqui como campo fixo.
 */
'use strict';

var BRAND_CONFIG = {
  vr: {
    codigo: 'vr',
    nome: 'VR Marcas',
    nomeCompleto: 'VR Marcas — acrílicos personalizados',
    logoPath: 'assets/brand/vr-marcas-logo.png',
    iconPath: 'assets/brand/vr-marcas-icon.png',
    // Cores reais extraídas do arquivo oficial "LOGO VR MARCAS.png" —
    // mesmas usadas em orcImprimirOrcamentoPDF() (vrCyan/vrMag/vrGold/vrDark).
    corPrimaria: '#1EB8D8',
    corSecundaria: '#983C8F',
    corAcento: '#FAB427',
    corTexto: '#54565A',
    rodapePdf: 'VR Marcas — acrílicos personalizados',
    remetenteWhatsapp: 'VR Marcas',
    // Dados já existentes no ERP (copiados literalmente do template real do PDF):
    cnpj: '37.855.285/0001-52',
    endereco: 'Rua Francisca da Costa Cunha, nº 39, Qd. 69A Lt. 17, Setor Aeroporto — Goiânia – GO, CEP 74.075-300',
    telefone: '(62) 3941-6787',
    email: 'vrmarcas@hotmail.com',
    site: 'vrmarcas.com',
    social: '@vrmarcas',
    pix: null, // gerenciado em Config > Bancos (erp_bank_config, chave bankFPixVR) — nunca estático aqui
  },
  vitre: {
    codigo: 'vitre',
    nome: 'Vitre',
    nomeCompleto: 'Vitre — produtos em acrílico',
    logoPath: 'assets/brand/vitre-logo.png',
    iconPath: 'assets/brand/vitre-icon.png',
    // Cores reais do template Vitre já existente (vtPrim/vtTeal/vtCream).
    corPrimaria: '#134F57',
    corSecundaria: '#1E7A86',
    corAcento: '#EAF3F3',
    corTexto: '#134F57',
    rodapePdf: 'Vitre — produtos em acrílico',
    remetenteWhatsapp: 'Vitre',
    cnpj: '37.855.285/0001-52', // mesmo CNPJ do template VR real — mesma pessoa jurídica
    endereco: 'Rua Francisca da Costa Cunha, nº 39, Qd. 69A Lt. 17, Setor Aeroporto — Goiânia – GO, CEP 74.075-300',
    telefone: '(62) 3941-6787',
    email: 'vitre@email.com',
    site: 'vitre.com.br',
    social: '@vitre',
    pix: null, // gerenciado em Config > Bancos (erp_bank_config, chave bankFPixVT)
  },
};

function brandConfigGet(codigo) {
  return BRAND_CONFIG[codigo] || BRAND_CONFIG.vr;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BRAND_CONFIG: BRAND_CONFIG, brandConfigGet: brandConfigGet };
}
