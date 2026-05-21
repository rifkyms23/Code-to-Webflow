const BREAKPOINT_MEDIA = {
    tiny: '(max-width: 479px)',
    small: '(max-width: 767px)',
    medium: '(max-width: 991px)',
    large: '(min-width: 1280px)',
    xl: '(min-width: 1440px)',
    xxl: '(min-width: 1920px)'
};

const VOID_TAGS = new Set([
    'img', 'br', 'hr', 'input', 'meta', 'link',
    'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'
]);

function escapeHtmlText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function unescapeRawVars(css) {
    return css.replace(/@raw<\|([^|]+)\|>/g, '$1');
}

function collapseBoxLonghand(decls) {
    const out = [];
    const used = new Set();
    for (let i = 0; i < decls.length; i++) {
        if (used.has(i)) continue;
        const m = decls[i].match(/^(padding|margin)-top\s*:\s*(.+)$/);
        if (!m) { out.push(decls[i]); used.add(i); continue; }
        const prop = m[1];
        const top = m[2].trim();
        let right, bottom, left, rIdx = -1, bIdx = -1, lIdx = -1;
        for (let j = i + 1; j < decls.length; j++) {
            if (used.has(j)) continue;
            const mm = decls[j].match(new RegExp('^' + prop + '-(right|bottom|left)\\s*:\\s*(.+)$'));
            if (!mm) continue;
            if (mm[1] === 'right' && right === undefined) { right = mm[2].trim(); rIdx = j; }
            else if (mm[1] === 'bottom' && bottom === undefined) { bottom = mm[2].trim(); bIdx = j; }
            else if (mm[1] === 'left' && left === undefined) { left = mm[2].trim(); lIdx = j; }
        }
        if (right !== undefined && bottom !== undefined && left !== undefined) {
            used.add(i); used.add(rIdx); used.add(bIdx); used.add(lIdx);
            let val;
            if (top === right && right === bottom && bottom === left) val = top;
            else if (top === bottom && right === left) val = top + ' ' + right;
            else if (right === left) val = top + ' ' + right + ' ' + bottom;
            else val = top + ' ' + right + ' ' + bottom + ' ' + left;
            out.push(prop + ': ' + val);
        } else {
            out.push(decls[i]); used.add(i);
        }
    }
    return out;
}

function formatStyleLessForCss(styleLess, indent) {
    if (!styleLess || !styleLess.trim()) return '';
    const css = unescapeRawVars(styleLess);
    const decls = css.split(';').map(d => d.trim()).filter(Boolean);
    const collapsed = collapseBoxLonghand(decls);
    const pad = '  '.repeat(indent);
    return collapsed.map(d => pad + d + ';').join('\n');
}

function webflowToHtml(json) {
    const payload = json.payload || {};
    const nodes = payload.nodes || [];
    const styles = payload.styles || [];
    const assets = payload.assets || [];

    const nodeMap = {};
    for (const n of nodes) nodeMap[n._id] = n;

    const styleMap = {};
    for (const s of styles) styleMap[s._id] = s;

    const assetMap = {};
    for (const a of assets) assetMap[a._id] = a;

    const comboParent = {};
    for (const s of styles) {
        if (s.children) for (const cId of s.children) comboParent[cId] = s._id;
    }

    const referenced = new Set();
    for (const n of nodes) {
        if (n.children) for (const c of n.children) referenced.add(c);
    }
    const roots = nodes.filter(n => !referenced.has(n._id));

    let globalCss = '';

    function renderNode(node, indent) {
        if (!node) return null;
        const pad = '  '.repeat(indent);

        if (node.text) return pad + escapeHtmlText(node.v || '');

        if (node.type === 'HtmlEmbed') {
            const raw = (node.data && node.data.embed && node.data.embed.meta && node.data.embed.meta.html) || node.v || '';
            const styleMatch = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            if (styleMatch) {
                globalCss += styleMatch[1].trim() + '\n\n';
            }
            return null;
        }

        let tag = 'div';
        const attrs = {};
        const d = node.data || {};

        if (node.type === 'Heading') tag = d.tag || node.tag || 'h1';
        else if (node.type === 'Paragraph') tag = 'p';
        else if (node.type === 'Link') {
            tag = 'a';
            if (d.link && d.link.url) attrs.href = d.link.url;
        }
        else if (node.type === 'Image') {
            tag = 'img';
            const imgId = d.img && d.img.id;
            const asset = imgId ? assetMap[imgId] : null;
            if (asset && asset.cdnUrl) attrs.src = asset.cdnUrl;
            else if (d.attr && d.attr.src) attrs.src = d.attr.src;
            if (d.attr && d.attr.alt !== undefined) attrs.alt = d.attr.alt;
        }
        else if (node.type === 'DOM') {
            tag = d.tag || 'div';
            if (d.attributes) for (const a of d.attributes) attrs[a.name] = a.value;
        }
        else if (node.type === 'Block') {
            tag = d.tag || node.tag || 'div';
        }

        if (node.type !== 'DOM' && node.type !== 'Image') {
            if (d.attr && d.attr.id) attrs.id = d.attr.id;
        }
        if (d.xattr && node.type !== 'DOM') {
            for (const a of d.xattr) attrs[a.name] = a.value;
        }

        if (node.classes && node.classes.length > 0) {
            const names = node.classes.map(id => styleMap[id] && styleMap[id].name).filter(Boolean);
            if (names.length > 0) attrs.class = names.join(' ');
        }

        const attrStr = Object.entries(attrs)
            .map(([k, v]) => v === '' ? k : k + '="' + escapeHtmlAttr(v) + '"')
            .join(' ');
        const open = '<' + tag + (attrStr ? ' ' + attrStr : '') + '>';

        if (VOID_TAGS.has(tag)) return pad + open;

        const childIds = node.children || [];
        const childStrs = childIds.map(cId => renderNode(nodeMap[cId], indent + 1)).filter(s => s !== null && s !== undefined && s !== '');

        if (childStrs.length === 0) return pad + open + '</' + tag + '>';

        const allChildrenText = childIds.every(cId => nodeMap[cId] && nodeMap[cId].text);
        if (allChildrenText && childStrs.length === 1) {
            return pad + open + childStrs[0].trim() + '</' + tag + '>';
        }

        return pad + open + '\n' + childStrs.join('\n') + '\n' + pad + '</' + tag + '>';
    }

    const htmlParts = roots.map(r => renderNode(r, 0)).filter(s => s !== null && s !== undefined);
    const html = htmlParts.join('\n');

    function selectorFor(style) {
        if (style.comb === '&') {
            const parentId = comboParent[style._id];
            const parent = parentId ? styleMap[parentId] : null;
            if (parent) return '.' + parent.name + '.' + style.name;
        }
        return '.' + style.name;
    }

    const cssParts = [];
    const breakpointGroups = {};

    for (const s of styles) {
        const sel = selectorFor(s);
        if (s.styleLess && s.styleLess.trim()) {
            cssParts.push(sel + ' {\n' + formatStyleLessForCss(s.styleLess, 1) + '\n}');
        }
        const variants = s.variants || {};
        if (variants.main_hover && variants.main_hover.styleLess) {
            cssParts.push(sel + ':hover {\n' + formatStyleLessForCss(variants.main_hover.styleLess, 1) + '\n}');
        }
        for (const key of Object.keys(variants)) {
            if (key === 'main_hover') continue;
            if (!BREAKPOINT_MEDIA[key]) continue;
            const v = variants[key];
            if (!v.styleLess) continue;
            if (!breakpointGroups[key]) breakpointGroups[key] = [];
            breakpointGroups[key].push(sel + ' {\n' + formatStyleLessForCss(v.styleLess, 2) + '\n  }');
        }
    }

    for (const bp of ['tiny', 'small', 'medium', 'large', 'xl', 'xxl']) {
        if (!breakpointGroups[bp]) continue;
        const inner = breakpointGroups[bp].map(r => '  ' + r).join('\n\n');
        cssParts.push('@media ' + BREAKPOINT_MEDIA[bp] + ' {\n' + inner + '\n}');
    }

    let css = '';
    if (globalCss.trim()) css += globalCss.trim() + '\n\n';
    css += cssParts.join('\n\n');

    return { html, css };
}

function copyTextToClipboard(text) {
    const handler = ev => {
        ev.clipboardData.setData('text/plain', text);
        ev.preventDefault();
    };
    document.addEventListener('copy', handler);
    const tmp = document.createElement('textarea');
    tmp.value = ' ';
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.appendChild(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(tmp);
    document.removeEventListener('copy', handler);
    return ok;
}

const statusEl = document.getElementById('status');
const outputHtmlEl = document.getElementById('output-html');
const outputCssEl = document.getElementById('output-css');
let lastHtml = '';
let lastCss = '';

function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
    if (msg && !isError) {
        setTimeout(() => {
            if (statusEl.textContent === msg) statusEl.textContent = '';
        }, 4000);
    }
}

document.getElementById('btn-reverse').addEventListener('click', () => {
    const raw = document.getElementById('input-json').value.trim();
    if (!raw) {
        setStatus('Please paste a Webflow JSON payload.', true);
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        setStatus('Invalid JSON: ' + err.message, true);
        return;
    }
    try {
        const result = webflowToHtml(parsed);
        lastHtml = result.html;
        lastCss = result.css;
        outputHtmlEl.textContent = lastHtml;
        outputCssEl.textContent = lastCss;
        setStatus('✓ Converted to HTML and CSS.');
    } catch (err) {
        console.error(err);
        setStatus('Error: ' + err.message, true);
    }
});

document.getElementById('btn-copy-html').addEventListener('click', () => {
    if (!lastHtml) { setStatus('No HTML yet. Click Convert first.', true); return; }
    const ok = copyTextToClipboard(lastHtml);
    setStatus(ok ? '✓ HTML copied.' : 'Copy failed.', !ok);
});

document.getElementById('btn-copy-css').addEventListener('click', () => {
    if (!lastCss) { setStatus('No CSS yet. Click Convert first.', true); return; }
    const ok = copyTextToClipboard(lastCss);
    setStatus(ok ? '✓ CSS copied.' : 'Copy failed.', !ok);
});

document.getElementById('btn-clear-reverse').addEventListener('click', () => {
    if (!confirm('Clear input and output?')) return;
    document.getElementById('input-json').value = '';
    outputHtmlEl.textContent = '';
    outputCssEl.textContent = '';
    lastHtml = '';
    lastCss = '';
    setStatus('Cleared.');
});

document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-reverse').click();
    }
});

function extractWebflowJson(clipboardData) {
    const types = Array.from(clipboardData.types || []);
    console.log('[clipboard inspector] available types:', types);

    const jsonTypes = types.filter(t => /json/i.test(t) || /webflow/i.test(t));
    for (const t of jsonTypes) {
        const raw = clipboardData.getData(t);
        if (raw && raw.trim().startsWith('{')) {
            console.log('[clipboard inspector] using type:', t);
            return { raw, type: t };
        }
    }

    const plain = clipboardData.getData('text/plain');
    if (plain && plain.trim().startsWith('{')) {
        console.log('[clipboard inspector] using type: text/plain (parsed as JSON)');
        return { raw: plain, type: 'text/plain' };
    }

    return null;
}

document.getElementById('input-json').addEventListener('paste', e => {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;

    const found = extractWebflowJson(cd);
    if (!found) return;

    let pretty = found.raw;
    try {
        const parsed = JSON.parse(found.raw);
        pretty = JSON.stringify(parsed, null, 2);
    } catch (err) {
        setStatus('Pasted ' + found.type + ' but JSON parse failed: ' + err.message, true);
        return;
    }

    e.preventDefault();
    const ta = e.target;
    ta.value = pretty;
    ta.setSelectionRange(pretty.length, pretty.length);
    setStatus('✓ Pasted as ' + found.type + ' (' + pretty.length.toLocaleString() + ' chars).');
});
