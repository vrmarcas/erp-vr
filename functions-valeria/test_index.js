'use strict';
const fbFunctionsPath = require.resolve('firebase-functions');
const adminPath = require.resolve('firebase-admin');

const found = [];
const mockFn = {
  runWith: (opts) => ({
    https: { onRequest: (h) => { const f = function(){}; f.__isCloudFn=true; found.push('(runWith.onRequest)'); return f; } }
  }),
  https: { onRequest: (h) => { const f = function(){}; f.__isCloudFn=true; return f; } }
};
require.cache[fbFunctionsPath] = { id: fbFunctionsPath, filename: fbFunctionsPath, loaded: true, exports: mockFn };

const mockAdmin = { 
  apps: [],
  initializeApp: () => { mockAdmin.apps.push({}); },
  firestore: Object.assign(() => ({}), { FieldValue: { increment: (n)=>n, arrayUnion: (...a)=>a } }),
  credential: { applicationDefault: () => ({}) }
};
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: mockAdmin };

const m = require('./lib/index.js');
const fns = Object.keys(m).filter(k => k !== '__esModule');
console.log('Functions found: ' + fns.length);
fns.forEach(k => console.log('  ' + k + ': ' + (m[k] ? typeof m[k] : 'UNDEFINED')));
process.exit(0);
