// One-off brace balance scanner for server/index.ts (run: node scripts/brace-check.cjs [file])
const fs = require('fs');
const file = process.argv[2] || 'server/index.ts';
const src = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let depth = 0;
const stack = [];
let inStr = null; // ', ", `
let inBlockComment = false;
let inTemplateExpr = 0; // inside ${ } of a template literal
const templateStack = [];
for (let i = 0; i < src.length; i++) {
  const line = src[i];
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const n = line[j + 1];
    if (inBlockComment) {
      if (c === '*' && n === '/') { inBlockComment = false; j++; }
      continue;
    }
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (inStr === '`' && c === '$' && n === '{') { inTemplateExpr++; j++; templateStack.push(true); continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') break; // line comment
    if (c === '/' && n === '*') { inBlockComment = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') {
      depth++;
      stack.push([i + 1, j + 1]);
      if (inTemplateExpr > 0 && templateStack[templateStack.length - 1]) { /* keep marker */ }
    }
    if (c === '}') {
      depth--;
      stack.pop();
      if (depth < 0) { console.log('EXTRA } at line', i + 1, 'col', j + 1); process.exit(0); }
    }
  }
}
console.log('final depth:', depth, '| unclosed opened at:', stack.slice(-5));
