const fs = require('fs');
let css = fs.readFileSync('styles.css', 'utf8');

css = css.replace(
  /.cat-btn {\n  padding: 12px 16px;\n  background: transparent;\n  border: none;\n  border-radius: var\(--radius-sm\);\n  font-size: 14px;\n  font-weight: 500;\n  color: var\(--text-3\);\n  text-align: left;\n  transition: all var\(--trans\);\n}/,
  `.cat-btn {\n  display: flex;\n  align-items: center;\n  min-height: 44px;\n  padding: 10px 16px;\n  background: transparent;\n  border: none;\n  border-radius: var(--radius-sm);\n  font-size: 15px;\n  font-weight: 500;\n  color: var(--text-3);\n  text-align: left;\n  transition: all var(--trans);\n  line-height: 1;\n}`
);

fs.writeFileSync('styles.css', css);
console.log('Fixed cat-btn');
