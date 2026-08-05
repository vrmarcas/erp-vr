const { flagsDeProducaoPresentes, validarEstadoEsperado, usaCredencialADC } = require('./lib/production_safety');
const { DECISOES_HUMANAS } = require('./lib/user_decisions');

let passed=0, failed=0;
function assert(desc, got, exp) {
  const g=JSON.stringify(got), e=JSON.stringify(exp);
  if (g===e) { console.log('  ✅ '+desc); passed++; } else { console.log('  ❌ '+desc+' esperado '+e+' obtido '+g); failed++; }
}

console.log('\n-- flagsDeProducaoPresentes --');
assert('1. sem nenhuma flag -> nao ok', flagsDeProducaoPresentes([]).ok, false);
assert('2. só --allow-production -> nao ok', flagsDeProducaoPresentes(['--allow-production']).ok, false);
assert('3. só --authorization correto -> nao ok', flagsDeProducaoPresentes(['--authorization=FASE_F_USERS_2026_08_05']).ok, false);
assert('4. authorization errado -> nao ok mesmo com allow-production', flagsDeProducaoPresentes(['--allow-production','--authorization=ERRADO']).ok, false);
assert('5. as duas certas -> ok', flagsDeProducaoPresentes(['--allow-production','--authorization=FASE_F_USERS_2026_08_05']).ok, true);

console.log('\n-- validarEstadoEsperado --');
// monta o estado CORRETO esperado a partir da própria tabela de decisões
const authCorreto = DECISOES_HUMANAS.filter(d=>d.acao!=='criar-conta').map((d,i)=>({uid:'u'+i, email:d.email}));
assert('6. estado correto (4 existentes+1 aposentado no Auth, 3 ausentes) -> ok', validarEstadoEsperado(authCorreto, new Set()).ok, true);

const authComContaJaCriada = authCorreto.concat([{uid:'novo', email:'cleiton_1310@hotmail.com'}]);
assert('7. uma das "a criar" já existe no Auth -> nao ok (evita duplicar)', validarEstadoEsperado(authComContaJaCriada, new Set()).ok, false);

const authSemUmaExistente = authCorreto.filter(u => u.email !== 'isabellabsil@hotmail.com');
assert('8. uma das "existentes" NAO está no Auth -> nao ok', validarEstadoEsperado(authSemUmaExistente, new Set()).ok, false);

const authComTecnicaNaTabela = authCorreto.concat([{uid:'tec', email:'vrmarcasgithub@gmail.com'}]);
// a conta técnica sozinha no Auth não é erro (ela não está na tabela de decisões) -- só seria erro se a TABELA a incluísse, o que nunca acontece por construção
assert('9. conta técnica presente no Auth mas fora da tabela -> ok (não é erro)', validarEstadoEsperado(authComTecnicaNaTabela, new Set()).ok, true);

const authComEmailDuplicado = authCorreto.concat([{uid:'dup', email:'isabellabsil@hotmail.com'}]);
assert('10. e-mail da tabela com 2 contas no Auth -> nao ok (ambíguo)', validarEstadoEsperado(authComEmailDuplicado, new Set()).ok, false);

console.log('\n-- validarEstadoEsperado (estágio pós-criação, exigirACriarAusente=false) --');
// Bug real pego em produção: rodar migrate/sync/retire DEPOIS que as 3 contas
// já foram criadas não pode abortar só porque elas agora existem — isso é o
// estado ESPERADO nesse estágio, não uma divergência.
const authTodos7Presentes = DECISOES_HUMANAS.filter(d=>d.acao!=='aposentar').map((d,i)=>({uid:'u'+i, email:d.email}))
  .concat(DECISOES_HUMANAS.filter(d=>d.acao==='aposentar').map((d,i)=>({uid:'ap'+i, email:d.email})));
assert('11. pós-criação: as 3 "a criar" JÁ presentes -> ok (esperado, não é erro)', validarEstadoEsperado(authTodos7Presentes, new Set(), false).ok, true);

const authPosCriacaoFaltandoUma = authTodos7Presentes.filter(u => u.email !== 'cleiton_1310@hotmail.com');
assert('12. pós-criação: uma das "a criar" AINDA ausente -> nao ok (create_missing ainda não rodou)', validarEstadoEsperado(authPosCriacaoFaltandoUma, new Set(), false).ok, false);

console.log('\n-- usaCredencialADC --');
assert('13. sem a flag -> nao usa ADC', usaCredencialADC([]), false);
assert('14. --credential-mode=adc -> usa ADC', usaCredencialADC(['--credential-mode=adc']), true);
assert('15. --credential-mode=outracoisa -> nao usa ADC', usaCredencialADC(['--credential-mode=servico']), false);

console.log('\n================\n RESULTADO: '+passed+' passed, '+failed+' failed\n================');
process.exit(failed?1:0);
