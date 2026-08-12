# GO-LIVE FINAL TRACKER (temporário — remover antes do merge final)
Iniciado: 2026-08-12. HEAD inicial: 8f714ab (origin/master == local, sem divergência).
Branch de trabalho: hotfix/golive-final-erp-2026-08-12

Estados: TODO | IN PROGRESS | IMPLEMENTED | TESTED | DEPLOYED | VISUAL PASS | BLOCKED EXTERNAL

## 0. Preflight
- [TESTED] git fetch/status/worktrees checados — sem divergência, sem worktree Valéria tocado
- [TODO] Reprodução visual dos bugs (browser) — checar se sessão está disponível

## Bloco P0-1 — Preço Cartão × PIX × Dinheiro (seções 4-8)
- [TODO] orcMotorComercial: embutir taxa real da maquininha no preço cartão (hoje NÃO embute — Bloco E anterior deixou cartão = base sem taxa)
- [TODO] PIX sugerido = cálculo inverso (1 - base/cartão)*100, volta exatamente à base em centavos
- [TODO] PIX editável com override manual preservado + flag
- [TODO] Dinheiro = mesmo valor efetivo do PIX
- [TODO] Testes cent-safe (0/3/5/6.5%, 1x/2x/3x, override, reload)

## Bloco P0-2 — Modal "Continuar editando" (seções 9-13)
- [TESTED] Causa raiz confirmada visualmente em produção (#000018): nav('orcamento') sempre reseta pra opg0 (orcEscolhaFluxo), "Continuar editando" só fechava o modal (orcNovoOrcamentoFecharModal)
- [TESTED] orcNovoOrcamentoEscolherContinuar() nova — restaura wizard na última etapa ativa (window._orcUltimoStepAtivo). Teste: scripts/test_orc_continuar_editando_2026-08-12.js (8/8 verde)
- [TESTED] Modal diferencia copy salvo(Caso A)×draft(Caso B) via window._orcSessaoAtualId
- [TESTED] Novo Orçamento = reset real ampliado (orcDataPedido/orcValidadeDias agora inclusos)
- [TODO] Caso C (salvo sem alterações pendentes) — não implementado, nice-to-have, não bloqueante
- [TODO] Validar draft recuperável pela interface (refresh/navegação) — não testado nesta rodada

## Bloco P0-3 — Recibo A4 (seções 14-16)
- [TODO] Redesign A4 com logo oficial real
- [TODO] Dados canônicos sem "(não informado)" por erro de reidratação
- [TODO] Reimpressão não duplica transação/OS

## Bloco P0-4 — Status do orçamento (seções 17-20)
- [TODO] Separar status operacional × financeiro
- [TODO] Máquina de estados operacional (Aguard.Cliente → ... → Entregue)
- [TODO] Nunca "Aguardando Pagamento" com OS já gerada
- [TODO] Sincronização entre telas sem refresh manual

## Bloco P0-5 — Kanban/Modal da OS (seções 21-29)
- [TODO] Ordem exata do modal (10 blocos) — não reordenado nesta rodada
- [TODO] Botão Iniciar Produção antes do checklist, fluxo material→reserva→iniciar — não verificado nesta rodada
- [TESTED] Marcar Pronta: bug real confirmado em produção (OS #8 — botão habilitado com 0/5 marcados, kbMarcarPronto() forçava checklist completo ao clicar). CORRIGIDO: kbChecklistCompleto(os) nova fonte única; kbMarcarPronto() bloqueia de verdade (nunca só visual) se status!=='producao' ou checklist incompleto; render oculta o botão antes de iniciar e desabilita até 5/5. Teste: scripts/test_kb_marcar_pronta_gate_2026-08-12.js (11/11 verde)
- [TODO] Checklist sempre 5 itens fixos — já corrigido em rodada anterior (osChecklistDeOperacoes), confirmado visualmente OK no card do Kanban (OS #8 mostra os 5)
- [TODO] Normalizador para OS legadas com checklist persistido incompleto — não implementado nesta rodada
- [TODO] Coluna Etapa em Todas as OS + reverter para produção — kbEtapaAtual/kbReverterProducao já existem de rodada anterior, não re-verificados nesta rodada

## Bloco P0-6 — Planificação visual na OS (seções 30-35)
- [TODO] Snapshot completo orçamento→OS (imutável)
- [TODO] Preview visual renderizado (SVG/Canvas/imagem/PDF), não só medidas
- [TODO] Separação Planificação × Arquivos da Produção
- [TODO] PDF da OS sem financeiro

## Bloco P0-7 — Estoque/Retalhos (seções 36-42)
- [TODO] Leitura da planificação antes de perguntar Chapa/Retalho
- [TODO] Margem de segurança 2D (não só área)
- [TODO] Melhor-fit + UI de sugestão
- [TODO] Concorrência atômica server-side (parece já implementado — validar)

## Bloco P0-8 — Privacidade financeira no Kanban (seções 43-48)
- [TODO] Remover TODO valor monetário do Kanban/modal operacional da OS
- [TODO] Confirmar Recebimento de Saldo não pertence ao Kanban
- [TODO] Enum sanitizado financeiroStatusPublico (sem copiar dinheiro pra kb_os)
- [TODO] Testes de Rules: Produção não lê kb_os_fin/FIN_CR/FIN_TX

## Bloco P0-9 — CRM (seção 49) — não regredir
- [TODO] Validar sincronização com nova máquina de status

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
