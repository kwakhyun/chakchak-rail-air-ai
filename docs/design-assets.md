# 착착 전용 브랜드 이미지

모든 최종 자산은 built-in ImageGen으로 만든 뒤 `#FF00FF` 크로마키 배경을 제거해 투명 PNG로 저장했습니다. 공식 코레일·인천국제공항공사 로고나 상표는 사용하지 않았습니다.

## 대표 로고

- UI 최적화본: `public/assets/brand/chakchak-logo-app.png`
- 생성 원본: `public/assets/brand/chakchak-logo-v2.png`
- 크로마키 원본: `tmp/imagegen/chakchak-logo-v2-chroma.png`

프롬프트:

> Use case: logo-brand. Asset type: 착착 서비스 대표 로고 마크. 하나의 연속 경로가 항공기 형태에서 철도·좌석 형태로 자연스럽게 이어지는 중앙 정렬 기하학 심벌. 공공교통의 신뢰감과 친근함, 작은 크기에서도 판독 가능한 단순 실루엣. `#005BAC`, `#00727A`, `#F3B700`, 흰색만 사용. 텍스트·공식 로고·상표 유사성·그라데이션·3D·그림자·워터마크 금지. 균일한 `#FF00FF` 크로마키 배경과 넉넉한 여백.

검증: RGBA, 네 모서리 완전 투명, 지정 4색만 사용. 앱용 파일은 원본을 중앙 크롭해 512×512로 최적화했습니다.

## 메뉴 아이콘 4종

- `public/assets/icons/menu-journey-app.png`: 비행기→연결 경로→열차
- `public/assets/icons/menu-routes-app.png`: 열차·시계·다음 화살표
- `public/assets/icons/menu-travel-app.png`: 달력·목적지 핀
- `public/assets/icons/menu-about-app.png`: 정보 표시·데이터 연결점
- 생성 원본: 같은 폴더의 `menu-*.png`
- 크로마키 원본: `tmp/imagegen/menu-*-chroma.png`

공통 프롬프트:

> Use case: stylized-concept. Asset type: 착착 UI 메뉴 아이콘. 굵고 둥근 flat vector-like filled/outline hybrid 스타일, 작은 크기에서도 명확한 단일 실루엣. `#005BAC`, `#00727A`, `#F3B700`, 흰색. 균일한 `#FF00FF` 크로마키 배경. 텍스트·공식 로고·상표·그라데이션·3D·그림자·워터마크 금지.

각 아이콘은 별도 생성했습니다. 최종 파일은 256px 이하로 크롭·리사이즈했으며, 네 모서리 투명·마젠타 잔색 0픽셀을 확인했습니다.

## Rail × Air 여정 일러스트

- 최종: `public/assets/illustrations/rail-air-journey.png`
- 크로마키 원본: `tmp/imagegen/rail-air-journey-chroma.png`

프롬프트:

> Use case: stylized-concept. Asset type: 착착 UI 카드용 가로 여정 안내 일러스트. 왼쪽에서 오른쪽으로 공항 건물과 관제탑, 착륙하는 여객기, 공항철도, 고속열차, 목적지 핀과 여행가방을 하나의 부드러운 경로로 연결. 친근한 공공교통 안내용 flat vector-like 2D, 굵고 둥근 선, 넉넉한 여백. `#005BAC`, `#00727A`, `#F3B700`, 옅은 하늘색과 흰색. 인물·텍스트·공식 로고·상표·그라데이션·3D·그림자·워터마크 금지. 균일한 `#FF00FF` 크로마키 배경.

검증: 2172×724 RGBA, 네 모서리 투명, 피사체가 좌→우 순서로 명확하며 마젠타 잔색과 그림자가 없습니다.
