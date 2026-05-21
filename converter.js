document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.code-input').forEach(i => i.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        const target = document.getElementById('input-' + tab);
        target.classList.add('active');
        target.focus();
    });
});

function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const MIME_BY_EXT = {
    avif: 'image/avif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml'
};

function generateAssetId() {
    let id = '';
    for (let i = 0; i < 24; i++) id += Math.floor(Math.random() * 16).toString(16);
    return id;
}

function parseWebflowCdnUrl(url) {
    if (!url) return null;
    const m = url.match(/^(https?:\/\/[^\/]+)\/([a-f0-9]{24})\/([a-f0-9]{24})_([^?#]+)/i);
    if (!m) return null;
    const [, base, siteId, assetId, rest] = m;
    let origFileName = rest;
    const variantMatch = rest.match(/^[a-f0-9]{32}_(.+?)-p-\d+(\.\w+)?$/i);
    if (variantMatch) origFileName = variantMatch[1] + (variantMatch[2] || '');
    const fileName = assetId + '_' + origFileName;
    const cdnUrl = base + '/' + siteId + '/' + fileName;
    const extMatch = origFileName.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    return {
        siteId, assetId, origFileName, fileName, cdnUrl,
        mimeType: MIME_BY_EXT[ext] || (ext ? 'image/' + ext : 'image/jpeg')
    };
}

function parseImageUrl(url) {
    const wf = parseWebflowCdnUrl(url);
    if (wf) return wf;
    if (!url) return null;
    const fileMatch = url.match(/\/([^\/?#]+?)(?:[?#]|$)/);
    const origFileName = fileMatch ? decodeURIComponent(fileMatch[1]) : 'image';
    const extMatch = origFileName.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const assetId = generateAssetId();
    return {
        siteId: '',
        assetId,
        origFileName,
        fileName: assetId + '_' + origFileName,
        cdnUrl: url,
        mimeType: MIME_BY_EXT[ext] || (ext ? 'image/' + ext : 'image/png')
    };
}

function escapeVarsForWebflow(css) {
    return css.replace(/var\(--[a-zA-Z_][\w-]*(?:\s*,\s*[^)]*)?\)/g, m => '@raw<|' + m + '|>');
}

function normalizeTransformForWebflow(css) {
    return css
        .replace(/\btranslateX\(\s*([^)]+?)\s*\)/g, 'translate($1, 0px)')
        .replace(/\btranslateY\(\s*([^)]+?)\s*\)/g, 'translate(0px, $1)')
        .replace(/\btranslateZ\(\s*([^)]+?)\s*\)/g, 'translate3d(0px, 0px, $1)')
        .replace(/\bscaleX\(\s*([^)]+?)\s*\)/g, 'scale($1, 1)')
        .replace(/\bscaleY\(\s*([^)]+?)\s*\)/g, 'scale(1, $1)');
}

function splitValueTopLevel(value) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '(') { depth++; current += ch; }
        else if (ch === ')') { depth--; current += ch; }
        else if (/\s/.test(ch) && depth === 0) {
            if (current) { parts.push(current); current = ''; }
        } else current += ch;
    }
    if (current) parts.push(current);
    return parts;
}

function expandBoxShorthandForWebflow(css) {
    const decls = css.split(';');
    const out = [];
    for (let decl of decls) {
        decl = decl.trim();
        if (!decl) continue;
        const m = decl.match(/^(padding|margin)\s*:\s*(.+)$/);
        if (!m) { out.push(decl); continue; }
        const prop = m[1];
        const parts = splitValueTopLevel(m[2].trim());
        if (parts.length < 1 || parts.length > 4) { out.push(decl); continue; }
        let t, r, b, l;
        if (parts.length === 1) { t = r = b = l = parts[0]; }
        else if (parts.length === 2) { t = b = parts[0]; r = l = parts[1]; }
        else if (parts.length === 3) { t = parts[0]; r = l = parts[1]; b = parts[2]; }
        else { t = parts[0]; r = parts[1]; b = parts[2]; l = parts[3]; }
        out.push(prop + '-top: ' + t);
        out.push(prop + '-right: ' + r);
        out.push(prop + '-bottom: ' + b);
        out.push(prop + '-left: ' + l);
    }
    return out.join('; ') + (out.length ? ';' : '');
}

function mergeStyle(existing, addition) {
    if (!existing) return addition;
    const a = existing.trim().replace(/;$/, '');
    const b = addition.trim().replace(/;$/, '');
    return a + '; ' + b + ';';
}

function classifySelector(sel) {
    const single = sel.match(/^\.([a-zA-Z_][\w-]*)(:hover)?$/);
    if (single) return { kind: 'class', name: single[1], hover: !!single[2] };
    const combo = sel.match(/^\.([a-zA-Z_][\w-]*)\.([a-zA-Z_][\w-]*)(:hover)?$/);
    if (combo) return { kind: 'combo', base: combo[1], combo: combo[2], hover: !!combo[3] };
    return null;
}

const BREAKPOINTS = ['tiny', 'small', 'medium', 'large', 'xl', 'xxl'];

function matchBreakpoint(mediaText) {
    const text = mediaText.toLowerCase().replace(/\s/g, '');

    function toPx(numStr, unit) {
        const v = parseFloat(numStr);
        return (unit === 'rem' || unit === 'em') ? v * 16 : v;
    }

    const maxW = text.match(/max-width:(\d+(?:\.\d+)?)(px|rem|em)/);
    if (maxW) {
        const px = toPx(maxW[1], maxW[2]);
        if (px <= 480) return 'tiny';
        if (px <= 768) return 'small';
        if (px <= 992) return 'medium';
    }
    const minW = text.match(/min-width:(\d+(?:\.\d+)?)(px|rem|em)/);
    if (minW) {
        const px = toPx(minW[1], minW[2]);
        if (px >= 1920) return 'xxl';
        if (px >= 1440) return 'xl';
        if (px >= 1280) return 'large';
    }
    return null;
}

function parseCSS(cssText) {
    const result = {
        classes: {}, hovers: {},
        combos: {}, comboHovers: {},
        breakpoints: {},
        globalCss: ''
    };
    if (!cssText.trim()) return result;

    const styleEl = document.createElement('style');
    styleEl.textContent = cssText;
    document.head.appendChild(styleEl);

    const globalParts = [];

    function getBp(bp) {
        if (!result.breakpoints[bp]) result.breakpoints[bp] = { classes: {}, combos: {} };
        return result.breakpoints[bp];
    }

    function processStyleRule(rule, breakpoint) {
        const selectors = rule.selectorText.split(',').map(s => s.trim());
        const styleLess = escapeVarsForWebflow(
            normalizeTransformForWebflow(
                expandBoxShorthandForWebflow(rule.style.cssText)
            )
        );
        const classified = selectors.map(classifySelector);
        if (!classified.every(c => c !== null)) return false;

        for (const c of classified) {
            if (c.kind === 'class') {
                if (breakpoint) {
                    const bucket = getBp(breakpoint).classes;
                    bucket[c.name] = mergeStyle(bucket[c.name], styleLess);
                } else {
                    const bucket = c.hover ? result.hovers : result.classes;
                    bucket[c.name] = mergeStyle(bucket[c.name], styleLess);
                }
            } else {
                if (breakpoint) {
                    const bpCombos = getBp(breakpoint).combos;
                    if (!bpCombos[c.base]) bpCombos[c.base] = {};
                    bpCombos[c.base][c.combo] = mergeStyle(bpCombos[c.base][c.combo], styleLess);
                } else {
                    if (!result.combos[c.base]) result.combos[c.base] = {};
                    if (!result.comboHovers[c.base]) result.comboHovers[c.base] = {};
                    const bucket = c.hover ? result.comboHovers[c.base] : result.combos[c.base];
                    bucket[c.combo] = mergeStyle(bucket[c.combo], styleLess);
                }
            }
        }
        return true;
    }

    try {
        const rules = styleEl.sheet ? styleEl.sheet.cssRules : [];
        for (const rule of rules) {
            if (rule.type === CSSRule.STYLE_RULE) {
                if (!processStyleRule(rule, null)) globalParts.push(rule.cssText);
                continue;
            }
            if (rule.type === CSSRule.MEDIA_RULE) {
                const bp = matchBreakpoint(rule.media.mediaText);
                if (bp) {
                    for (const innerRule of rule.cssRules) {
                        if (innerRule.type !== CSSRule.STYLE_RULE) continue;
                        processStyleRule(innerRule, bp);
                    }
                    continue;
                }
                globalParts.push(rule.cssText);
                continue;
            }
            globalParts.push(rule.cssText);
        }
    } finally {
        document.head.removeChild(styleEl);
    }
    result.globalCss = globalParts.join('\n');
    return result;
}

const SAFE_BLOCK_TAGS = new Set([
    'div', 'section', 'main', 'header', 'footer', 'aside', 'nav', 'article'
]);

const IGNORE_TAGS = new Set([
    'script', 'style', 'link', 'meta', 'title', 'head', 'base'
]);

function mapTag(tag) {
    if (tag === 'body') return { wfType: 'Block', wfTag: 'div' };
    if (/^h[1-6]$/.test(tag)) return { wfType: 'Heading', wfTag: tag };
    if (tag === 'p') return { wfType: 'Paragraph', wfTag: 'p' };
    if (tag === 'a') return { wfType: 'Link', wfTag: 'a' };
    if (tag === 'img') return { wfType: 'Image', wfTag: 'img' };
    if (SAFE_BLOCK_TAGS.has(tag)) return { wfType: 'Block', wfTag: tag };
    return { wfType: 'DOM', wfTag: 'div' };
}

const SKIP_ATTRS_ALL = new Set(['class', 'style']);

function collectAllAttrs(el, skip) {
    const out = [];
    for (const attr of el.attributes) {
        if (skip.has(attr.name)) continue;
        out.push({ name: attr.name, value: attr.value });
    }
    return out;
}

function splitIdAndXattrs(el, skip) {
    let id = '';
    const xattr = [];
    for (const attr of el.attributes) {
        if (skip.has(attr.name)) continue;
        if (attr.name === 'id') { id = attr.value; continue; }
        xattr.push({ name: attr.name, value: attr.value });
    }
    return { id, xattr };
}

function buildData(htmlTag, wfType, wfTag, el, registerAsset) {
    if (wfType === 'Heading') {
        return { tag: wfTag, attr: {} };
    }
    if (wfType === 'Paragraph') {
        return null;
    }
    if (wfType === 'Link') {
        const href = el.getAttribute('href') || '#';
        return { tag: wfTag, link: { url: href, mode: 'url' }, attr: {} };
    }
    if (wfType === 'Image') {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || '';
        const widthAttr = el.getAttribute('width') || 'auto';
        const heightAttr = el.getAttribute('height') || 'auto';
        const loadingAttr = el.getAttribute('loading') || 'lazy';
        const parsed = parseImageUrl(src);
        if (parsed && registerAsset) {
            registerAsset(parsed, alt, widthAttr, heightAttr);
            const xattr = [];
            if (el.hasAttribute('loading')) xattr.push({ name: 'loading', value: loadingAttr });
            return {
                img: { id: parsed.assetId },
                srcsetDisabled: false,
                attr: {
                    src: src,
                    loading: loadingAttr,
                    width: widthAttr,
                    height: heightAttr,
                    alt: alt || '__wf_reserved_inherit',
                    id: ''
                },
                sizes: [],
                devlink: { runtimeProps: {}, slot: '' },
                displayName: '',
                xattr: xattr,
                search: { exclude: false },
                visibility: {
                    conditions: [],
                    keepInHtml: { tag: 'False', val: {} }
                }
            };
        }
        return {
            tag: wfTag,
            attr: { src: src, alt: alt }
        };
    }
    if (wfType === 'DOM') {
        return {
            tag: htmlTag,
            attributes: collectAllAttrs(el, SKIP_ATTRS_ALL),
            text: false,
            slot: '',
            visibility: {
                conditions: [],
                keepInHtml: { tag: 'False', val: {} }
            }
        };
    }
    const { id, xattr } = splitIdAndXattrs(el, SKIP_ATTRS_ALL);
    if (id || xattr.length > 0) {
        return {
            tag: wfTag,
            text: false,
            devlink: { runtimeProps: {}, slot: '' },
            displayName: '',
            attr: { id: id },
            xattr: xattr,
            search: { exclude: false },
            visibility: {
                conditions: [],
                keepInHtml: { tag: 'False', val: {} }
            }
        };
    }
    return { tag: wfTag, text: false };
}

function htmlToWebflow(htmlText, cssText, jsText) {
    const cssMap = parseCSS(cssText);
    const nodes = [];
    const styles = [];
    const assets = [];
    const assetMap = {};
    const classIdMap = {};
    const comboIdMap = {};

    function registerAsset(parsed, alt, widthAttr, heightAttr) {
        if (assetMap[parsed.assetId]) return assetMap[parsed.assetId];
        const w = parseInt(widthAttr, 10);
        const h = parseInt(heightAttr, 10);
        const now = new Date().toISOString();
        const asset = {
            cdnUrl: parsed.cdnUrl,
            siteId: parsed.siteId,
            width: isFinite(w) ? w : 0,
            isHD: false,
            height: isFinite(h) ? h : 0,
            fileName: parsed.fileName,
            createdOn: now,
            origFileName: parsed.origFileName,
            alt: alt || '',
            fileHash: '',
            variants: [],
            mimeType: parsed.mimeType,
            isFromWellKnownFolder: false,
            s3Url: parsed.cdnUrl,
            thumbUrl: parsed.cdnUrl,
            _id: parsed.assetId,
            updatedOn: now,
            fileSize: 0,
            localizedSettings: {}
        };
        assets.push(asset);
        assetMap[parsed.assetId] = asset;
        return asset;
    }

    function getStyleIdForClass(className) {
        if (classIdMap[className]) return classIdMap[className];
        const styleId = generateId();
        classIdMap[className] = styleId;

        const styleLess = cssMap.classes[className] || '';
        const variants = {};
        if (cssMap.hovers[className]) {
            variants.main_hover = { styleLess: cssMap.hovers[className] };
        }
        for (const bp of BREAKPOINTS) {
            const bpData = cssMap.breakpoints[bp];
            if (bpData && bpData.classes[className]) {
                variants[bp] = { styleLess: bpData.classes[className] };
            }
        }

        styles.push({
            _id: styleId,
            fake: false,
            type: 'class',
            name: className,
            namespace: '',
            comb: '',
            styleLess: styleLess,
            variants: variants,
            children: [],
            origin: null,
            selector: null
        });

        return styleId;
    }

    function getComboStyleId(baseClass, comboClass) {
        const key = baseClass + '|' + comboClass;
        if (comboIdMap[key]) return comboIdMap[key];

        const baseId = getStyleIdForClass(baseClass);
        const comboId = generateId();
        comboIdMap[key] = comboId;

        const styleLess = (cssMap.combos[baseClass] && cssMap.combos[baseClass][comboClass]) || '';
        const variants = {};
        const hoverLess = cssMap.comboHovers[baseClass] && cssMap.comboHovers[baseClass][comboClass];
        if (hoverLess) {
            variants.main_hover = { styleLess: hoverLess };
        }
        for (const bp of BREAKPOINTS) {
            const bpData = cssMap.breakpoints[bp];
            const bpCombo = bpData && bpData.combos[baseClass] && bpData.combos[baseClass][comboClass];
            if (bpCombo) {
                variants[bp] = { styleLess: bpCombo };
            }
        }

        styles.push({
            _id: comboId,
            fake: false,
            type: 'class',
            name: comboClass,
            namespace: '',
            comb: '&',
            styleLess: styleLess,
            variants: variants,
            children: [],
            origin: null,
            selector: null
        });

        const baseStyle = styles.find(s => s._id === baseId);
        if (baseStyle && !baseStyle.children.includes(comboId)) {
            baseStyle.children.push(comboId);
        }

        return comboId;
    }

    function resolveElementClassIds(el) {
        const list = Array.from(el.classList);
        if (list.length === 0) return [];
        const ids = [getStyleIdForClass(list[0])];
        const base = list[0];
        for (let i = 1; i < list.length; i++) {
            const cls = list[i];
            if (cssMap.combos[base] && cssMap.combos[base][cls] !== undefined) {
                ids.push(getComboStyleId(base, cls));
            } else {
                ids.push(getStyleIdForClass(cls));
            }
        }
        return ids;
    }

    function processElement(el) {
        const htmlTag = el.tagName.toLowerCase();
        if (IGNORE_TAGS.has(htmlTag)) return null;

        const nodeId = generateId();
        const { wfType, wfTag } = mapTag(htmlTag);
        const data = buildData(htmlTag, wfType, wfTag, el, registerAsset);

        const nodeObj = {
            _id: nodeId,
            type: wfType,
            tag: wfTag,
            classes: [],
            children: []
        };
        if (data !== null) nodeObj.data = data;
        nodes.push(nodeObj);

        nodeObj.classes = resolveElementClassIds(el);

        let hasElementChild = false;
        for (const child of el.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const childId = processElement(child);
                if (childId) {
                    hasElementChild = true;
                    nodeObj.children.push(childId);
                }
            }
        }

        if (!hasElementChild) {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (text) {
                const textId = generateId();
                nodeObj.children.push(textId);
                nodes.push({ _id: textId, text: true, v: text });
            }
        }

        return nodeId;
    }

    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const hasExplicitBody = /<body[\s>]/i.test(htmlText);
    const rootElements = hasExplicitBody ? [doc.body] : Array.from(doc.body.children);

    const rootIds = [];
    for (const el of rootElements) {
        const id = processElement(el);
        if (id) rootIds.push(id);
    }

    function pushHtmlEmbed(rawHtml, flags) {
        const embedId = generateId();
        const node = {
            _id: embedId,
            type: 'HtmlEmbed',
            tag: 'div',
            classes: [],
            children: [],
            v: rawHtml,
            data: {
                search: { exclude: true },
                embed: {
                    type: 'html',
                    meta: {
                        html: rawHtml,
                        div: !!flags.div,
                        iframe: !!flags.iframe,
                        script: !!flags.script,
                        compilable: !!flags.compilable
                    }
                },
                insideRTE: false,
                content: '',
                devlink: { runtimeProps: {}, slot: '' },
                displayName: '',
                attr: { id: '' },
                xattr: [],
                visibility: {
                    conditions: [],
                    keepInHtml: { tag: 'False', val: {} }
                }
            }
        };
        if (rootIds.length >= 1) {
            const rootNode = nodes.find(n => n._id === rootIds[0]);
            if (rootNode) rootNode.children.push(embedId);
        }
        nodes.push(node);
    }

    if (cssMap.globalCss.trim()) {
        const styleTag = '<' + 'style>\n' + cssMap.globalCss + '\n<' + '/style>';
        pushHtmlEmbed(styleTag, { script: false, div: false, iframe: false, compilable: false });
    }

    if (jsText.trim()) {
        const scriptTag = '<' + 'script>\n' + jsText.trim() + '\n<' + '/script>';
        pushHtmlEmbed(scriptTag, { script: true, div: false, iframe: false, compilable: false });
    }

    return {
        type: '@webflow/XscpData',
        payload: {
            nodes: nodes,
            styles: styles,
            assets: assets,
            ix1: [],
            ix2: { interactions: [], events: [], actionLists: [] }
        },
        meta: {
            unlinkedSymbolCount: 0,
            droppedLinks: 0,
            dynBindRemovedCount: 0,
            dynListBindRemovedCount: 0,
            paginationRemovedCount: 0
        }
    };
}

function copyJsonToClipboard(jsonString) {
    const handler = ev => {
        ev.clipboardData.setData('application/json', jsonString);
        ev.clipboardData.setData('text/plain', jsonString);
        ev.preventDefault();
    };
    document.addEventListener('copy', handler);

    const tmp = document.createElement('textarea');
    tmp.value = ' ';
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.appendChild(tmp);
    tmp.select();

    let success = false;
    try { success = document.execCommand('copy'); } catch (e) { success = false; }

    document.body.removeChild(tmp);
    document.removeEventListener('copy', handler);
    return success;
}

let lastJson = '';
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');

function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
    if (msg && !isError) {
        setTimeout(() => {
            if (statusEl.textContent === msg) statusEl.textContent = '';
        }, 4000);
    }
}

document.getElementById('btn-convert').addEventListener('click', () => {
    const html = document.getElementById('input-html').value;
    const css = document.getElementById('input-css').value;
    const js = document.getElementById('input-js').value;

    if (!html.trim()) {
        setStatus('Please fill the HTML tab first.', true);
        return;
    }

    try {
        const data = htmlToWebflow(html, css, js);
        lastJson = JSON.stringify(data, null, 2);
        outputEl.textContent = lastJson;

        const ok = copyJsonToClipboard(lastJson);
        const nodeCount = data.payload.nodes.length;
        const styleCount = data.payload.styles.length;
        if (ok) {
            setStatus('✓ ' + nodeCount + ' nodes, ' + styleCount + ' styles — copied. Paste in Webflow Designer.');
        } else {
            setStatus('Converted, but auto-copy failed. Use the Copy button.', true);
        }
    } catch (err) {
        console.error(err);
        setStatus('Error: ' + err.message, true);
    }
});

document.getElementById('btn-copy').addEventListener('click', () => {
    if (!lastJson) {
        setStatus('No output yet. Click Convert first.', true);
        return;
    }
    const ok = copyJsonToClipboard(lastJson);
    setStatus(ok ? '✓ JSON copied.' : 'Copy failed.', !ok);
});

document.getElementById('btn-clear').addEventListener('click', () => {
    if (!confirm('Clear all input and output?')) return;
    document.getElementById('input-html').value = '';
    document.getElementById('input-css').value = '';
    document.getElementById('input-js').value = '';
    outputEl.textContent = '';
    lastJson = '';
    setStatus('Cleared.');
});

document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-convert').click();
    }
});

