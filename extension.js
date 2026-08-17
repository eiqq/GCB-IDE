const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const NAME = '(?:[A-Za-z0-9_가-힣]|\\{@[A-Za-z0-9_.가-힣]+\\})+';
const FUNC_RE = new RegExp('^(local\\s+)?function\\s+(' + NAME + ')\\s*\\(([^)]*)\\)\\s*(?:::\\s*([A-Za-z0-9_]+))?\\s*:\\s*(?:#\\s*(.*))?$');
const EXPR_RE = /^expression\s+(.+?)\s*:\s*$/;
const EVENT_RE = /^event\s+"(.+?)"\s*:\s*$/;
const ON_RE = /^on\s+(.+?)\s*:\s*(?:#.*)?$/;
const CALL_RE = /([A-Za-z0-9_가-힣]+)\s*\(/g;
const IDENT = /^[A-Za-z0-9_가-힣-]+$/;
const WORD = /[A-Za-z0-9_가-힣]/;

/** @type {Map<string,object>} 전역 함수 */
const globals = new Map();
/** @type {Map<string,Map<string,object>>} 파일 -> local 함수 */
const locals = new Map();
/** @type {Map<string,object>} 커스텀 이벤트 id -> {pattern,uri,line} */
const events = new Map();
/** @type {object[]} 이벤트 표현식 */
let exprs = [];

// ---------------------------------------------------------------- 파싱

function parseParams(raw) {
	if (!raw.trim()) return [];
	return raw.split(',').map(p => {
		const i = p.indexOf(':');
		return i < 0 ? { name: p.trim(), type: '' }
			: { name: p.slice(0, i).trim(), type: p.slice(i + 1).trim() };
	});
}

/** 파일 상단 options: 블록. 옵션은 항상 그 .sk 파일 안에서만 유효하다. */
function optionEntries(lines) {
	const out = [];
	let inBlock = false;
	for (let n = 0; n < lines.length; n++) {
		const L = lines[n];
		if (/^options:/.test(L)) { inBlock = true; continue; }
		if (!inBlock) continue;
		if (/^\S/.test(L)) break;
		const m = /^\s+([A-Za-z0-9_.가-힣]+)\s*:\s*(.*?)\s*$/.exec(L);
		if (m) out.push({ key: m[1], value: m[2], line: n });
	}
	return out;
}

/** 함수명·이벤트명이 {@id} 로 조립되는 경우가 있어 치환용 맵이 필요하다. */
function parseOptions(lines) {
	const o = {};
	for (const e of optionEntries(lines)) o[e.key] = e.value;
	return o;
}

function expand(s, opts) {
	for (let i = 0; i < 2 && s.includes('{@'); i++) {
		s = s.replace(/\{@([A-Za-z0-9_.가-힣]+)\}/g, (all, k) => (k in opts ? opts[k] : all));
	}
	return s;
}

/** n 번째 줄에서 시작하는 들여쓰기 블록의 본문을 통째로 돌려준다. */
function blockAt(lines, n) {
	const body = [];
	for (let i = n + 1; i < lines.length; i++) {
		if (lines[i].trim() && !/^\s/.test(lines[i])) break;
		body.push(lines[i]);
	}
	return body.join('\n');
}

function parseText(text, uriString) {
	const lines = text.split(/\r?\n/);
	const opts = parseOptions(lines);
	const out = { funcs: [], events: [], exprs: [] };

	for (let n = 0; n < lines.length; n++) {
		const L = lines[n];

		const f = FUNC_RE.exec(L);
		if (f) {
			out.funcs.push({
				name: expand(f[2], opts), params: parseParams(f[3]), ret: f[4] || '',
				doc: (f[5] || '').trim(), uri: uriString, line: n, local: !!f[1]
			});
			continue;
		}

		const ev = EVENT_RE.exec(L);
		if (ev) {
			const body = blockAt(lines, n);
			const p = /^\s*pattern:\s*(.+?)\s*$/m.exec(body);
			if (p) out.events.push({ id: expand(ev[1], opts), pattern: expand(p[1], opts), uri: uriString, line: n });
			continue;
		}

		const ex = EXPR_RE.exec(L);
		if (ex) {
			const body = blockAt(lines, n);
			const names = ex[1].replace(/^\((.*)\)$/, '$1').split('|')
				.map(s => s.trim()).filter(s => IDENT.test(s));
			if (!names.length) continue;
			const evIds = [];
			const re = /custom event\s+"(.+?)"/g;
			let m;
			while ((m = re.exec(body))) evIds.push(expand(m[1], opts));
			const rt = /^\s*return type:\s*(.+?)\s*$/m.exec(body);
			out.exprs.push({
				names, events: evIds, ret: rt ? rt[1] : '',
				settable: /^\s*set:\s*$/m.test(body), uri: uriString, line: n
			});
			continue;
		}
	}
	return out;
}

// ---------------------------------------------------------------- 인덱스

function store(parsed, uriString) {
	for (const [k, v] of globals) if (v.uri === uriString) globals.delete(k);
	events.forEach((v, k) => { if (v.uri === uriString) events.delete(k); });
	exprs = exprs.filter(e => e.uri !== uriString);

	const localMap = new Map();
	locals.set(uriString, localMap);
	for (const e of parsed.funcs) {
		if (e.local) localMap.set(e.name, e);
		else if (!globals.has(e.name)) globals.set(e.name, e);
	}
	for (const e of parsed.events) events.set(e.id.toLowerCase(), e);
	exprs.push(...parsed.exprs);
}

/** Skript 는 이름이 - 로 시작하는 파일·폴더를 로드하지 않는다. 인덱스도 빼야 없는 함수를 제안하지 않는다. */
function isDisabled(p) {
	return p.split(/[\\/]/).some(seg => seg.startsWith('-'));
}

function* walk(dir) {
	let ents;
	try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
	for (const e of ents) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.name.endsWith('.sk')) yield p;
	}
}

async function reindex() {
	globals.clear(); locals.clear(); events.clear(); exprs = [];
	const cfg = vscode.workspace.getConfiguration('gcbSkript');
	const seen = new Set();
	const add = (fsPath, uriString) => {
		if (seen.has(uriString) || isDisabled(fsPath)) return;
		seen.add(uriString);
		try { store(parseText(fs.readFileSync(fsPath, 'utf8'), uriString), uriString); } catch (_) { /* 읽기 실패는 무시 */ }
	};
	for (const f of await vscode.workspace.findFiles('**/*.sk', cfg.get('exclude', '**/node_modules/**'))) {
		add(f.fsPath, f.toString());
	}
	for (const root of cfg.get('roots', [])) {
		for (const p of walk(root)) add(p, vscode.Uri.file(p).toString());
	}
	return { funcs: globals.size, events: events.size, exprs: exprs.length };
}

// ---------------------------------------------------------------- 조회

function lookupFunc(name, doc) {
	const l = doc && locals.get(doc.uri.toString());
	return (l && l.get(name)) || globals.get(name);
}

/** 커서가 들어있는 `on <이벤트>:` 블록의 이벤트 패턴. */
function enclosingEvent(doc, line) {
	for (let n = line; n >= 0; n--) {
		const L = doc.lineAt(n).text;
		if (!L.trim() || /^\s/.test(L)) continue;
		const m = ON_RE.exec(L);
		if (!m) return null;
		return m[1].replace(/\s+with priority\s+\S+\s*$/i, '').trim().toLowerCase();
	}
	return null;
}

/** 해당 이벤트 패턴에서 쓸 수 있는 표현식들. */
function exprsFor(pattern) {
	if (!pattern) return [];
	const ids = [];
	for (const [id, e] of events) {
		const p = e.pattern.trim().toLowerCase();
		if (p === pattern || pattern.split(/\s+/)[0] === p) ids.push(id);
	}
	if (!ids.length) return [];
	return exprs.filter(e => e.events.some(x => ids.includes(x.toLowerCase())));
}

/** 어디서나 쓸 수 있는 표현식 (usable in 이 없는 것). */
function globalExprs() {
	return exprs.filter(e => !e.events.length);
}

function signature(e) {
	const ps = e.params.map(p => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ');
	return `function ${e.name}(${ps})${e.ret ? ' :: ' + e.ret : ''}`;
}

function exprLabel(e, name) {
	return `${name}${e.ret ? ' :: ' + e.ret : ''}${e.settable ? ' (set 가능)' : ' (읽기 전용)'}`;
}

// ---------------------------------------------------------------- 텍스트 유틸

/** 문자열/주석을 공백으로 지워 열 위치를 보존한 라인. */
function mask(line) {
	let out = '', inStr = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') { inStr = !inStr; out += '"'; }
		else if (inStr) out += ' ';
		else if (c === '#') { out += ' '.repeat(line.length - i); break; }
		else out += c;
	}
	return out;
}

/** 커서가 들어있는 함수 호출의 이름과 인자 인덱스. */
function callAt(line, col) {
	const s = mask(line).slice(0, col);
	let depth = 0;
	for (let i = s.length - 1; i >= 0; i--) {
		if (s[i] === ')') depth++;
		else if (s[i] === '(') {
			if (depth === 0) {
				let j = i;
				while (j > 0 && WORD.test(s[j - 1])) j--;
				const name = s.slice(j, i);
				if (!name) return null;
				let arg = 0, d = 0;
				for (let k = i + 1; k < s.length; k++) {
					if (s[k] === '(') d++;
					else if (s[k] === ')') d--;
					else if (s[k] === ',' && d === 0) arg++;
				}
				return { name, arg };
			}
			depth--;
		}
	}
	return null;
}

// ---------------------------------------------------------------- 색상

const LEGEND = new vscode.SemanticTokensLegend(
	['function', 'parameter', 'variable', 'macro', 'property'], []
);

function buildTokens(doc) {
	const b = new vscode.SemanticTokensBuilder(LEGEND);
	const lines = doc.getText().split(/\r?\n/);
	const localMap = locals.get(doc.uri.toString()) || new Map();

	let params = new Set();
	let evNames = new Set();

	for (let n = 0; n < lines.length; n++) {
		const raw = lines[n];

		const f = FUNC_RE.exec(raw);
		if (f) {
			params = new Set(parseParams(f[3]).map(p => p.name));
			evNames = new Set();
			b.push(n, raw.indexOf(f[2], 8), f[2].length, 0);
			const open = raw.indexOf('(') + 1;
			const P = /([A-Za-z0-9_가-힣]+)\s*:/g;
			let p;
			while ((p = P.exec(f[3]))) b.push(n, open + p.index, p[1].length, 1);
			continue;
		}
		const on = raw.length && !/^\s/.test(raw) && ON_RE.exec(raw);
		if (on) {
			params = new Set();
			const pat = on[1].replace(/\s+with priority\s+\S+\s*$/i, '').trim().toLowerCase();
			evNames = new Set();
			for (const e of exprsFor(pat)) for (const nm of e.names) evNames.add(nm);
			continue;
		}
		if (raw.length && !/^\s/.test(raw)) { params = new Set(); evNames = new Set(); }

		const line = mask(raw);
		const toks = [];

		CALL_RE.lastIndex = 0;
		let c;
		while ((c = CALL_RE.exec(line))) {
			if (localMap.has(c[1]) || globals.has(c[1])) toks.push([c.index, c[1].length, 0]);
		}

		if (evNames.size) {
			const W = /[A-Za-z0-9_가-힣-]+/g;
			let w;
			while ((w = W.exec(line))) {
				if (evNames.has(w[0])) toks.push([w.index, w[0].length, 4]);
			}
		}

		const VAR = /\{(@?)(_?)([^}]*)\}/g;
		let v;
		while ((v = VAR.exec(line))) {
			if (v[1] === '@') { toks.push([v.index, v[0].length, 3]); continue; }
			const base = v[3].split(/[:.]/)[0];
			toks.push([v.index, v[0].length, v[2] === '_' && params.has(base) ? 1 : 2]);
		}

		// SemanticTokensBuilder 는 위치 오름차순으로만 push 해야 한다
		toks.sort((a, z) => a[0] - z[0]);
		let end = -1;
		for (const t of toks) {
			if (t[0] < end) continue;   // 겹치는 토큰은 앞의 것만
			b.push(n, t[0], t[1], t[2]);
			end = t[0] + t[1];
		}
	}
	return b.build();
}

// ---------------------------------------------------------------- 확장

function activate(context) {
	const sel = { language: 'skript' };
	const sub = context.subscriptions;

	reindex().then(r =>
		console.log(`[gcb-skript] 함수 ${r.funcs} / 이벤트 ${r.events} / 표현식 ${r.exprs}`));

	sub.push(vscode.commands.registerCommand('gcbSkript.reindex', async () => {
		const r = await reindex();
		vscode.window.showInformationMessage(
			`GCB Skript: 함수 ${r.funcs}개, 이벤트 ${r.events}개, 표현식 ${r.exprs}개 인덱싱 완료`);
	}));

	sub.push(vscode.workspace.onDidSaveTextDocument(d => {
		if (d.languageId === 'skript') store(parseText(d.getText(), d.uri.toString()), d.uri.toString());
	}));

	sub.push(vscode.languages.registerCompletionItemProvider(sel, {
		provideCompletionItems(doc, pos) {
			const items = [];

			// 옵션 — 항상 현재 파일 것만. `{` 이나 `{@` 를 이미 쳤으면 그 자리부터 갈아끼운다.
			const before = doc.lineAt(pos.line).text.slice(0, pos.character);
			const open = /\{@?[A-Za-z0-9_.가-힣]*$/.exec(before);
			const optRange = open
				? new vscode.Range(pos.line, before.length - open[0].length, pos.line, pos.character)
				: undefined;
			for (const o of optionEntries(doc.getText().split(/\r?\n/))) {
				const it = new vscode.CompletionItem(`{@${o.key}}`, vscode.CompletionItemKind.Constant);
				it.detail = o.value;
				it.documentation = new vscode.MarkdownString(`이 파일의 옵션 · ${o.line + 1}번째 줄`);
				it.filterText = optRange ? `{@${o.key}}` : o.key;
				it.insertText = `{@${o.key}}`;
				if (optRange) it.range = optRange;
				it.sortText = '0' + o.key;
				items.push(it);
			}

			// 현재 이벤트에서 쓸 수 있는 표현식을 맨 위로
			const seenExpr = new Set();
			const pushExpr = (e, sortPrefix, note) => {
				for (const nm of e.names) {
					if (seenExpr.has(nm)) continue;
					seenExpr.add(nm);
					const it = new vscode.CompletionItem(nm,
						e.settable ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Constant);
					it.detail = exprLabel(e, nm);
					it.documentation = new vscode.MarkdownString(
						`${note}\n\n${e.names.length > 1 ? '별칭: ' + e.names.join(', ') + '\n\n' : ''}` +
						`_${path.basename(vscode.Uri.parse(e.uri).fsPath)}:${e.line + 1}_`);
					it.sortText = sortPrefix + nm;
					items.push(it);
				}
			};
			const pat = enclosingEvent(doc, pos.line);
			for (const e of exprsFor(pat)) pushExpr(e, '1', `\`on ${pat}\` 이벤트 표현식`);
			for (const e of globalExprs()) pushExpr(e, '3', '전역 표현식');

			// 함수
			const cfg = vscode.workspace.getConfiguration('gcbSkript');
			const pool = [...globals.values()];
			if (cfg.get('showLocalFunctions', true)) {
				pool.push(...(locals.get(doc.uri.toString()) || new Map()).values());
			}
			for (const e of pool) {
				const it = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Function);
				it.detail = signature(e);
				it.documentation = new vscode.MarkdownString(
					(e.doc ? e.doc + '\n\n' : '') + (e.local ? '_local_ · ' : '') +
					path.basename(vscode.Uri.parse(e.uri).fsPath));
				it.insertText = new vscode.SnippetString(
					e.name + '(' + e.params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ') + ')');
				it.command = { command: 'editor.action.triggerParameterHints', title: '' };
				it.sortText = '2' + e.name;
				items.push(it);
			}
			return items;
		}
	}, '{', '@'));

	sub.push(vscode.languages.registerSignatureHelpProvider(sel, {
		provideSignatureHelp(doc, pos) {
			const c = callAt(doc.lineAt(pos.line).text, pos.character);
			if (!c) return null;
			const e = lookupFunc(c.name, doc);
			if (!e) return null;
			const si = new vscode.SignatureInformation(signature(e), e.doc);
			si.parameters = e.params.map(p =>
				new vscode.ParameterInformation(p.type ? `${p.name}: ${p.type}` : p.name));
			const help = new vscode.SignatureHelp();
			help.signatures = [si];
			help.activeSignature = 0;
			help.activeParameter = Math.min(c.arg, Math.max(0, e.params.length - 1));
			return help;
		}
	}, '(', ','));

	const resolve = (doc, pos) => {
		const or = doc.getWordRangeAtPosition(pos, /\{@[A-Za-z0-9_.가-힣]+\}/);
		if (or) {
			const key = doc.getText(or).slice(2, -1);
			const o = optionEntries(doc.getText().split(/\r?\n/)).find(x => x.key === key);
			if (o) return { range: or, option: o, uri: doc.uri.toString() };
		}
		const r = doc.getWordRangeAtPosition(pos, /[A-Za-z0-9_가-힣-]+/);
		if (!r) return null;
		const w = doc.getText(r);
		const f = lookupFunc(w, doc);
		if (f) return { range: r, func: f };
		const pool = exprsFor(enclosingEvent(doc, pos.line)).concat(globalExprs());
		const e = pool.find(x => x.names.includes(w));
		return e ? { range: r, expr: e, name: w } : null;
	};

	sub.push(vscode.languages.registerHoverProvider(sel, {
		provideHover(doc, pos) {
			const hit = resolve(doc, pos);
			if (!hit) return null;
			const md = new vscode.MarkdownString();
			if (hit.option) {
				md.appendCodeblock(`{@${hit.option.key}} = ${hit.option.value}`, 'skript');
				md.appendMarkdown(`\n_이 파일의 옵션 · ${hit.option.line + 1}번째 줄_`);
				return new vscode.Hover(md, hit.range);
			}
			if (hit.func) {
				md.appendCodeblock(signature(hit.func), 'skript');
				if (hit.func.doc) md.appendMarkdown(`\n${hit.func.doc}\n`);
			} else {
				md.appendCodeblock(exprLabel(hit.expr, hit.name), 'skript');
				if (hit.expr.names.length > 1) md.appendMarkdown(`\n별칭: ${hit.expr.names.join(', ')}\n`);
			}
			const t = hit.func || hit.expr;
			md.appendMarkdown(`\n_${vscode.workspace.asRelativePath(vscode.Uri.parse(t.uri))}:${t.line + 1}_`);
			return new vscode.Hover(md, hit.range);
		}
	}));

	sub.push(vscode.languages.registerDefinitionProvider(sel, {
		provideDefinition(doc, pos) {
			const hit = resolve(doc, pos);
			if (!hit) return null;
			if (hit.option) return new vscode.Location(doc.uri, new vscode.Position(hit.option.line, 0));
			const t = hit.func || hit.expr;
			return new vscode.Location(vscode.Uri.parse(t.uri), new vscode.Position(t.line, 0));
		}
	}));

	sub.push(vscode.languages.registerDocumentSemanticTokensProvider(sel, {
		provideDocumentSemanticTokens: buildTokens
	}, LEGEND));
}

module.exports = {
	activate, deactivate() {},
	parseText, parseParams, parseOptions, optionEntries, callAt, mask, signature, blockAt, isDisabled
};
