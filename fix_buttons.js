const fs = require('fs');
let css = fs.readFileSync('styles.css', 'utf8');

// Completely rewrite .cat-btn for maximum compatibility
const catBtnRegex = /\.cat-btn \{[\s\S]*?\}/;
css = css.replace(catBtnRegex, `.cat-btn {
  display: block;
  width: 100%;
  padding: 10px 14px;
  background: transparent;
  border: 3px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 15px;
  font-weight: 500;
  color: var(--text-3);
  text-align: left;
  transition: all var(--trans);
  line-height: normal;
  margin-bottom: 4px;
}`);

// Rewrite .cat-btn states
const catBtnHoverRegex = /\.cat-btn:hover \{[\s\S]*?\}/;
css = css.replace(catBtnHoverRegex, `.cat-btn:hover {
  background: var(--bg-surface);
  color: var(--text-1);
}`);

const catBtnActiveRegex = /\.cat-btn\.active \{[\s\S]*?\}/;
css = css.replace(catBtnActiveRegex, `.cat-btn.active {
  background: rgba(229, 9, 20, 0.2);
  color: var(--accent);
  font-weight: 700;
}`);

const catBtnFocusRegex = /\.cat-btn:focus \{[\s\S]*?\}/;
css = css.replace(catBtnFocusRegex, `.cat-btn:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-surface);
  color: var(--text-1);
}`);

const catBtnActiveFocusRegex = /\.cat-btn\.active:focus \{[\s\S]*?\}/;
css = css.replace(catBtnActiveFocusRegex, `.cat-btn.active:focus {
  background: rgba(229, 9, 20, 0.2);
  border-color: var(--accent);
}`);

// Also fix menu-item to use borders
const menuItemRegex = /\.menu-item \{[\s\S]*?\}/;
css = css.replace(menuItemRegex, `.menu-item {
  display: inline-block;
  padding: 10px 22px;
  border: 3px solid transparent;
  border-radius: 100px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-3);
  cursor: pointer;
  transition: all var(--trans);
  white-space: nowrap;
  vertical-align: middle;
  line-height: normal;
}`);

const menuItemFocusRegex = /\.menu-item:focus \{[\s\S]*?\}/;
css = css.replace(menuItemFocusRegex, `.menu-item:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-surface);
  color: var(--text-1);
}`);

const menuItemActiveFocusRegex = /\.menu-item\.active:focus \{[\s\S]*?\}/;
css = css.replace(menuItemActiveFocusRegex, `.menu-item.active:focus {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}`);

fs.writeFileSync('styles.css', css);
console.log('Fixed buttons to use borders instead of box shadows for focus');
