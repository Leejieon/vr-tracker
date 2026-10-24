# VR Tracker

라오어 VR(밸류 리밸런싱) 매매 기록을 위한 PWA입니다. 아이폰 Safari에서 열고 공유 → **홈 화면에 추가**하면 앱처럼 쓸 수 있습니다.

- 기록은 기기 안(localStorage)에만 저장됩니다. 설정 → 백업과 복원에서 가끔 파일로 내보내 두세요.
- 서버나 계정이 없고, 매매 데이터는 이 저장소에 올라가지 않습니다.

## 기능

| 상태 | 기능 |
|---|---|
| ✅ | 사이클별 V값·밴드·Pool 계산, 예약주문 계산표, 체크리스트 |
| ✅ | 매매 기록, 사이클 요약, 차트, 백업·복원, 오프라인 실행 |
| ✅ | TQQQ 현재가 표시와 사이클 종가 자동 조회 (Twelve Data, 실패했을 때만 직접 입력) |
| ✅ | `캘린더에 추가`로 2주 반복 일정 내보내기 (`.ics`, 오전 8시 알림) |
| ✅ | `Obsidian으로 보내기`로 사이클 기록을 볼트 저장소에 노트로 저장 (GitHub API) |

## 구조

| 파일 | 내용 |
|---|---|
| `index.html` | 페이지 뼈대, 서비스 워커 등록 |
| `js/core.js` | V값·밴드·Pool·예약주문 계산 (순수 함수) |
| `js/net.js` | 시세 조회(Twelve Data)와 볼트 저장소 쓰기(GitHub Contents API) |
| `js/app.js` | 화면과 저장 |
| `css/app.css` | 스타일 (라이트/다크) |
| `sw.js` | 오프라인 캐시. 앱 파일을 바꾸면 `VERSION`을 올리세요 |
| `manifest.webmanifest`, `icons/` | 홈 화면 앱 정보와 아이콘 |

## 연결 설정

시세 조회와 Obsidian 보내기는 설정 탭의 **연결** 카드에서 키를 입력해야 동작합니다. 키 없이도 직접 입력으로 모두 쓸 수 있습니다.

- **Twelve Data API 키**: twelvedata.com에 가입한 뒤 대시보드의 API key를 복사해 붙여 넣습니다.
- **GitHub 토큰**: GitHub의 Settings → Developer settings → Fine-grained tokens에서 새 토큰을 만듭니다. 저장소는 `obsidian-vault` 하나만 선택하고, Repository permissions의 Contents를 Read and write로 설정합니다.
- 저장소 이름, 브랜치, 폴더는 같은 카드에서 바꿀 수 있습니다. 노트는 `wiki/투자/VR/사이클 기록/VR 사이클 N.md`로 저장됩니다.
- 키와 토큰은 이 기기에만 저장되며 백업 파일에는 들어가지 않습니다. 기기를 바꾸면 다시 입력해야 합니다.
- `캘린더에 추가`로 받은 `.ics`는 가져올 때 네이버 캘린더를 골라 주세요.

## 개발

```sh
python3 -m http.server 8000   # http://localhost:8000
node --test test/*.test.js    # 계산 로직 테스트
```

`main` 브랜치에 push하면 GitHub Pages로 배포됩니다.

설계 문서, 구현 계획, 개발 기록은 이 저장소가 아니라 개인 Obsidian 위키(`wiki/개발/VR Tracker/`)에 둡니다. `docs/`는 `.gitignore`에 들어 있습니다.
