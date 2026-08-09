/**
 * test_sprint_pregolive_blocoN_recorrencia_variavel_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco N — terceiro tipo de Contas a Pagar recorrente:
 * "Recorrente variável". Diferente da "Recorrente fixa" já existente (cada
 * ocorrência nova HERDA rec.valor), a variável nunca copia valor nenhum —
 * cada competência nasce "a informar" (valorPendente:true, valor:null) até
 * alguém informar o valor real daquele mês.
 *
 * Decisão de representação de dados (documentada aqui porque é o núcleo do
 * requisito): uma ocorrência pendente é valor:null + valorPendente:true.
 * R$0,00 informado explicitamente é valor:0 + valorPendente:false — os dois
 * estados NUNCA se confundem. Toda soma monetária de FIN_CP passa por
 * finCPValorNum(r), que devolve 0 para um registro pendente — ou seja, uma
 * pendência é EXCLUÍDA de qualquer total (nunca contada como "R$0,00
 * confirmado"); a UI sinaliza a pendência separadamente (badge "Valor
 * pendente" em finCPRender()/finCalItemHTML(), nunca escondida do usuário).
 *
 * Achados corrigidos:
 *   1. <select id="finCPTipo"> tinha só 2 opções (avulsa/recorrente) — não
 *      dava pra criar uma recorrência de valor variável pela UI.
 *   2. finCPCriarRecorrencia()/finCPGerarOcorrencias() sempre exigiam e
 *      sempre herdavam rec.valor — não existia caminho para "valor a
 *      informar". Corrigido com o campo rec.tipoRecorrencia ('fixa'|
 *      'variavel'): só a fixa herda valor; a variável nasce sempre nula.
 *   3. ~20 pontos do arquivo somavam FIN_CP.valor diretamente
 *      (.reduce(function(s,c){return s+c.valor},0)) — qualquer um deles
 *      quebraria com NaN (ou pior, mostraria "R$ NaN") assim que um
 *      registro pendente existisse. Todos migrados para finCPValorNum(r).
 *
 * Uso: node scripts/test_sprint_pregolive_blocoN_recorrencia_variavel_2026-08-09.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
function assert(cond, msg) { if (cond) { console.log('  ✅  ' + msg); passed++; } else { console.log('  ❌  ' + msg); failed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco N — recorrência VARIÁVEL em Contas a Pagar ===\n');

// ── 1-3. Regressão estrutural: HTML tem o 3º tipo, com label correto ──
{
  test('1. <select id="finCPTipo"> tem a opção "recorrente_variavel"',
    /<option value="recorrente_variavel">/.test(html), true);
  test('2. a opção variável está rotulada como "valor variável" (distingue da fixa)',
    /recorrente_variavel">[^<]*valor variável/i.test(html), true);
  test('3. a recorrência fixa continua existindo com value="recorrente" (não foi removida/renomeada de value)',
    /<option value="recorrente">/.test(html), true);
}

// ── 4+. Execução real: motor puro de recorrência (sem DOM) ──
(function () {
  var src = [
    extractFn('finCPValorNum'),
    extractFn('finCPCompetenciaStr'),
    extractFn('finCPParseISO'),
    extractFn('finCPVencimentoDaCompetencia'),
    extractFn('finCPProximasCompetencias'),
    extractFn('finCPGerarOcorrencias'),
    extractFn('finCPCriarRecorrencia'),
    extractFn('finCPInformarValor'),
    'module.exports = { finCPValorNum: finCPValorNum, finCPGerarOcorrencias: finCPGerarOcorrencias, ' +
      'finCPCriarRecorrencia: finCPCriarRecorrencia, finCPInformarValor: finCPInformarValor, ' +
      'getFinCP: function(){return FIN_CP;}, getFinCPRec: function(){return FIN_CP_RECORRENCIAS;}, ' +
      'setFinCP: function(v){FIN_CP=v;}, setFinCPRec: function(v){FIN_CP_RECORRENCIAS=v;} };',
  ].join('\n\n');
  var modPath = path.join(__dirname, '_blocoN_recvar_extracted.tmp.js');

  function novoAmbiente() {
    var wrapped = 'var FIN_CP = []; var FIN_CP_RECORRENCIAS = [];\n' + src;
    fs.writeFileSync(modPath, wrapped);
    delete require.cache[require.resolve(modPath)];
    return require(modPath);
  }

  // ── 4. Criar recorrência variável NUNCA exige valor inicial ──
  {
    var mod = novoAmbiente();
    var r = mod.finCPCriarRecorrencia({
      descricao: 'Conta de luz (variável)', categoria: 'Operacional',
      tipoRecorrencia: 'variavel', // sem "valor" nenhum no payload
      diaVencimento: 10, dataInicial: '2026-08-01', dataFinal: null,
    });
    assert(r.ok === true, '4a. finCPCriarRecorrencia() aceita tipoRecorrencia:"variavel" sem dados.valor e retorna ok:true');
    assert(r.ocorrenciasCriadas > 0, '4b. gera ao menos 1 ocorrência mesmo sem valor informado na criação');
    var rec = mod.getFinCPRec()[0];
    assert(rec.valor === null, '4c. a recorrência-mãe fica com valor:null (nunca um número inventado)');
    assert(rec.tipoRecorrencia === 'variavel', '4d. a recorrência-mãe é marcada tipoRecorrencia:"variavel"');
  }

  // ── 5+. finCPGerarOcorrencias(): cada nova competência nasce pendente, NUNCA copia o mês anterior ──
  {
    var mod = novoAmbiente();
    mod.finCPCriarRecorrencia({
      descricao: 'Comissão variável', categoria: 'Pessoal Admin', tipoRecorrencia: 'variavel',
      diaVencimento: 5, dataInicial: '2026-06-01', dataFinal: null,
    });
    var cp = mod.getFinCP();
    var mes1 = cp.find(function (c) { return c.competencia === '2026-06'; });
    test('5. mês 1 (competência de criação) nasce com valorPendente:true', mes1.valorPendente, true);
    test('6. mês 1 nasce com valor:null (nunca 0, nunca um número qualquer)', mes1.valor, null);

    // Informa o valor do mês 1 como R$500 — e então gera as próximas competências.
    var res1 = mod.finCPInformarValor(mes1.id, 500);
    assert(res1.ok === true, '7. finCPInformarValor(mes1, 500) retorna ok:true');
    var mes1Depois = mod.getFinCP().find(function (c) { return c.id === mes1.id; });
    test('8. depois de informado, mês 1 fica com valor:500 e valorPendente:false', { valor: mes1Depois.valor, valorPendente: mes1Depois.valorPendente }, { valor: 500, valorPendente: false });

    // Gera mais uma leva de ocorrências (mês 2 em diante) — mês 2 NUNCA pode nascer com 500.
    mod.finCPGerarOcorrencias(6);
    var mes2 = mod.getFinCP().find(function (c) { return c.competencia === '2026-07'; });
    assert(!!mes2, '9. mês 2 (2026-07) foi gerado');
    test('10. mês 2 nasce valorPendente:true — NUNCA herda o valor informado no mês 1', mes2.valorPendente, true);
    test('11. mês 2 nasce com valor:null — prova direta de que não copiou os R$500 do mês anterior', mes2.valor, null);

    // Rodar de novo (idempotência) não duplica nem altera o que já existe.
    var totalAntes = mod.getFinCP().length;
    mod.finCPGerarOcorrencias(6);
    test('12. rodar finCPGerarOcorrencias() de novo é idempotente (não duplica ocorrências)', mod.getFinCP().length, totalAntes);
  }

  // ── 13+. finCPValorNum(): pendente exclui da soma; R$0,00 explícito conta normalmente ──
  {
    var mod = novoAmbiente();
    var pendente = { valor: null, valorPendente: true };
    var zeroExplicito = { valor: 0, valorPendente: false };
    var normal = { valor: 350.5, valorPendente: false };
    var legadoSemFlag = { valor: 120 }; // registro antigo, nunca teve o campo valorPendente

    test('13. ocorrência pendente contribui 0 para qualquer soma (finCPValorNum)', mod.finCPValorNum(pendente), 0);
    test('14. R$0,00 informado EXPLICITAMENTE (valorPendente:false) conta como 0 real, não é tratado como "sem valor"', mod.finCPValorNum(zeroExplicito), 0);
    test('15. valor normal (fixa/avulsa) passa direto', mod.finCPValorNum(normal), 350.5);
    test('16. registro legado sem o campo valorPendente (undefined) é tratado como NÃO pendente', mod.finCPValorNum(legadoSemFlag), 120);

    // Vice-versa: uma lista com 1 pendente (R$999 "escondido") + 1 zero real
    // + 1 normal soma exatamente os dois conhecidos — a pendência nunca
    // aparece como R$0,00 misturada ao total, e o R$0,00 real não some.
    var lista = [
      { valor: null, valorPendente: true },     // "a informar" — excluído
      { valor: 0, valorPendente: false },       // R$0,00 real — conta
      { valor: 100, valorPendente: false },     // normal — conta
    ];
    var total = lista.reduce(function (s, r) { return s + mod.finCPValorNum(r); }, 0);
    test('17. soma de [pendente, R$0,00 real, R$100] = 100 (pendente excluída, R$0,00 real preservado)', total, 100);
  }

  // ── 18+. Nenhuma regressão no tipo "recorrente fixa" — valor continua herdado ──
  {
    var mod = novoAmbiente();
    var r = mod.finCPCriarRecorrencia({
      descricao: 'Aluguel', categoria: 'Operacional', valor: 1800,
      tipoRecorrencia: 'fixa', diaVencimento: 10, dataInicial: '2026-06-01', dataFinal: null,
    });
    assert(r.ok === true, '18. recorrência FIXA continua sendo criada normalmente com valor obrigatório');
    var rec = mod.getFinCPRec()[0];
    test('19. recorrência fixa mantém rec.valor:1800 (nunca fica null)', rec.valor, 1800);
    test('20. recorrência fixa é marcada tipoRecorrencia:"fixa"', rec.tipoRecorrencia, 'fixa');
    var mes1 = mod.getFinCP().find(function (c) { return c.competencia === '2026-06'; });
    test('21. ocorrência da fixa nasce SEM valorPendente (falsy) — comportamento herdado preservado', !!mes1.valorPendente, false);
    test('22. ocorrência da fixa herda rec.valor (1800) — comportamento original intacto', mes1.valor, 1800);

    // Gera mais uma competência — também deve herdar 1800 (não é afetado
    // pela lógica nova de "nunca copiar" que só vale para a variável).
    mod.finCPGerarOcorrencias(3);
    var mes2 = mod.getFinCP().find(function (c) { return c.competencia === '2026-07'; });
    test('23. mês 2 da recorrência fixa também herda 1800 (regra da fixa é HERDAR, diferente da variável)', mes2.valor, 1800);
  }

  // ── 24+. finCPInformarValor(): validação de entrada ──
  {
    var mod = novoAmbiente();
    mod.finCPCriarRecorrencia({ descricao: 'X', categoria: 'Outros', tipoRecorrencia: 'variavel', diaVencimento: 1, dataInicial: '2026-08-01', dataFinal: null });
    var pend = mod.getFinCP()[0];

    var rNeg = mod.finCPInformarValor(pend.id, -10);
    test('24. finCPInformarValor rejeita valor negativo', rNeg.ok, false);
    var rNaN = mod.finCPInformarValor(pend.id, 'abc');
    test('25. finCPInformarValor rejeita valor não numérico', rNaN.ok, false);
    var rInexistente = mod.finCPInformarValor('id-que-nao-existe', 100);
    test('26. finCPInformarValor retorna erro para id inexistente', rInexistente.ok, false);
    var rZero = mod.finCPInformarValor(pend.id, 0);
    assert(rZero.ok === true, '27. finCPInformarValor ACEITA R$0,00 como valor válido (mês sem custo real)');
    var depois = mod.getFinCP().find(function (c) { return c.id === pend.id; });
    test('28. depois de informar R$0,00, o registro fica valor:0 e valorPendente:false (não continua pendente)', { valor: depois.valor, valorPendente: depois.valorPendente }, { valor: 0, valorPendente: false });
  }

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
