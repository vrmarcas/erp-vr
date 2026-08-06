# Parte 3 — Auditoria de Identidade Visual Real

## Achado principal (corrigido nesta rodada)

A rodada anterior criou `assets/brands/` (plural) com cópias novas dos
arquivos de `Id visual - VR e Vitre/`, e apontou `brand-config.js` para lá,
marcando CNPJ/endereço/telefone/e-mail como `"(PENDENTE)"`.

**Isso estava errado em dois pontos, corrigidos agora:**

1. **Já existia** uma pasta `assets/brand/` (singular) com os assets oficiais
   corretamente recortados/dimensionados, **já em uso real** pelo login,
   sidebar, favicon e pelo PDF do fluxo Personalizado VR
   (`orcImprimirOrcamentoPDF`, ambos os ramos VR e Vitre) — de uma rodada
   anterior a esta auditoria de Fase G. `assets/brands/` era uma cópia
   redundante e desconectada. **Removida** (`assets/brands/vr/logo.png`,
   `assets/brands/vitre/logo.png` — nunca referenciados por mais nada além
   do próprio `brand-config.js`).
2. **CNPJ/endereço/telefone já existiam no código**, hardcoded no template
   real do PDF VR desde antes desta auditoria — não eram "pendência", eram
   dado real não verificado por mim na rodada passada. Copiados literalmente
   (mesma string) para `brand-config.js`.
3. **`vitreOrcGerarPDF()` (Fase G, orçamento de catálogo) nunca renderizava
   uma imagem de logo — só o nome da marca como texto** (`<h1>Vitre</h1>`).
   Corrigido: agora usa `<img src=".../assets/brand/vitre-logo.png">`, real,
   testado (200, `image/png`), visualmente conferido (ver captura abaixo).

## Inventário real de `Id visual - VR e Vitre/`

| Arquivo | Dimensões | O que é |
|---|---|---|
| `LOGO VR MARCAS.png` | 8001×4500 | Logo completo (símbolo + "VR Marcas / acrílicos personalizados") — fonte de `assets/brand/vr-marcas-logo.png` |
| `LOGO VR MARCAS-10.png` | 8001×4500 | Mesmo símbolo, sem o texto — variante ícone-apenas |
| `logo VITRE.png` | 762×246 | Wordmark "vitre" estilizado, verde-petróleo — fonte de `assets/brand/vitre-logo.png` |
| `V - Azul.png` | 661×711 | Símbolo "V" isolado, monocromático azul-petróleo — variante não usada atualmente em nenhuma tela |

## VR MARCAS

- **Arquivo real usado:** `assets/brand/vr-marcas-logo.png` (480×270,
  derivado de `LOGO VR MARCAS.png`) + `assets/brand/vr-marcas-icon.png`
  (512×512, favicon/sidebar/apple-touch-icon).
- **Formato:** PNG, fundo transparente.
- **Variante:** logo completo (símbolo colorido + texto) no PDF/login;
  símbolo isolado colorido no favicon/sidebar.
- **Cores reais** (extraídas do arquivo oficial, comentário já existente no
  código): `#1EB8D8` (ciano), `#983C8F` (magenta), `#FAB427` (dourado),
  `#54565A` (cinza-texto).
- **Aplicação no PDF:** `<img>` real, 52px de altura, cabeçalho do
  orçamento — **verificado nesta rodada** (imagem carrega, HTTP 200).
- **Aplicação no orçamento (tela):** `assets/brand/vr-marcas-logo.png` na
  tela de login (`index.html:1944`) e `vr-marcas-icon.png` na sidebar —
  **capturado ao vivo** (ver screenshot da tela de login, idêntico ao
  arquivo oficial).
- **Aplicação no WhatsApp:** WhatsApp não renderiza imagem própria do ERP
  (é texto de mensagem) — nome da marca (`VR Marcas`) e responsável
  aparecem em negrito, sem mistura com Vitre.

## VITRE

- **Arquivo real usado:** `assets/brand/vitre-logo.png` (360×116, derivado
  de `logo VITRE.png`) + `assets/brand/vitre-icon.png` (512×512).
- **Formato:** PNG, fundo transparente.
- **Variante:** wordmark único (sem símbolo separado além do "V" da
  palavra em si).
- **Cores reais:** `#134F57` (verde-petróleo principal), `#1E7A86`
  (verde-petróleo claro), `#EAF3F3` (fundo claro).
- **Aplicação no PDF:** dois pontos — (a) ramo Vitre de
  `orcImprimirOrcamentoPDF` (fluxo VR com marca=Vitre selecionada, já
  existente), (b) `vitreOrcGerarPDF` (fluxo de Catálogo Vitre, **corrigido
  nesta rodada** para usar `<img>` real em vez de texto). Ambos agora
  carregam o mesmo arquivo real — **capturado ao vivo nesta rodada** (ver
  screenshot abaixo).
- **Aplicação no orçamento (tela):** botão de troca de marca (🌸 Vitre) na
  UI usa emoji, não logo — comportamento pré-existente, fora do escopo
  desta correção (é um seletor de filtro do Dashboard, não uma peça de
  identidade de marca aplicada a documento).
- **Aplicação no WhatsApp:** mesma lógica — texto `*Vitre*` em negrito,
  nunca mistura com dados VR.

## Captura real — PDF Vitre (Catálogo), pós-correção

Renderizado ao vivo no Emulator (cliente "Cliente Teste Logo", 1x Aparador
Ancona, SKU AA001, R$ 1.290,00), confirmado visualmente:
- ✅ Logo "vitre" real, verde-petróleo, proporção correta, boa resolução (PNG nativo, sem esticar)
- ✅ Sem mistura com cores/logo VR
- ✅ Cabeçalho com número do orçamento, data, validade
- ✅ Rodapé com telefone/@vitre/site/e-mail reais + CNPJ real + endereço real
- ✅ "ESTE ORÇAMENTO NÃO TEM VALOR FISCAL" presente
- ✅ Nenhum custo/margem exposto
- ✅ Nenhum dado inventado — todo valor vem de `brand-config.js`, agora com dados reais já existentes no ERP, não placeholders

## Pendências reais (não bloqueiam homologação, mas ficam registradas)

- `V - Azul.png` (variante monocromática do símbolo VR) não está mapeada
  para nenhum uso atual — disponível em `assets/brands/vr/simbolo-v-azul.png`
  para uma futura necessidade (ex.: modo escuro), mas não é usada hoje.
- O PDF VR completo (`orcImprimirOrcamentoPDF`, fluxo Personalizado) não foi
  re-renderizado nesta rodada especificamente — é código **zero alterado**
  nesta auditoria de Fase G, usa o mesmo asset real já verificado (HTTP 200
  confirmado nesta rodada), e já foi capturado com Chromium real em rodada
  anterior desta mesma auditoria ("Rodada E.1 — 13 cenários de PDF com
  Chromium real"). Não repetido aqui para não gastar o orçamento desta
  rodada recapturando algo já provado e intocado — mas o asset por trás
  dele foi re-verificado (200/image-png) nesta rodada.
