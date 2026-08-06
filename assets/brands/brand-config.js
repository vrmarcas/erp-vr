/**
 * brand-config.js — configuração central de marca (FASE G, 2026-08-06).
 *
 * Fonte única de verdade para nome, cores, logo e textos comerciais de
 * cada marca — usada pela UI, geração de PDF e prévia de WhatsApp, para
 * nunca deixar as três divergirem nem misturar elementos de uma marca com
 * dados de outra.
 *
 * Dados de contato/pagamento/fiscais REAIS (CNPJ, endereço, Pix, etc.)
 * NÃO foram fornecidos nesta rodada — os campos abaixo usam placeholders
 * claramente marcados com "(PENDENTE — não usar em produção)". Nenhum
 * PDF ou preview desta rodada usa esses campos além de exibi-los
 * marcados como pendência; nenhum envio real é feito por este ERP em
 * nenhuma rodada desta auditoria.
 */
'use strict';

var BRAND_CONFIG = {
  vr: {
    codigo: 'vr',
    nome: 'VR Marcas',
    nomeCompleto: 'VR Marcas — acrílicos personalizados',
    logoPath: 'assets/brands/vr/logo.png',
    corPrimaria: '#1EB8D8',
    corSecundaria: '#7C3AED',
    corTexto: '#3F3F46',
    rodapePdf: 'VR Marcas — acrílicos personalizados',
    remetenteWhatsapp: 'VR Marcas',
    // Pendências explícitas — não inventadas, não usadas para envio real:
    cnpj: '(PENDENTE — não usar em produção)',
    endereco: '(PENDENTE — não usar em produção)',
    telefone: '(PENDENTE — não usar em produção)',
    email: '(PENDENTE — não usar em produção)',
    pix: '(PENDENTE — não usar em produção)',
  },
  vitre: {
    codigo: 'vitre',
    nome: 'Vitre',
    nomeCompleto: 'Vitre — produtos em acrílico',
    logoPath: 'assets/brands/vitre/logo.png',
    corPrimaria: '#1E7A86',
    corSecundaria: '#134E4A',
    corTexto: '#134E4A',
    rodapePdf: 'Vitre — produtos em acrílico',
    remetenteWhatsapp: 'Vitre',
    cnpj: '(PENDENTE — não usar em produção)',
    endereco: '(PENDENTE — não usar em produção)',
    telefone: '(PENDENTE — não usar em produção)',
    email: '(PENDENTE — não usar em produção)',
    pix: '(PENDENTE — não usar em produção)',
  },
};

function brandConfigGet(codigo) {
  return BRAND_CONFIG[codigo] || BRAND_CONFIG.vr;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BRAND_CONFIG: BRAND_CONFIG, brandConfigGet: brandConfigGet };
}
