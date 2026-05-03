const fs = require('fs');
let css = fs.readFileSync('styles.css', 'utf8');

// Fix the gap fallback for .category-filter (sidebar buttons)
css = css.replace(
  /\.category-filter \{\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  padding: 0 20px 32px;\n\}/,
  '.category-filter {\n  display: flex;\n  flex-direction: column;\n  padding: 0 20px 32px;\n}\n.category-filter > * { margin-bottom: 4px; }\n.category-filter > *:last-child { margin-bottom: 0; }'
);

// We already modified .cat-btn to have flex in the previous thought, let's refine it.
// On very old TVs, flex on buttons can fail. It's safer to use display: block, clear line-height, and rely purely on padding for vertical centering.
css = css.replace(
  /\.cat-btn \{\n  display: flex;\n  align-items: center;\n  min-height: 44px;\n  padding: 10px 16px;\n  background: transparent;\n  border: none;\n  border-radius: var\(--radius-sm\);\n  font-size: 15px;\n  font-weight: 500;\n  color: var\(--text-3\);\n  text-align: left;\n  transition: all var\(--trans\);\n  line-height: 1;\n\}/,
  '.cat-btn {\n  display: block;\n  width: 100%;\n  padding: 12px 16px;\n  background: transparent;\n  border: none;\n  border-radius: var(--radius-sm);\n  font-size: 14px;\n  font-weight: 500;\n  color: var(--text-3);\n  text-align: left;\n  transition: all var(--trans);\n  line-height: normal;\n  vertical-align: middle;\n}'
);

fs.writeFileSync('styles.css', css);
console.log('Fixed sidebar gap and cat-btn flex issue');
