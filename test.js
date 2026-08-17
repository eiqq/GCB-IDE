// node test.js [스크립트폴더]  — vscode 없이 파싱 로직만 검증
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const stub = { SemanticTokensLegend: class { constructor(t, m) { this.t = t; this.m = m; } } };
const orig = Module._load;
Module._load = (req, ...a) => (req === 'vscode' ? stub : orig.call(Module, req, ...a));

const { parseText, callAt, mask, signature, isDisabled, optionEntries } = require('./extension.js');

// --- options 블록 (항상 파일 로컬)
const OPT = ['options:', '\tID: 파오캐', '\tcast: 3', '\tchar.name: 요우무', '',
	'\tcooldown: 12', 'on load:', '\tset {x} to 1', '\tnotanoption: 9'];
assert.deepStrictEqual(
	optionEntries(OPT).map(o => o.key + '=' + o.value),
	['ID=파오캐', 'cast=3', 'char.name=요우무', 'cooldown=12'],
	'빈 줄은 넘기고 들여쓰기 안 된 줄에서 블록 종료'
);
assert.strictEqual(optionEntries(OPT)[1].line, 2, '옵션 줄 번호');

// --- Skript 가 로드하지 않는 - 접두 파일/폴더
assert.strictEqual(isDisabled('C:\\s\\b\\event\\-한글날.sk'), true);
assert.strictEqual(isDisabled('C:\\s\\-disabled\\a.sk'), true, '폴더 이름이 - 로 시작해도 제외');
assert.strictEqual(isDisabled('C:\\s\\z\\1\\main-weapon.sk'), false, '중간의 - 는 상관없음');

// --- 함수 파싱
assert.deepStrictEqual(
	parseText('function 데미지(a: entity,v: entity,d:number) :: boolean: #공격자,피해자,데미지', 'u').funcs[0],
	{
		name: '데미지', params: [{ name: 'a', type: 'entity' }, { name: 'v', type: 'entity' }, { name: 'd', type: 'number' }],
		ret: 'boolean', doc: '공격자,피해자,데미지', uri: 'u', line: 0, local: false
	}
);
assert.strictEqual(parseText('local function condition(p:player):', 'u').funcs[0].local, true);
assert.strictEqual(parseText('function Stat_applyBase(p:player,i:integer):', 'u').funcs[0].ret, '');
assert.strictEqual(parseText('\tfunction NotTopLevel(a:x):', 'u').funcs.length, 0);
assert.deepStrictEqual(
	parseText(['options:', '\tID: 파오캐', '\tid: youmu_longsword', '',
		'function {@id}_createItem() :: item:',
		'function {@ID}{@없는옵션}(e:entity):'].join('\n'), 'u').funcs.map(e => e.name),
	['youmu_longsword_createItem', '파오캐{@없는옵션}'],
	'옵션으로 조립된 함수명 전개'
);

// --- 이벤트/표현식 파싱
const EV = [
	'expression (holder|skillholder):',
	'\tusable in:',
	'\t\tcustom event "trycastskillevent"',
	'\treturn type: integer',
	'\tset:',
	'\t\tevent.setData("skillholder", change value)',
	'\tget:',
	'\t\treturn event.getData("skillholder")',
	'',
	'expression castedskill:',
	'\tusable in:',
	'\t\tcustom event "trycastskillevent"',
	'\t\tcustom event "docastskillevent"',
	'\treturn type: string',
	'\tget:',
	'\t\treturn event.getData("castedskill")',
	'',
	'expression (RADIAN|RAD):',
	'\treturn type: number',
	'\tget:',
	'\t\treturn 0.017453292519943295',
	'',
	'event "trycastskillevent":',
	'\tpattern: trycastskill'
].join('\n');
const p = parseText(EV, 'u');
assert.deepStrictEqual(p.events, [{ id: 'trycastskillevent', pattern: 'trycastskill', uri: 'u', line: 22 }]);
assert.strictEqual(p.exprs.length, 3);
assert.deepStrictEqual(p.exprs[0].names, ['holder', 'skillholder']);
assert.strictEqual(p.exprs[0].settable, true, 'set: 블록 있으면 settable');
assert.strictEqual(p.exprs[1].settable, false);
assert.deepStrictEqual(p.exprs[1].events, ['trycastskillevent', 'docastskillevent']);
assert.deepStrictEqual(p.exprs[2].events, [], 'usable in 없으면 전역 표현식');
assert.strictEqual(p.exprs[2].ret, 'number');
assert.strictEqual(
	parseText('expression %entity%\'s loc:\n\treturn type: location', 'u').exprs.length, 0,
	'%entity% 같은 패턴형 이름은 식별자가 아니라 건너뜀'
);

// --- 텍스트 유틸
assert.strictEqual(mask('send "a#b" to p').indexOf('#'), -1, '문자열 안 # 은 주석 아님');
assert.strictEqual(mask('데미지(1) # 주석').trimEnd(), '데미지(1)');
assert.deepStrictEqual(callAt('\t데미지({_p},{_t},', 15), { name: '데미지', arg: 2 });
assert.deepStrictEqual(callAt('\tSound_playAt(loc(1,2),', 23), { name: 'Sound_playAt', arg: 1 }, '중첩 호출 안 쉼표는 안 셈');
assert.strictEqual(callAt('\tset {_x} to 1', 13), null);
assert.strictEqual(callAt('\tfoo("a,b",', 11).arg, 1, '문자열 안 쉼표는 인자 구분 아님');
assert.strictEqual(
	signature({ name: 'f', params: [{ name: 'p', type: 'player' }], ret: 'text' }),
	'function f(p: player) :: text'
);

// --- 실제 코퍼스
const root = process.argv[2];
if (root) {
	const files = [];
	(function w(d) {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const q = path.join(d, e.name);
			if (e.isDirectory()) w(q); else if (e.name.endsWith('.sk')) files.push(q);
		}
	})(root);

	let g = 0, l = 0, ev = 0, ex = 0, exScoped = 0;
	const names = new Set();
	for (const f of files) {
		const r = parseText(fs.readFileSync(f, 'utf8'), f);
		for (const e of r.funcs) { if (e.local) l++; else { g++; names.add(e.name); } }
		ev += r.events.length;
		ex += r.exprs.length;
		exScoped += r.exprs.filter(e => e.events.length).length;
	}
	console.log(`파일 ${files.length} | 전역함수 ${g} (고유 ${names.size}) | local ${l} | 이벤트 ${ev} | 표현식 ${ex} (이벤트전용 ${exScoped})`);
	assert.strictEqual(g, 2413, '전역 함수 수');
	assert.strictEqual(l, 890, 'local 함수 수');
	assert.ok(ev >= 35, '이벤트 정의 수: ' + ev);
	assert.ok(exScoped >= 60, '이벤트 전용 표현식 수: ' + exScoped);
}

console.log('ok');
