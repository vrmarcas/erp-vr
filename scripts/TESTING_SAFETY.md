# Regras de segurança para `scripts/`

Origem: incidente real de 2026-09-23 — um sweep genérico com timeout
agressivo (`perl -e 'alarm(6)'`) sobre `scripts/test_*.js` matou
`test_http_fase_e2_string_parsing_2026-09-20.js` no meio da execução,
depois de ele ligar `erp_vr/erp_config.valeriaV2Enabled=true` em produção
mas antes do próprio fail-safe (`try/finally` em JS) religar para
`false`. `SIGALRM` mata o processo Node a nível de sistema operacional —
isso nunca passa por `try/catch/finally`. A flag ficou presa em `true`
por ~41 minutos, em produção real, até ser encontrada e revertida
manualmente.

Estas regras existem para que isso não se repita.

## Regras

1. **Nunca rodar `scripts/test_*.js` (ou qualquer script de `scripts/`)
   cegamente contra produção.** Muitos desses scripts usam
   `_prod_admin_credential.js` e escrevem Firestore/chamam APIs reais —
   não são testes unitários isolados.

2. **Antes de rodar qualquer coisa em lote, excluir todo arquivo marcado
   com a linha exata `// PROD_MUTATING_TEST`** (comentário de linha,
   primeira linha do arquivo — não vale menção dentro de um JSDoc ou
   comentário explicativo, só a linha exata conta):
   ```bash
   # Detecção oficial — só a linha exata, nunca uma menção solta no texto:
   grep -l '^// PROD_MUTATING_TEST$' scripts/*.js

   # Para um sweep: rodar só os SEM o marcador —
   comm -23 <(ls scripts/test_*.js | sort) <(grep -l '^// PROD_MUTATING_TEST$' scripts/*.js | sort)
   ```
   Um `grep -l PROD_MUTATING_TEST` sem o anchoring (`^...$`) encontra
   falso-positivo — por exemplo `scripts/_prod_mutation_guard.js`, que só
   *menciona* o conceito na própria documentação, mas não é, ele mesmo,
   um script mutante. Use sempre a forma com `^// PROD_MUTATING_TEST$`.

3. **Scripts marcados `PROD_MUTATING_TEST` exigem
   `ALLOW_PROD_MUTATION=1`** no ambiente para sequer começar (ver
   `scripts/_prod_mutation_guard.js::requireAllowProdMutation`). Sem essa
   variável, abortam antes de qualquer escrita ou chamada com efeito.
   Essa é a única proteção que de fato elimina o risco — nunca confiar só
   nas camadas abaixo.

4. **Scripts que dependem de infraestrutura externa (emulador Firestore,
   rede real, Cloud Functions deployadas) precisam de timeout
   individual, nunca um timeout genérico compartilhado por centenas de
   scripts diferentes.** Scripts sem essa infra disponível tipicamente
   falham rápido (`ECONNREFUSED`) ou ficam presos em retry/backoff — um
   timeout curto e uniforme não distingue os dois casos.

5. **Nunca usar timeout agressivo em scripts que fazem cleanup temporário
   (ligam uma flag/estado real, testam, e restauram no final).** Um kill
   externo (SIGALRM/SIGTERM/SIGKILL) pode interromper o script exatamente
   entre o "ligar" e o "restaurar" — e nenhum `try/finally` em JS
   sobrevive a um sinal de nível de SO. Ver
   `scripts/_prod_mutation_guard.js::installEmergencyRestoreOnSignal`
   para os handlers de melhor esforço que esses scripts já têm — mas
   best-effort não é garantia; a defesa real é a regra 3.

6. **Nunca interpretar timeout como PASS.** Um script que não terminou
   dentro do tempo não passou nem falhou — está desconhecido. Reportar
   como tal (`TIMEOUT`), nunca inferir sucesso da ausência de erro.

## Scripts hoje marcados `PROD_MUTATING_TEST`

- `test_http_fase_e1_2026-09-20.js`
- `test_http_fase_e1_2_2026-09-20.js`
- `test_http_fase_e2_string_parsing_2026-09-20.js`
- `fase_m_medicao_set_ai_enabled_latency_2026-09-20.js`
- `_live_verify_rodada_cirurgica_2026-08-16.js`
- `_smoke_handoff_automatico_2026-08-23.js`

Scripts de limpeza/cleanup (`cleanup_orc*`, `limpeza_homologacao_*`,
`reset_operacional_*`, `fix_precos_*`) já têm sua própria proteção
equivalente: exigem um argumento explícito (`--apply` ou `apply`/
`dry-run`) e são seguros por padrão (rodar sem argumento = dry-run ou
aborta com instrução de uso, nunca escreve).
