import { modelRouter } from '../server/modelRouter.js';

console.log('chatgpt-web cred:', modelRouter.getCredential('chatgpt-web'));
console.log('hasCredential(chatgpt-web):', modelRouter.hasCredential('chatgpt-web'));
console.log('hasCredential(antigravity):', modelRouter.hasCredential('antigravity'));
console.log('hasCredential(google):', modelRouter.hasCredential('google'));
console.log('hasCredential(groq):', modelRouter.hasCredential('groq'));
console.log('hasCredential(openrouter):', modelRouter.hasCredential('openrouter'));
console.log('hasCredential(anthropic):', modelRouter.hasCredential('anthropic'));
