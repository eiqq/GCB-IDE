# -*- coding: utf-8 -*-
"""Notepad++ 용 Skript 지원 파일 생성.

  python gen_npp.py <스크립트폴더> [출력폴더]

만드는 것 (N++ 가 기본 기능으로 해주는 것만):
  autoCompletion/Skript.xml      전역 function 자동완성 + 파라미터 힌트
  functionList/Skript.xml        현재 파일 함수 목록 패널
  functionList/overrideMap.xml   위 파서를 Skript UDL 에 연결 (설치본에 한 줄 추가한 사본)
  userDefineLangs/Skript.udl.xml .sk 를 물릴 최소 UDL (색 지정 없음)

N++ 는 커서 문맥을 모르므로 이벤트별 표현식·파일별 옵션은 넣지 않는다.
파일 내 옵션 이름은 N++ 기본 단어 자동완성이 알아서 잡는다.
"""
import os, re, sys
from xml.sax.saxutils import escape, quoteattr

FUNC = re.compile(r'^function\s+([^\s(]+)\s*\(([^)]*)\)\s*(?:::\s*(\w+))?\s*:\s*(?:#\s*(.*))?$')
OPT = re.compile(r'^\s+([A-Za-z0-9_.가-힣]+)\s*:\s*(.*?)\s*$')
LANG = 'Skript'

UDL_KEYWORDS = [
    'Comments', 'Numbers, prefix1', 'Numbers, prefix2', 'Numbers, extras1',
    'Numbers, extras2', 'Numbers, suffix1', 'Numbers, suffix2', 'Numbers, range',
    'Operators1', 'Operators2',
    'Folders in code1, open', 'Folders in code1, middle', 'Folders in code1, close',
    'Folders in code2, open', 'Folders in code2, middle', 'Folders in code2, close',
    'Folders in comment, open', 'Folders in comment, middle', 'Folders in comment, close',
    'Keywords1', 'Keywords2', 'Keywords3', 'Keywords4',
    'Keywords5', 'Keywords6', 'Keywords7', 'Keywords8', 'Delimiters',
]
UDL_STYLES = [
    'DEFAULT', 'COMMENTS', 'LINE COMMENTS', 'NUMBERS',
    'KEYWORDS1', 'KEYWORDS2', 'KEYWORDS3', 'KEYWORDS4',
    'KEYWORDS5', 'KEYWORDS6', 'KEYWORDS7', 'KEYWORDS8', 'OPERATORS',
    'FOLDER IN CODE1', 'FOLDER IN CODE2', 'FOLDER IN COMMENT',
    'DELIMITERS1', 'DELIMITERS2', 'DELIMITERS3', 'DELIMITERS4',
    'DELIMITERS5', 'DELIMITERS6', 'DELIMITERS7', 'DELIMITERS8',
]


def options_of(lines):
    o, inb = {}, False
    for L in lines:
        if L.startswith('options:'):
            inb = True
            continue
        if not inb:
            continue
        if L[:1] not in ('', ' ', '\t'):
            break
        m = OPT.match(L)
        if m:
            o[m.group(1)] = m.group(2)
    return o


def expand(s, opts):
    for _ in range(2):
        if '{@' not in s:
            break
        s = re.sub(r'\{@([A-Za-z0-9_.가-힣]+)\}', lambda m: opts.get(m.group(1), m.group(0)), s)
    return s


def collect(root):
    """전역 function 만. local 은 파일 스코프라 평면 목록에 섞으면 거짓말이 된다."""
    found = {}
    for dirpath, dirnames, filenames in os.walk(root):
        # Skript 는 - 로 시작하는 파일·폴더를 로드하지 않는다
        dirnames[:] = [d for d in dirnames if not d.startswith('-')]
        for fn in filenames:
            if not fn.endswith('.sk') or fn.startswith('-'):
                continue
            lines = open(os.path.join(dirpath, fn), encoding='utf-8', errors='replace').read().split('\n')
            opts = options_of(lines)
            for L in lines:
                m = FUNC.match(L.rstrip())
                if not m:
                    continue
                name = expand(m.group(1), opts)
                if '{@' in name or name in found:
                    continue
                params = [p.strip() for p in m.group(2).split(',') if p.strip()]
                found[name] = (params, m.group(3) or '', (m.group(4) or '').strip())
    return found


def write_autocomplete(path, funcs):
    out = ['<?xml version="1.0" encoding="UTF-8" ?>', '<NotepadPlus>',
           '\t<AutoComplete language="%s">' % LANG,
           '\t\t<Environment ignoreCase="yes" startFunc="(" stopFunc=")" '
           'paramSeparator="," terminal=";" additionalWordChar="." />']
    for name in sorted(funcs, key=str.lower):
        params, ret, doc = funcs[name]
        out.append('\t\t<KeyWord name=%s func="yes">' % quoteattr(name))
        head = '\t\t\t<Overload retVal=%s' % quoteattr(ret)
        if doc:
            head += ' descr=%s' % quoteattr(doc)
        out.append(head + ('>' if params else ' />'))
        for p in params:
            out.append('\t\t\t\t<Param name=%s />' % quoteattr(p))
        if params:
            out.append('\t\t\t</Overload>')
        out.append('\t\t</KeyWord>')
    out += ['\t</AutoComplete>', '</NotepadPlus>', '']
    open(path, 'w', encoding='utf-8').write('\n'.join(out))


FUNCLIST = '''<?xml version="1.0" encoding="UTF-8" ?>
<NotepadPlus>
\t<functionList>
\t\t<parser displayName="Skript" id="skript_syntax" commentExpr="(?m-s:#.*$)">
\t\t\t<function mainExpr="(?m-i)^(?:local\\s+)?function\\s+[^\\s(]+\\s*\\([^)]*\\)">
\t\t\t\t<functionName>
\t\t\t\t\t<nameExpr expr="function\\s+\\K[^\\s(]+" />
\t\t\t\t</functionName>
\t\t\t</function>
\t\t</parser>
\t</functionList>
</NotepadPlus>
'''


def write_udl(path):
    out = ['<?xml version="1.0" encoding="UTF-8" ?>', '<NotepadPlus>',
           '\t<UserLang name="%s" ext="sk" udlVersion="2.1">' % LANG, '\t\t<Settings>',
           '\t\t\t<Global caseIgnored="yes" allowFoldOfComments="no" foldCompact="no" '
           'forcePureLC="0" decimalSeparator="0" />',
           '\t\t\t<Prefix ' + ' '.join('Keywords%d="no"' % i for i in range(1, 9)) + ' />',
           '\t\t</Settings>', '\t\t<KeywordLists>']
    out += ['\t\t\t<Keywords name="%s"></Keywords>' % escape(k) for k in UDL_KEYWORDS]
    out += ['\t\t</KeywordLists>', '\t\t<Styles>']
    # colorStyle="0" = 전경·배경 둘 다 적용 안 함 → 색을 건드리지 않는다
    out += ['\t\t\t<WordsStyle name="%s" fgColor="000000" bgColor="FFFFFF" colorStyle="0" '
            'fontName="" fontStyle="0" nesting="0" />' % s for s in UDL_STYLES]
    out += ['\t\t</Styles>', '\t</UserLang>', '</NotepadPlus>', '']
    open(path, 'w', encoding='utf-8').write('\n'.join(out))


def write_overridemap(path, installed):
    line = '\t\t\t<association id="Skript.xml" userDefinedLangName="Skript" />'
    if os.path.exists(installed):
        s = open(installed, encoding='utf-8').read()
        if 'userDefinedLangName="Skript"' in s:
            return False
        s = s.replace('\t\t</associationMap>', line + '\n\t\t</associationMap>', 1)
    else:
        s = ('<?xml version="1.0" encoding="UTF-8" ?>\n<NotepadPlus>\n\t<functionList>\n'
             '\t\t<associationMap>\n' + line + '\n\t\t</associationMap>\n'
             '\t</functionList>\n</NotepadPlus>\n')
    open(path, 'w', encoding='utf-8').write(s)
    return True


# %~dp0 로 자기 폴더를 참조한다. 배치 파일에 한글 경로를 박으면 코드페이지 때문에 깨진다.
INSTALL_BAT = '''@echo off
set NPP=C:\\Program Files\\Notepad++
if not exist "%NPP%\\notepad++.exe" (
	echo Notepad++ not found at "%NPP%" - edit NPP in this file.
	pause & exit /b 1
)
copy /Y "%~dp0autoCompletion\\Skript.xml" "%NPP%\\autoCompletion\\"
copy /Y "%~dp0functionList\\Skript.xml" "%NPP%\\functionList\\"
copy /Y "%~dp0functionList\\overrideMap.xml" "%NPP%\\functionList\\"
copy /Y "%~dp0userDefineLangs\\Skript.udl.xml" "%APPDATA%\\Notepad++\\userDefineLangs\\"
echo.
echo Done. Restart Notepad++.
pause
'''


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    root = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
    for d in ('autoCompletion', 'functionList', 'userDefineLangs'):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    funcs = collect(root)
    write_autocomplete(os.path.join(out, 'autoCompletion', LANG + '.xml'), funcs)
    open(os.path.join(out, 'functionList', LANG + '.xml'), 'w', encoding='utf-8').write(FUNCLIST)
    write_udl(os.path.join(out, 'userDefineLangs', LANG + '.udl.xml'))
    changed = write_overridemap(
        os.path.join(out, 'functionList', 'overrideMap.xml'),
        r'C:\Program Files\Notepad++\functionList\overrideMap.xml')

    open(os.path.join(out, 'install.bat'), 'w', encoding='ascii', newline='\r\n').write(INSTALL_BAT)

    print('전역 함수 %d개 -> %s' % (len(funcs), out))
    print('  install.bat 을 우클릭 > 관리자 권한으로 실행')
    if not changed:
        print('  (overrideMap.xml 은 이미 Skript 연결이 있어 다시 만들지 않음)')
