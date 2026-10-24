import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

// Keep the report tied to the rectangles used by the browser capture test.
const source = await readFile('tests/design-reference.spec.ts', 'utf8');
const frames = [...source.matchAll(/'([^']+)': \['([^']+)', (\d+), (\d+), (\d+), (\d+)\]/g)];
if (frames.length !== 19) throw new Error('Expected 19 approved screen reference rectangles.');
const out = 'docs/qa/desktop-reference';
await mkdir(out, { recursive: true });
const notes = {
  '01-login':
    '연한 파란 배경과 곡선 장식을 복원했습니다. 로그인 캐릭터는 기존 원본 영역을 사용합니다. 실제 회사 로그인은 미연결입니다.',
  '02-home':
    '사이드바는 새 고해상도 얼굴 에셋이며 홈 캐릭터는 확대해 제목 뒤에 배치했습니다. 달력은 SVG, 프로필은 이니셜이고 정확한 폰트 차이는 남습니다.',
  '03-search':
    '필터별 색상과 회의·멤버·업데이트·참가자를 표시합니다. 멤버 수는 조회 가능한 회의의 고유 참가자 수입니다.',
  '04-empty':
    '회의가 없는 중앙 안내와 기존 토픽만 표시합니다. 원본 빈 화면의 예시 토픽 숫자는 복사하지 않습니다.',
  '05-topics':
    '원본 4개 대신 실제 3개 토픽입니다. 관리자만 표시하며 멤버 공개 범위는 미정입니다. 사진·아이콘·글꼴이 다릅니다.',
  '06-topic-create':
    '직원 사진과 정확한 아이콘이 없습니다. 실제 검색·선택 목록으로 구성하며 임의 글자 수·관리자 최대 5명 제한을 복사하지 않습니다.',
  '07-topic-detail':
    '히스토리에 참가자·당시 주최자·회의 요약을 연결했습니다. 비교 캡처는 기존 테스트 사례이며 실제 DB에는 추가한 사례별 이력이 표시됩니다.',
  '08-topic-settings':
    '정보 수정·관리자 추가 폼을 유지합니다. 멤버 목록 공개·위임·삭제가 미정이므로 원본과 구조 차이가 큽니다.',
  '09-meeting-info':
    '패키지가 허용한 하나의 회의 내용·안건 입력입니다. 원본의 별도 드래그 안건 목록은 구현되지 않았습니다. 입력 단계는 3개입니다.',
  '10-reservation':
    '원본 회의실 사진이 없어 기존 위치 안내를 유지합니다. 하루 시간대를 가로 스크롤로 선택합니다. 실제 충돌이 없을 때 빨간 경고를 표시하지 않습니다.',
  '11-participants':
    '사진 카드 대신 기존 이름·부서 선택 UI입니다. 자료와 역할은 실제 미리보기 데이터 기준입니다.',
  '12-created':
    '성공 일러스트를 생성해 적용했습니다. 회의 정보와 데모 예약 저장을 표시하며 실제 메시지는 미전송입니다.',
  '13-meeting-detail':
    '실제 길찾기 원본이 없어 안내 영역으로 남아 있습니다. 안건은 텍스트이며 사진은 이니셜입니다.',
  '14-materials':
    '자료 목록만 캡처했습니다. 원본의 옆 수정 패널 대신 기존 3단계 수정 화면을 유지하며, 자료 변경 권한은 생성자에게만 있습니다.',
  '15-summary':
    '본문 입력 3영역이며 원본의 할 일별 체크 항목과 다릅니다. 필드와 완료 버튼은 실제 저장 흐름에 연결됩니다.',
  '16-cancel':
    '명세에 따라 예정 회의에서 취소창을 엽니다. 원본의 완료 화면 위 취소창 혼합은 복제하지 않습니다.',
  '17-notifications':
    '장식 SVG와 Mattermost·카카오톡 예정 카드를 적용했습니다. 필수 알림은 잠금, 선택 알림은 스위치이며 방해금지는 요청에 따라 제거했습니다.',
  '19-admin':
    '실제로 저장된 미전송 기록만 표시합니다. 원본의 발송 성공/실패·재시도 예시를 만들지 않습니다.',
  '20-rooms':
    '조회·선택은 가능하며 실제 회의실 변경은 미정입니다. 원본과 달리 수정 폼 대신 읽기 전용 정보입니다.',
};
const sections = [];
for (const [, id, board, x, y, w, h] of frames) {
  await copyFile(`test-results/desktop-reference/${id}-actual.png`, `${out}/${id}.png`);
  sections.push(
    `<section id="${id}"><h2>${id} <small>${Number(w) * 2} × ${Number(h) * 2}</small></h2><p>${notes[id]}</p><div class="pair" style="--ratio:${w}/${h}"><figure><figcaption>ZIP 원본 · 앱 영역 2배</figcaption><div class="frame"><img class="board" src="../../design/assets/${board}.png" style="width:${(1536 / Number(w)) * 100}%;left:${(-Number(x) / Number(w)) * 100}%;top:${(-Number(y) / Number(h)) * 100}%" alt="${id} 원본 시안"></div></figure><figure><figcaption>실제 브라우저 캡처</figcaption><div class="frame"><img class="actual" src="${id}.png" alt="${id} 실제 구현"></div></figure></div></section>`,
  );
}
await writeFile(
  `${out}/index.html`,
  `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로봇집사 데스크톱 시안 비교</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px;font:16px/1.6 system-ui,sans-serif;color:#17213d;background:#f5f6fa}header{max-width:1200px;margin:0 auto 32px}h1{font-size:28px}h2{font-size:20px;margin:0}small{font-weight:400;color:#626d88}section{background:white;border:1px solid #dce2ec;padding:20px;margin-bottom:28px;border-radius:12px}section>p{font-size:14px;color:#56627a}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}figcaption{font-weight:700;font-size:14px;margin-bottom:8px}.frame{position:relative;aspect-ratio:var(--ratio);overflow:hidden;outline:1px solid #dce2ec;background:white}.frame img{position:absolute;max-width:none;display:block}.actual{width:100%;height:100%}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#0866ff}button{padding:10px 18px;cursor:pointer}body.overlay .pair{display:block;position:relative}body.overlay figure:nth-child(2){position:absolute;inset:0;opacity:.5}body.overlay figure:nth-child(2) figcaption{visibility:hidden}@media(max-width:800px){.pair{grid-template-columns:1fr}body{padding:12px}}
</style><header><h1>로봇집사 데스크톱 시안 비교</h1><p>같은 앱 영역 크기의 원본과 실제 캡처입니다. 원본은 합성 PNG를 2배로 펼친 것으로 원래 Figma 화면 크기는 제공되지 않았습니다. 글꼴·개별 이미지가 없어 픽셀 단위 완전 일치는 아직 아닙니다.</p><p>18 서비스 알림함은 패키지의 선택 제안으로 이번 구현에 포함하지 않았습니다.</p><button id="overlay">반투명 겹쳐 보기 / 나란히 보기</button><nav>${frames.map(([, id]) => `<a href="#${id}">${id}</a>`).join('')}</nav></header>${sections.join('\n')}<script>document.querySelector('#overlay').onclick=()=>document.body.classList.toggle('overlay');</script></html>`,
);
console.log(`Saved ${frames.length} screenshot comparisons to ${out}/index.html`);
