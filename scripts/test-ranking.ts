import { modelRouter } from '../server/modelRouter.js';

const sutraAuto = { id: 'auto', name: 'SUTRA Auto', provider: 'sutra' };
const antigravityAuto = { id: 'auto', name: 'ASTRA', provider: 'antigravity' };

console.log('rank for sutraAuto:', modelRouter.rankProvidersDynamically(sutraAuto as any));
console.log('rank for antigravityAuto:', modelRouter.rankProvidersDynamically(antigravityAuto as any));
