# GO-LIVE FINAL TRACKER (temporário — remover antes do merge final)
Iniciado: 2026-08-12. HEAD inicial: 8f714ab (origin/master == local, sem divergência).
Branch de trabalho: hotfix/golive-final-erp-2026-08-12

Estados: TODO | IN PROGRESS | IMPLEMENTED | TESTED | DEPLOYED | VISUAL PASS | BLOCKED EXTERNAL

## 0. Preflight
- [TESTED] git fetch/status/worktrees checados — sem divergência, sem worktree Valéria tocado
- [TODO] Reprodução visual dos bugs (browser) — checar se sessão está disponível

## Bloco P0-1 — Preço Cartão × PIX × Dinheiro (seções 4-8)
- [TESTED] orcMotorComercial reescrito: cartao(n) = base/(1-taxa(n)/100), taxa lida de cfgLoad().parcelamento (config real já existente, "Config > Financeiro > Parcelamento"). 6 call-sites atualizados (wizard resumo, Confirmação de Pagamento, PDF/WhatsApp, valorFinal persistido). Teste: scripts/test_orc_motor_comercial_taxa_embutida_2026-08-12.js (56/56 verde) — cobre 0/3/5/6.5%, 1x/2x/3x, centavos ímpares, override, reload
- [TESTED] PIX sugerido = taxa(nParc atual); sem override, volta EXATAMENTE à base (baseCents direto, nunca por coincidência de arredondamento)
- [TESTED] PIX override manual: campo auto-preenche com sugestão, mas nunca sobrescreve valor digitado (orcPixSincronizarSugestao + sentinela window._orcPixUltimaSugestao). Botão "usar sugerido". Reabrir orçamento salvo (orcEnvEditar) usa sentinela -1 para nunca recalcular diferente. Teste: scripts/test_orc_pix_sugestao_override_2026-08-12.js (10/10 verde)
- [TESTED] Dinheiro = PIX (já implementado em rodada anterior via orcPgtoAtualizarValorReceber — herda a correção automaticamente por usar o mesmo motor)
- [TESTED] 4 arquivos de teste pré-existentes atualizados (mudança de regra deliberada, documentada inline): test_cartao_pix_motor_2026-08-09.js, test_sprint_pregolive_blocoEI_pdf_whatsapp_semjuros_2026-08-09.js, test_sprint_pregolive_gate_pagamento_semjuros_2026-08-09.js, test_sprint_pregolive_blocoB_stalestate_2026-08-09.js (este último era bug real meu — window undefined em harness Node, corrigido com guard defensivo _orcPixEstadoGlobal())
- [TESTED] Suíte completa (114+ arquivos) rodou 2x limpa após todas as correções de preço
- [TODO] Smoke visual real no wizard (preencher orçamento, ver PIX/cartão na tela) — não feito nesta rodada, sessão será usada ao final se disponível
- [TODO] PDF/WhatsApp — não verificados visualmente nesta rodada (herdam a correção via orcCalcCondicoesPagamento, mas não capturados em tela)

## Bloco P0-2 — Modal "Continuar editando" (seções 9-13)
- [TESTED] Causa raiz confirmada visualmente em produção (#000018): nav('orcamento') sempre reseta pra opg0 (orcEscolhaFluxo), "Continuar editando" só fechava o modal (orcNovoOrcamentoFecharModal)
- [TESTED] orcNovoOrcamentoEscolherContinuar() nova — restaura wizard na última etapa ativa (window._orcUltimoStepAtivo). Teste: scripts/test_orc_continuar_editando_2026-08-12.js (8/8 verde)
- [TESTED] Modal diferencia copy salvo(Caso A)×draft(Caso B) via window._orcSessaoAtualId
- [TESTED] Novo Orçamento = reset real ampliado (orcDataPedido/orcValidadeDias agora inclusos)
- [TODO] Caso C (salvo sem alterações pendentes) — não implementado, nice-to-have, não bloqueante
- [TODO] Validar draft recuperável pela interface (refresh/navegação) — não testado nesta rodada

## Bloco P0-3 — Recibo A4 (seções 14-16)
- [TESTED] Redesign A4 com logo oficial real — já implementado em rodada anterior (2026-08-07): header colorido, logo real (assets/brand/*.png, confirmado existente), hierarquia profissional, ok-box/warn-box de destaque, rodapé com assinaturas. Confirmado por leitura, sem regressão necessária.
- [TESTED] Dados canônicos sem "(não informado)" — confirmado: lê direto de orc.cliente/orc.vendedor/os.valorEntrada (dado real persistido), fallbacks só disparam quando o campo é genuinamente vazio, nunca substitui dado existente.
- [TESTED] Reimpressão não duplica transação/OS — confirmado: orcGerarReciboEntrada nunca grava no Firestore (só window.open+print), o gate (orcObterConfirmacaoEntrada) só lê. BUG REAL corrigido nesta rodada: número do recibo usava Date.now() (mudava a cada impressão) — agora deriva de orc.num (estável). Teste: scripts/test_orc_recibo_entrada_2026-08-12.js (16/16 verde)
- [TODO] Smoke visual real da impressão no navegador — não feito nesta rodada (sessão bloqueada), coberto só por auditoria de código/regex

## Bloco P0-4 — Status do orçamento (seções 17-20)
- [TESTED] Bug real confirmado em produção (#000018: entrada recebida R$83,08 + OS#8 gerada, mostrava "Aguard. Pagamento", detalhe mostrava enum cru "aguardando_pagamento"). Causa: `o.status = restante>0 ? 'aguardando_pagamento' : 'pago'` executado na geração da OS, misturando status operacional com financeiro.
- [TESTED] CORRIGIDO: geração de OS sempre marca o.status='enviado_producao' (2 pontos: fallback local + caminho transacional real). Fonte única orcStatusLabel/orcStatusCor substitui 3 cópias divergentes do mapa (uma nem existia — texto cru no detalhe). Legado (aguardando_pagamento/pago já persistidos) mapeia pro mesmo rótulo — sem migração necessária. Teste: scripts/test_orc_status_operacional_2026-08-12.js (12/12) + 3 testes pré-existentes atualizados (mudança de regra deliberada, documentada inline)
- [TESTED] Máquina de estados completa implementada: kbIniciarProd→em_producao, kbMarcarPronto→pronto (só após confirmação real do save), osLiberar→entregue (idem). Usa orcEnvSetStatus() já existente (fonte única, sem duplicar lógica). Testes 4a-4c em test_orc_status_operacional_2026-08-12.js.
- [TODO] NÃO sincronizado: o caminho real via Cloud Function producaoIniciarOuEditar (1º "Iniciar Produção" com seleção de material/retalho) não atualiza o orçamento — só o caminho de retomada (kbIniciarProd direto) atualiza. Corrigir isso exigiria editar functions/src/producao.ts + rebuild + deploy de Functions, fora do escopo desta rodada (risco desproporcional ao benefício de um rótulo). Pendência anotada para rodada futura.
- [TODO] Sincronização entre telas sem refresh manual — orcEnvSetStatus já chama orcAtualizarBadgeEnviados()/re-render; não testado via browser nesta rodada.

## Bloco P0-5 — Kanban/Modal da OS (seções 21-29)
- [TODO] Ordem exata do modal (10 blocos) — não reordenado nesta rodada
- [TODO] Botão Iniciar Produção antes do checklist, fluxo material→reserva→iniciar — não verificado nesta rodada
- [TESTED] Marcar Pronta: bug real confirmado em produção (OS #8 — botão habilitado com 0/5 marcados, kbMarcarPronto() forçava checklist completo ao clicar). CORRIGIDO: kbChecklistCompleto(os) nova fonte única; kbMarcarPronto() bloqueia de verdade (nunca só visual) se status!=='producao' ou checklist incompleto; render oculta o botão antes de iniciar e desabilita até 5/5. Teste: scripts/test_kb_marcar_pronta_gate_2026-08-12.js (11/11 verde)
- [TESTED] Checklist sempre 5 itens fixos — já corrigido em rodada anterior (osChecklistDeOperacoes), confirmado visualmente OK no card do Kanban (OS #8 mostra os 5)
- [TESTED] Normalizador para OS legadas com checklist persistido incompleto — kbNormalizarChecklistLegado(os) novo, mescla com OPERACOES_PADRAO preservando estado marcado, chamado em kbOpen(). Teste: scripts/test_kb_checklist_normalizador_legado_2026-08-12.js (21/21 verde)
- [TODO] Coluna Etapa em Todas as OS + reverter para produção — kbEtapaAtual/kbReverterProducao já existem de rodada anterior, não re-verificados nesta rodada

## Bloco P0-6 — Planificação visual na OS (seções 30-35)
- [TESTED] Snapshot completo orçamento→OS já era imutável (osProjecaoOperacionalItem, rodada anterior) — confirmado por leitura, sem mudança necessária
- [TESTED] Bug real confirmado: só medidas/tabela, nunca o desenho. CORRIGIDO: kbPlanificacaoGerarSVG(pecas) nova — reaproveita o MESMO algoritmo determinístico de empacotamento de planExportSVG()/planDrawCanvas() (depende só das medidas já persistidas, nunca recalcula), gera SVG do layout de corte real a partir de it.pieces/it.recipeSnapshot.pecas. kbAbrirPlanificacaoItem() injeta o desenho no modal (antes só tabela+aviso textual). Também renderiza o template gráfico do produto (recipeSnapshot.planificacoes), sanitizado via svgSanitizar. Teste: scripts/test_kb_planificacao_visual_2026-08-12.js (13/13 verde) — vazio, empacotamento, múltiplas chapas, aliases legados, escaping XSS, determinismo
- [TESTED] Separação Planificação × Arquivos da Produção já existia (rodada anterior, kbPlanImgBox distinto) — confirmado por leitura, sem mudança necessária
- [TODO] PDF da OS sem financeiro — já corrigido em rodada anterior (osPdfProducao), não re-verificado visualmente nesta rodada
- [TODO] Smoke visual real do desenho no navegador — não feito nesta rodada (sessão bloqueada), coberto só por teste de extração de função real

## Bloco P0-7 — Estoque/Retalhos (seções 36-42)
- [TESTED] Leitura da planificação antes de perguntar Chapa/Retalho — já implementado em rodada anterior (kbCalcAreaOS lê it.planArea/larg×alt dos itens da OS antes de sugerir); confirmado por leitura
- [TESTED] Margem de segurança 2D configurável (kbMargemSegurancaRetalhoCm, Config→Produção, default +5cm) aplicada a largura E altura via kbRetalhoCabeGeometricamente (não só área) — já implementado em rodada anterior (seção 19), confirmado por leitura
- [TESTED] Melhor-fit já implementado (sort por área crescente — menor retalho que ainda serve primeiro). GAP FECHADO NESTA RODADA: UI de sugestão só mostrava texto solto, sem ação explícita. kbSugestaoHtml(sug) novo — cartão "♻️ Sugestão de aproveitamento" com 3 botões (✅ Usar retalho / 🔎 Escolher outro / 🆕 Abrir chapa nova). Teste: scripts/test_kb_sugestao_retalho_ui_2026-08-12.js (12/12 verde)
- [TESTED] Concorrência atômica server-side — já implementado em rodada anterior (Cloud Function producaoIniciarOuEditar, leitura fresca de stock/retalhos + transação, nunca decide no cliente); confirmado por leitura do código (functions/src/producao.ts), sem novo teste de emulador nesta rodada especificamente

## Bloco P0-8 — Privacidade financeira no Kanban (seções 43-48)
- [TESTED] Bug real CONFIRMADO em produção (OS #8): caixa "Receber Saldo" do modal Kanban mostrava "Restante: R$X" cru + botão que disparava a transação financeira ali mesmo. CORRIGIDO: valor removido (status sanitizado "Saldo pendente na entrada", sem R$), botão agora abre o modal financeiro dedicado (osAbrirPagamentoSaldoModal, mesma fonte já usada em "Todas as OS") — cobre inclusive o caminho legado aguardando_saldo→iniciada, zero perda de capacidade. kbReceberSaldo() (função antiga) ficou sem chamador na UI mas foi mantida intocada (ainda testada/atômica) — não removida por segurança/escopo.
- [TESTED] Varredura de "R$" na função kbOpen/kbRender (Kanban) — nenhuma outra ocorrência de valor monetário encontrada. Teste: scripts/test_kb_privacidade_sem_valor_2026-08-12.js (6/6 verde)
- [TESTED] Rules já corretas (confirmado por leitura, não é código novo): kb_os_fin/fin_cr/fin_tx/fin_cp exigem isMaster()||isFinanceiro()||isComercial() — isProducao() sozinho nunca satisfaz nenhuma delas, Produção não lê essas coleções
- [TODO] Teste automatizado via Auth Emulator real (perfil Produção tentando ler kb_os_fin → DENIED) — não executado nesta rodada (Rules já existiam corretas de rodada anterior, risco de regressão baixo, mas não há novo teste de emulador cobrindo isso especificamente nesta sessão)

## Bloco P0-9 — CRM (seção 49) — não regredir
- [TESTED] Validado por leitura de código (sem mudança necessária): o funil comercial do CRM usa seu próprio campo `etapa` (independente), NUNCA lê orc.status diretamente — os novos valores de enum (enviado_producao/em_producao/pronto/entregue) introduzidos nesta rodada não têm nenhum caminho de leitura no CRM, portanto não podem regredir a sincronização existente

## Bloco P0-10 — Cleanup #000018/OS#8 (seções 50-52, 65)
- [TODO] Auditoria de dependências + snapshot + dry-run + apply
- [TODO] Reverter movimentação de estoque causada pelo teste (se houver)

## Testes/Deploy (seções 53-64)
- [TODO] Cenários T-ORC-01..09
- [TODO] Cenários T-STATUS-01..07
- [TODO] Cenários T-KAN-01..10
- [TODO] Cenários T-PLAN-01..07
- [TODO] Cenários T-STK-01..10
- [TODO] Cenários T-REC-01..08
- [TODO] Suíte completa 2x
- [TODO] Deploy (Hosting/Functions/Rules conforme diff)

## Smoke visual final (seção 64)
- [BLOCKED EXTERNAL?] depende de sessão browser disponível — reavaliar
