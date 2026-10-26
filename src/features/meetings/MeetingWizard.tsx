import { createId } from '../../domain/id';
import { ReminderSettings } from '../../components/ReminderSettings';
import successArt from '../../assets/meeting-success.png';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Attachment, Meeting } from '../../domain/models';
import { canCreateMeeting, canEditMeeting } from '../../domain/workflows';
import { previewService, type MeetingInput } from '../../data/previewService';
import { useUnsavedChanges, useWorkspace } from '../../app/WorkspaceContext';
import { Button, Card, Field, Stepper } from '../../components/ui';
import {
  ConfirmDialog,
  Denied,
  FilePicker,
  FormMessage,
  PageHeading,
  PeoplePicker,
  TextareaField,
} from '../../components/workflow-ui';
import { isoTime, SchedulePicker, type ScheduleValue } from './SchedulePicker';
const steps = ['기본 정보', '장소·시간', '참가자 선택', '자료·알람 설정'];

interface Draft {
  reminderMinutes: number[];
  title: string;
  description: string;
  participantIds: string[];
  material: Meeting['material'];
  schedule: ScheduleValue;
  step: number;
  requestId: string;
}
export function MeetingWizard({ editing = false }: { editing?: boolean }) {
  const { data, directory, rooms, run } = useWorkspace();
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = editing ? data.meetings.find((m) => m.id === id) : undefined;
  const topic = data.topics.find((t) => t.id === (editing ? existing?.topicId : id));
  const draftKey = `robot-butler:draft:v1:${data.user.id}:${editing ? 'edit' : 'new'}:${id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    const fallback: Draft = {
      reminderMinutes: existing?.reminderMinutes ?? [],
      title: existing?.title ?? '',
      description: existing?.description ?? '',
      participantIds: existing?.participantIds ?? [data.user.id],
      material: existing?.material ?? 'pending',
      schedule: {
        roomId:
          existing?.roomId ??
          rooms.find((r) => `${r.location} · ${r.name}` === existing?.room)?.id ??
          rooms[0].id,
        date: existing?.start.slice(0, 10) ?? data.now.slice(0, 10),
        startTime: existing?.start.slice(11, 16) ?? '',
        endTime: existing?.end.slice(11, 16) ?? '',
      },
      step: 0,
      requestId: createId(),
    };
    if (editing) return fallback;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return fallback;
      const parsed: Draft = JSON.parse(raw);
      return {
        ...fallback,
        ...parsed,
        material: parsed.material === 'uploaded' ? 'pending' : parsed.material,
      };
    } catch {
      return fallback;
    }
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [resultId, setResultId] = useState('');
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = Boolean(draft.title || draft.description || attachments.length);
  const allowLeave = useUnsavedChanges(dirty && !resultId);
  useEffect(() => {
    if (!editing && !resultId) {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        /* The form remains usable when session storage is unavailable. */
      }
    }
  }, [draft, draftKey, editing, resultId]);
  useEffect(() => {
    let active = true;
    // Return only unavailable slots, never the contents of another user's meeting.
    void previewService
      .availability(data.user.id, draft.schedule.roomId, draft.schedule.date, existing?.id)
      .then((slots) => {
        if (active) setUnavailable(slots);
      })
      .catch(() => {
        if (active) {
          setUnavailable([]);
          setError('가용 시간을 확인하지 못했어요. 저장할 때 예약을 다시 검사합니다.');
        }
      });
    return () => {
      active = false;
    };
  }, [data.user.id, draft.schedule.roomId, draft.schedule.date, existing?.id]);
  if (
    !topic ||
    !canCreateMeeting(topic, data.user.id) ||
    (editing &&
      (!existing ||
        !canEditMeeting(topic, existing, data.user.id) ||
        existing.cancelled ||
        existing.completed ||
        Date.parse(existing.end) <= Date.parse(data.now)))
  )
    return <Denied />;
  function patch(values: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...values }));
    setError('');
  }
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else navigate(`/topics/${topic!.id}`);
  }
  function next() {
    if (draft.step === 0 && (!draft.title.trim() || !draft.description.trim())) {
      setError('회의명과 회의 내용을 입력해주세요.');
      document
        .getElementById(!draft.title.trim() ? 'meeting-title' : 'meeting-description')
        ?.focus();
      return;
    }
    if (
      draft.step === 1 &&
      (!draft.schedule.date || !draft.schedule.startTime || !draft.schedule.endTime)
    ) {
      setError('회의 일자와 시작·종료 시간을 선택해주세요.');
      return;
    }
    setError('');
    patch({ step: draft.step + 1 });
    heading.current?.focus();
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    const input: MeetingInput = {
      reminderMinutes: draft.reminderMinutes,
      topicId: topic!.id,
      title: draft.title,
      description: draft.description,
      roomId: draft.schedule.roomId,
      start: isoTime(draft.schedule.date, draft.schedule.startTime),
      end: isoTime(draft.schedule.date, draft.schedule.endTime),
      participantIds: draft.participantIds.filter((personId) =>
        Object.hasOwn(topic!.roles, personId),
      ),
      material: editing ? existing!.material : draft.material,
      attachments: editing ? (existing!.attachments ?? []) : attachments,
    };
    try {
      const mid = await run(() =>
        editing
          ? previewService.updateMeeting(data.user.id, existing!.id, input, existing!.revision ?? 0)
          : previewService.createMeeting(data.user.id, input, draft.requestId),
      );
      sessionStorage.removeItem(draftKey);
      allowLeave();
      setResultId(mid);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
      if (e instanceof Error && e.message.includes('겹칩니다')) {
        setDraft((d) => ({ ...d, step: 1 }));
        try {
          setUnavailable(
            await previewService.availability(
              data.user.id,
              draft.schedule.roomId,
              draft.schedule.date,
              existing?.id,
            ),
          );
        } catch {
          /* The final transaction will still recheck conflicts. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const participantIds = draft.participantIds.filter((personId) =>
    Object.hasOwn(topic.roles, personId),
  );
  const selectedRoom = rooms.find((r) => r.id === draft.schedule.roomId)!;
  const wizardActions = (
    <>
      <FormMessage error={error} />
      <div className="form-actions wizard-actions">
        <Button variant="text" onClick={close} disabled={busy}>
          취소
        </Button>
        {draft.step > 0 ? (
          <Button
            variant="secondary"
            onClick={() => patch({ step: draft.step - 1 })}
            disabled={busy}
          >
            <ArrowLeft size={16} />
            이전
          </Button>
        ) : null}
        {draft.step < steps.length - 1 ? (
          <Button onClick={next}>
            다음
            <ArrowRight size={16} />
          </Button>
        ) : (
          <Button onClick={() => void save()} loading={busy}>
            {editing ? '변경 저장' : '회의 생성'}
          </Button>
        )}
      </div>
    </>
  );
  if (resultId)
    return (
      <div className="workflow-page">
        <PageHeading title={editing ? '회의 변경 결과' : '회의 생성 결과'} />
        <Card className="creation-result">
          <img className="success-illustration" src={successArt} alt="" />
          <h2>{editing ? '변경 내용을 저장했어요' : '회의 생성이 완료되었어요!'}</h2>
          <p>
            회의 일정이 저장되었습니다. 실제 회의실 예약은 미연결이며, 알림 결과는 아래에서
            확인하세요.
          </p>
          <div className="creation-result-grid">
            <dl>
              <dt className="result-section-title">회의 정보</dt>
              <dd />
              <dt>회의명</dt>
              <dd>{draft.title}</dd>
              <dt>일시</dt>
              <dd>
                {draft.schedule.date} {draft.schedule.startTime} – {draft.schedule.endTime}
              </dd>
              <dt>장소</dt>
              <dd>
                {selectedRoom.location} · {selectedRoom.name}
              </dd>
              <dt>참가자</dt>
              <dd>
                {participantIds.length}명 ·{' '}
                {directory
                  .filter((p) => participantIds.includes(p.id))
                  .map((p) => p.name)
                  .join(', ')}
              </dd>
              <dt>자료</dt>
              <dd>
                {draft.material === 'uploaded'
                  ? `${attachments.length}개 첨부`
                  : draft.material === 'pending'
                    ? '등록 예정'
                    : '자료 없음'}
              </dd>
            </dl>
            <div className="creation-delivery">
              <Card>
                <h3>
                  회의실 예약 완료 <span className="badge status-completed">데모</span>
                </h3>
                <p>
                  {selectedRoom.location} · {selectedRoom.name}
                </p>
                <p>
                  {draft.schedule.date} {draft.schedule.startTime} – {draft.schedule.endTime}
                </p>
              </Card>
            </div>
          </div>
          <div className="form-actions">
            <Link className="button button-secondary" to={`/topics/${topic.id}`}>
              토픽으로 이동
            </Link>
            <Link className="button button-primary" to={`/meetings/${resultId}`}>
              회의 상세 보기
              <ArrowRight size={18} />
            </Link>
          </div>
        </Card>
      </div>
    );
  return (
    <div
      className={`workflow-page wizard-page wizard-step-${draft.step}${editing ? ' wizard-editing' : ''}`}
    >
      <PageHeading
        title={editing ? '회의 수정' : '회의 만들기'}
        description="필요한 정보를 차근차근 정리하고 좋은 대화를 준비하세요."
        crumbs={[
          { label: '토픽', to: '/topics' },
          { label: topic.title, to: `/topics/${topic.id}` },
        ]}
      />
      <Stepper steps={steps} current={draft.step} />
      <div className="wizard-grid">
        <Card>
          <h2 ref={heading} tabIndex={-1} className="step-heading">
            {draft.step + 1}. {steps[draft.step]}
          </h2>
          {draft.step === 0 ? (
            <div className="stack-form">
              <Field
                label="회의명"
                id="meeting-title"
                required
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
              <TextareaField
                label="회의 내용·안건"
                id="meeting-description"
                required
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
          ) : draft.step === 1 ? (
            <SchedulePicker
              value={draft.schedule}
              onChange={(schedule) => patch({ schedule })}
              unavailable={unavailable}
              now={data.now}
              actions={wizardActions}
            />
          ) : draft.step === 2 ? (
            <PeoplePicker
              topicId={topic.id}
              label="참가자"
              people={directory.filter((person) => Object.hasOwn(topic.roles, person.id))}
              value={participantIds}
              onChange={(participantIds) => patch({ participantIds })}
              lockedIds={[editing ? existing!.creatorId : data.user.id]}
            />
          ) : (
            <div className="stack-form">
              <ReminderSettings
                value={draft.reminderMinutes}
                onChange={(reminderMinutes) => patch({ reminderMinutes })}
              />
              {editing ? (
                <p className="info-notice">자료는 회의 상세의 자료 탭에서 관리하세요.</p>
              ) : (
                <>
                  <fieldset className="material-options">
                    <legend>회의 자료</legend>
                    {[
                      ['uploaded', '자료 첨부'],
                      ['pending', '등록 예정'],
                      ['none', '자료 없음'],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="radio"
                          name="material"
                          checked={draft.material === key}
                          onChange={() => {
                            patch({ material: key as Meeting['material'] });
                            if (key !== 'uploaded') setAttachments([]);
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  {draft.material === 'uploaded' ? (
                    <FilePicker value={attachments} onChange={setAttachments} />
                  ) : null}
                  <p className="muted">미리보기에 직접 등록한 파일은 이 브라우저에 저장됩니다.</p>
                </>
              )}
            </div>
          )}
          {draft.step !== 1 ? wizardActions : null}
        </Card>
        <Card className="wizard-summary">
          <h2>미리보기</h2>
          <dl>
            <dt>회의명</dt>
            <dd>{draft.title || '아직 입력하지 않았어요'}</dd>
            <dt>회의 내용</dt>
            <dd>{draft.description || '회의의 주요 안건을 적어주세요.'}</dd>
            {editing && existing ? (
              <>
                <dt>변경 전 장소·시간</dt>
                <dd>
                  {existing.room}
                  <br />
                  {existing.start.slice(0, 10)} {existing.start.slice(11, 16)} –{' '}
                  {existing.end.slice(11, 16)}
                </dd>
              </>
            ) : null}
            <dt>{editing ? '변경 후 장소·시간' : '장소·시간'}</dt>
            <dd>
              {selectedRoom.location} · {selectedRoom.name}
              <br />
              {draft.schedule.date}
              <br />
              {draft.schedule.startTime
                ? `${draft.schedule.startTime} – ${draft.schedule.endTime}`
                : '시간 선택 전'}
            </dd>
            <dt>참가자</dt>
            <dd>
              {participantIds.length}명 ·{' '}
              {directory
                .filter((p) => participantIds.includes(p.id))
                .map((p) => p.name)
                .join(', ')}
            </dd>
            <dt>자료</dt>
            <dd>
              {draft.material === 'none'
                ? '자료 없음'
                : draft.material === 'uploaded'
                  ? `선택한 자료 ${attachments.length}개`
                  : '등록 예정'}
            </dd>
          </dl>
          <p className="detail-note">
            실제 회의실 예약은 미연결입니다. 저장 후 참가자별 알림 결과를 확인할 수 있습니다.
          </p>
        </Card>
      </div>
      {discard ? (
        <ConfirmDialog
          title="회의 작성을 닫을까요?"
          description="작성 중인 미리보기 초안을 지우고 토픽으로 돌아갑니다."
          actionLabel="초안 지우고 나가기"
          onClose={() => setDiscard(false)}
          onConfirm={() => {
            sessionStorage.removeItem(draftKey);
            allowLeave();
            navigate(`/topics/${topic.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
