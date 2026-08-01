'use strict';
const fbFunctionsPath = require.resolve('firebase-functions');
const adminPath = require.resolve('firebase-admin');

const mockFn = {
  runWith: (opts) => ({ https: { onRequest: (h) => { console.log('  -> onRequest intercepted'); return {}; } } }),
  https: { onRequest: (h) => ({}) }
};
require.cache[fbFunctionsPath] = { id: fbFunctionsPath, filename: fbFunctionsPath, loaded: true, exports: mockFn };

const mockAdmin = { 
  apps: [],
  initializeApp: () => { mockAdmin.apps.push({}); console.log('  -> admin init'); },
  firestore: Object.assign(() => ({}), { FieldValue: { increment: (n) => n, arrayUnion: (...a) => a } }),
  credential: { applicationDefault: () => ({}) }
};
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: mockAdmin };

const mod = process.argv[2];
console.log('Loading lib/' + mod + '.js ...');
try {
  const m = require('./lib/' + mod + '.js');
  console.log('SUCCESS: ' + Object.keys(m).filter(k=>k!=='__esModule').join(', '));
} catch(e) {
  console.log('ERROR: ' + e.message);
  console.log(e.stack.split('\n').slice(0,6).join('\n'));
}
process.exit(0);
