const { flagsDeProducaoPresentes, validarEstadoEsperado, usaCredencialADC } = require('./lib/production_safety');
const { DECISOES_HUMANAS, CONTAS_SUBSTITUIDAS } = require('./lib/user_decisions');

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
assert('6. estado correto (5 existentes+1 aposentado no Auth, 3 ausentes) -> ok', validarEstadoEsperado(authCorreto, new Set()).ok, true);

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

console.log('\n-- validarEstadoEsperado (modo null — estágio misto, correção Paulo Victor) --');
// Bug real #2, pego durante a correção do e-mail de Paulo Victor: rodar
// create_missing_erp_users.js quando 2 das 3 "a criar" já existem (rodada
// anterior) e a 3ª (a conta corrigida) ainda não, não pode abortar — é
// exatamente o estágio em que este script deve poder criar só a que falta.
const authMisto = DECISOES_HUMANAS.filter(d => d.acao !== 'criar-conta' && d.acao !== 'aposentar').map((d,i)=>({uid:'u'+i, email:d.email}))
  .concat(DECISOES_HUMANAS.filter(d=>d.acao==='aposentar').map((d,i)=>({uid:'ap'+i, email:d.email})))
  .concat([{uid:'c1', email:'cleiton_1310@hotmail.com'}, {uid:'c2', email:'marialuizasstival@gmail.com'}]); // Paulo Victor (contato@aprovain.com) ausente
assert('13. estágio misto (2 de 3 "a criar" já existem, 1 ainda não) -> ok com modo null', validarEstadoEsperado(authMisto, new Set(), null).ok, true);

const authTodosAusentes = DECISOES_HUMANAS.filter(d => d.acao !== 'criar-conta').map((d,i)=>({uid:'u'+i, email:d.email}));
assert('14. modo null com as 3 "a criar" totalmente ausentes -> também ok (não valida nem exige nem proíbe)', validarEstadoEsperado(authTodosAusentes, new Set(), null).ok, true);

console.log('\n-- validarEstadoEsperado (defesa: e-mail substituído nunca pode voltar à tabela ativa) --');
assert('15. CONTAS_SUBSTITUIDAS tem exatamente 1 entrada hoje (Paulo Victor)', CONTAS_SUBSTITUIDAS.length, 1);
assert('16. cortevr@gmail.com (e-mail antigo já substituído) não está mais em DECISOES_HUMANAS',
  DECISOES_HUMANAS.some(d => d.email.toLowerCase() === CONTAS_SUBSTITUIDAS[0].emailAntigo.toLowerCase()), false);

console.log('\n-- Anna Carla — formalização na tabela (incidente 2026-08-05) --');
assert('17. exatamente 8 usuários ativos na tabela', DECISOES_HUMANAS.filter(d=>d.acao!=='aposentar').length, 8);
assert('18. Anna Carla está na tabela como master, normalizar-existente, temporária',
  DECISOES_HUMANAS.find(d => d.email === 'nannacarla0@gmail.com'),
  { legacyIndex: null, nome: 'Anna Carla', email: 'nannacarla0@gmail.com', funcaoFinal: 'master', acao: 'normalizar-existente', temporario: true, observacao: 'acesso temporário durante desenvolvimento/entrega do ERP — desligamento formal fica para depois da confirmação humana de conclusão do projeto' });
const authComAnna = DECISOES_HUMANAS.filter(d=>d.acao!=='criar-conta').map((d,i)=>({uid:'u'+i, email:d.email}));
assert('19. estado com as 5 "existentes" (incl. Anna) presentes -> ok', validarEstadoEsperado(authComAnna, new Set()).ok, true);
const authSemAnna = authComAnna.filter(u => u.email !== 'nannacarla0@gmail.com');
assert('20. Anna ausente do Auth apesar de estar como "existente" na tabela -> nao ok', validarEstadoEsperado(authSemAnna, new Set()).ok, false);

console.log('\n-- usaCredencialADC --');
assert('21. sem a flag -> nao usa ADC', usaCredencialADC([]), false);
assert('22. --credential-mode=adc -> usa ADC', usaCredencialADC(['--credential-mode=adc']), true);
assert('23. --credential-mode=outracoisa -> nao usa ADC', usaCredencialADC(['--credential-mode=servico']), false);

console.log('\n================\n RESULTADO: '+passed+' passed, '+failed+' failed\n================');
process.exit(failed?1:0);
