const fs = require('fs');
let code = fs.readFileSync('modules/renderer.js', 'utf8');

code = code.replace(
  "var allBtn = el('button', { className: 'cat-btn active', textContent: 'Todos', tabIndex: 0 });",
  "var allBtn = el('div', { className: 'cat-btn active', textContent: 'Todos', tabIndex: 0, role: 'button' });"
);

code = code.replace(
  "var btn = el('button', { className: 'cat-btn', textContent: cleanName, tabIndex: 0 });",
  "var btn = el('div', { className: 'cat-btn', textContent: cleanName, tabIndex: 0, role: 'button' });"
);

fs.writeFileSync('modules/renderer.js', code);
console.log('Renderer updated');
