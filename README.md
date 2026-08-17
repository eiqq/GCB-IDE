# GCB Skript

게임캐릭터배틀(파오캐) 서버의 Skript 코드용 VSCode 확장.

워크스페이스의 `.sk` 를 훑어 함수·이벤트·표현식·옵션 인덱스를 만든다. 경로를 하드코딩하지 않는다. 이름이 `-` 로 시작하는 파일·폴더는 Skript 가 로드하지 않으므로 인덱스에서도 뺀다.

> ### ⚠ 열어야 할 폴더
>
> ```
> <서버>\plugins\Skript\scripts
> ```
>
> 서버 폴더를 통째로 열지 말 것. 스크립트 폴더 밖의 `.sk` 는 Skript 자체 설정 파일(`config.sk`, `features.sk`)뿐이라 얻을 게 없고, 참고용 원본 사본이 같이 열려 있으면 **정의로 이동이 엉뚱한 사본으로 튄다**.
> 굳이 상위 폴더를 열어야 하면 `gcbSkript.exclude` 로 사본 경로를 빼라.

## 기능

- **자동완성** — 함수(인자가 스니펫으로 깔림), 현재 `on <이벤트>:` 에서 쓸 수 있는 표현식, 현재 파일 `options:` 의 `{@키}`
- **파라미터 힌트** — `(` `,` 에서 시그니처 팝업. 선언 뒤 `#주석`도 설명으로 표시
- **정의로 이동 / 호버** — 함수·표현식·옵션
- **구문 강조** — 함수명, 파라미터, 타입, `{_지역변수}`, `{전역변수}`, `{@옵션}`, 이벤트 표현식이 각각 다른 색. 인덱스에 없는 함수 호출은 색이 안 들어와 오타가 드러난다

표현식은 `set:` 블록 유무를 보고 읽기 전용인지 set 가능한지 구분해 보여준다. 별칭(`processed` = `skillEqualsProcessed` …)도 같이 잡는다.

## 설치

Releases 의 `.vsix` 를 받아 확장 탭 → `…` → **Install from VSIX...**

## 설정

| 키 | 기본값 | 설명 |
|---|---|---|
| `gcbSkript.roots` | `[]` | 워크스페이스 밖에서 추가로 인덱싱할 폴더 |
| `gcbSkript.exclude` | `**/node_modules/**` | 인덱싱 제외 glob. 참고용 사본이 같이 열려 있으면 여기서 뺀다 |
| `gcbSkript.showLocalFunctions` | `true` | 현재 파일의 `local function` 포함 (다른 파일 것은 안 나옴) |

저장하면 그 파일만 다시 인덱싱한다. 전체는 `Ctrl+Shift+P` → "GCB Skript: 함수 인덱스 다시 만들기".

## Notepad++

`npp/gen_npp.py` 가 N++ 용 파일을 만든다. N++ 가 기본 기능으로 해주는 것만 옮긴 버전이다 — **전역 함수 자동완성 + 파라미터 힌트 + 함수 목록 패널**.

```
python npp/gen_npp.py "<스크립트 폴더>" <출력폴더>
```

출력 폴더에 같이 생기는 `install.bat` 을 **우클릭 → 관리자 권한으로 실행**하면 아래를 알아서 복사한다. N++ 설치 경로가 다르면 파일 안 `NPP` 만 고치면 된다.

| 만들어지는 파일 | 복사할 곳 |
|---|---|
| `userDefineLangs/Skript.udl.xml` | `%APPDATA%\Notepad++\userDefineLangs\` |
| `autoCompletion/Skript.xml` | `<N++설치폴더>\autoCompletion\` (관리자) |
| `functionList/Skript.xml`, `functionList/overrideMap.xml` | `<N++설치폴더>\functionList\` (관리자) |

UDL 은 `.sk` 를 물리기 위한 것뿐이고 색은 지정하지 않는다(전부 `colorStyle="0"`).
설치 폴더 파일은 N++ 업데이트 때 덮어써지니 그때 스크립트를 다시 돌리면 된다.

이벤트별 표현식과 파일별 `{@옵션}` 은 넣지 않았다. N++ 는 커서가 어느 블록·어느 파일에 있는지 모르는 평면 목록이라 넣으면 틀린 항목이 섞인다. 같은 파일 안의 옵션 이름은 N++ 기본 단어 자동완성이 잡아준다.

## 빌드

npm 불필요. 파이썬만 있으면 된다.

```
node test.js "<스크립트 폴더>"    # 파싱 검증
python pack.py                     # .vsix 생성
```

소스 폴더를 `.vscode\extensions` 안에 두면 설치할 때 지워지니 주의.
