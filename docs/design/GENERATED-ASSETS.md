# 생성 에셋 기록

사용자가 2026-10-20 “리소스나 아이콘이 없으면 에셋을 만들어서 넣을 것”을 명시했다. 내장 imagegen 도구를 사용했으며 CLI/API 대체 경로는 사용하지 않았다. 생성본은 원본 픽셀을 그대로 복사한 자산이 아니다. 두 결과의 투명 배경과 실제 브라우저 표시를 확인했다.

## 사이드바 얼굴

파일: `src/assets/mascot-head-v2.png`. 참고: `docs/design/assets/01-brand-and-entry.png`.

프롬프트:
> Use case: background-extraction. Create a high-resolution transparent head-only brand icon from the supplied approved Robot Butler character (white rounded face, small white round ears with vivid blue bands, black shiny oval eyes, blue nose, smiling mouth, round pink cheeks). Reference is the face in the upper left login character and upper right home character. Isolate ONLY the entire head and both ears, no neck/body/clothing/hand, no text. Preserve the same character identity, soft polished 3D style, frontal symmetrical pose. Generous transparent padding, all edges and ears fully visible. Add only a subtle soft gray shadow below head, no solid background or shape. Suitable for crisp 64px sidebar logo. Do not generate a UI or board.

## 생성 성공 일러스트

파일: `src/assets/meeting-success.png`. 참고: `docs/design/assets/03-meeting-creation.png`.

프롬프트:
> Use case: stylized-concept. Generate only the success decorative illustration seen in bottom-right panel of reference: large vivid royal blue circular medallion with simple white check mark, centered over a very pale blue soft rounded cloud-like organic background with a handful of tiny blue, yellow and purple diamond sparkles. Wide 3:1 composition, complete edges with generous transparent margins, polished soft 3D depth as in reference, restrained colors. NO text, NO UI, NO characters, NO extra objects. Transparent outside cloud. Asset for meeting created success heading. Reproduce reference illustration placement and style.

## 코드 기반 장식

`src/assets/notification-decoration.svg`: 알림 벨·톱니·블루/민트 배경을 SVG로 제작했다. 로그인 원형/타원 장식은 CSS로 제작했다. 빈 홈의 구름은 기존 보드 표시 영역을 넓혀 양쪽이 잘리지 않도록 수정했다. 홈 인사말은 기존 투명 복원 캐릭터를 확대해 제목 뒤에 배치했다.
