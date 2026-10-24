# VR 장부

라오어 VR(밸류 리밸런싱) 매매 기록을 위한 PWA입니다. 아이폰 Safari에서 열고 공유 → **홈 화면에 추가**하면 앱처럼 쓸 수 있습니다.

- 기록은 기기 안(localStorage)에만 저장됩니다. 설정 → 백업과 복원에서 가끔 파일로 내보내 두세요.
- 서버나 계정이 없고, 매매 데이터는 이 저장소에 올라가지 않습니다.

## 기능

| 상태 | 기능 |
|---|---|
| ✅ | 사이클별 V값·밴드·Pool 계산, 예약주문 계산표, 체크리스트 |
| ✅ | 매매 기록, 사이클 요약, 차트, 백업·복원, 오프라인 실행 |
| 🚧 | TQQQ 현재가와 사이클 종가 자동 조회 (Twelve Data, 실패 시에만 직접 입력) |
| 🚧 | 2주 반복 일정 캘린더 등록 (`.ics`, 오전 8시 알림) |
| 🚧 | 끝난 사이클 기록을 Obsidian 볼트로 보내기 (GitHub API) |

## 구조

| 파일 | 내용 |
|---|---|
| `index.html` | 페이지 뼈대, 서비스 워커 등록 |
| `js/core.js` | V값·밴드·Pool·예약주문 계산 (순수 함수) |
| `js/app.js` | 화면과 저장 |
| `css/app.css` | 스타일 (라이트/다크) |
| `sw.js` | 오프라인 캐시. 앱 파일을 바꾸면 `VERSION`을 올리세요 |
| `manifest.webmanifest`, `icons/` | 홈 화면 앱 정보와 아이콘 |

## 개발

```sh
python3 -m http.server 8000   # http://localhost:8000
node --test test/*.test.js    # 계산 로직 테스트
```

`main` 브랜치에 push하면 GitHub Pages로 배포됩니다.

설계 문서, 구현 계획, 개발 기록은 이 저장소가 아니라 개인 Obsidian 위키(`wiki/개발/VR 장부/`)에 둡니다. `docs/`는 `.gitignore`에 들어 있습니다.
