import { MeetingDelivery } from '../../components/MeetingDelivery';
import { useState } from 'react';
import { RoomDirections } from '../../components/RoomDirections';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  TriangleAlert,
  CalendarDays,
  Download,
  FilePenLine,
  FileText,
  MapPin,
  Pencil,
  X,
} from 'lucide-react';
import type { Attachment } from '../../domain/models';
import { fullDate, meetingStatus, time } from '../../domain/selectors';
import { canEditMeeting, canEditSummary } from '../../domain/workflows';
import { previewService } from '../../data/previewService';
import { useUnsavedChanges, useWorkspace } from '../../app/WorkspaceContext';
import { AvatarGroup, Button, Card, EmptyState, Modal, StatusBadge } from '../../components/ui';
import {
  ConfirmDialog,
  Denied,
  FilePicker,
  FormMessage,
  PageHeading,
  TextareaField,
} from '../../components/workflow-ui';
export function MeetingDetail() {
  const { data, run, rooms } = useWorkspace();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const meeting = data.meetings.find((m) => m.id === id);
  const topic = data.topics.find((t) => t.id === meeting?.topicId);
  const tab = params.get('tab') ?? 'info';
  const [cancel, setCancel] = useState(false);
  const [cancelAcknowledged, setCancelAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [replacement, setReplacement] = useState<{ file: File; id: string }>();
  useUnsavedChanges(files.length > 0 || Boolean(replacement));
  if (!meeting || !topic) return <Denied />;
  const status = meetingStatus(meeting, data.now);
  const editable = canEditMeeting(topic, meeting, data.user.id) && status === 'scheduled';
  const canUpload = meeting.creatorId === data.user.id && !meeting.completed && !meeting.cancelled;
  const canSummarize = canEditSummary(meeting, data.user.id, data.now);
  async function cancelMeeting() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await run(() =>
        previewService.cancelMeeting(data.user.id, meeting!.id, meeting!.revision ?? 0),
      );
      setCancel(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '취소하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (busy || !files.length) return;
    setBusy(true);
    setError('');
    try {
      await run(() =>
        previewService.addFiles(data.user.id, meeting!.id, files, meeting!.revision ?? 0),
      );
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '자료를 저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function download(fileId: string) {
    setError('');
    try {
      const file = await previewService.download(data.user.id, meeting!.id, fileId);
      const url = URL.createObjectURL(file.blob!);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '다운로드하지 못했어요.');
    }
  }
  async function replace(file: File, attachmentId: string) {
    setBusy(true);
    setError('');
    try {
      await run(() =>
        previewService.replaceFile(
          data.user.id,
          meeting!.id,
          attachmentId,
          {
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type || '파일',
            size: file.size,
            authorId: data.user.id,
            updatedAt: data.now,
            blob: file,
          },
          meeting!.revision ?? 0,
        ),
      );
      setReplacement(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : '교체하지 못했어요. 원본은 유지됩니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workflow-page meeting-detail-page">
      {location.state?.fromSearch ? (
        <button
          className="back-link"
          onClick={() => {
            navigate(-1);
          }}
        >
          <ArrowLeft size={16} />
          검색 결과로 돌아가기
        </button>
      ) : null}
      <PageHeading
        title={meeting.title}
        crumbs={[
          { label: 'Topic', to: '/topics' },
          { label: topic.title, to: `/topics/${topic.id}` },
        ]}
        actions={
          editable ? (
            <>
              <Link to={`/meetings/${id}/edit`} className="button button-secondary">
                <Pencil size={16} />
                회의 수정
              </Link>
              <Button
                variant="secondary"
                className="cancel-meeting-button"
                onClick={() => {
                  setError('');
                  setCancel(true);
                }}
              >
                <X size={16} />
                회의 취소
              </Button>
            </>
          ) : canSummarize ? (
            <Link className="button button-primary" to={`/meetings/${id}/summary`}>
              <FilePenLine size={18} />
              {meeting.summary ? '요약 수정' : '요약 작성'}
            </Link>
          ) : null
        }
      />
      <div className="meeting-header-meta">
        <StatusBadge status={status} />
        <span>
          <CalendarDays size={17} />
          {fullDate(meeting.start)} {time(meeting.start)} – {time(meeting.end)}
        </span>
        <span>
          <MapPin size={17} />
          {meeting.room}
        </span>
      </div>
      <div className="participant-strip">
        <AvatarGroup
          people={meeting.participantIds.flatMap(
            (pid) => data.people.find((p) => p.id === pid) ?? [],
          )}
          max={6}
        />
        <span className="muted">
          생성자 · {data.people.find((p) => p.id === meeting.creatorId)?.name ?? '회의 생성자'} ·
          참석자 {meeting.participantIds.length}명
        </span>
      </div>
      <MeetingDelivery meetingId={meeting.id} revision={meeting.revision} />
      {meeting.cancelled ? (
        <p className="form-error" role="status">
          취소된 회의입니다. 미리보기 예약은 해제되었습니다. 참가자 알림 결과를 확인해주세요.
        </p>
      ) : null}
      <div className="line-tabs" role="group" aria-label="회의 상세 탭">
        {[
          ['info', '회의 정보'],
          ['files', `자료 ${meeting.files.length}`],
          ['summary', '요약'],
        ].map(([key, label]) => (
          <button key={key} aria-pressed={tab === key} onClick={() => setParams({ tab: key })}>
            {label}
          </button>
        ))}
      </div>
      <FormMessage error={!cancel ? error : undefined} />
      {tab === 'info' ? (
        <div className="meeting-content-grid">
          <Card>
            <h2>회의 안건</h2>
            <p className="preserve-lines">{meeting.description}</p>
            <h3>참석자</h3>
            <div className="participant-list">
              {meeting.participantIds.map((pid) => {
                const p = data.people.find((p) => p.id === pid);
                return p ? (
                  <span key={pid}>
                    <strong>{p.name}</strong>
                    <small>{p.team}</small>
                  </span>
                ) : null;
              })}
            </div>
          </Card>
          {status === 'scheduled' ? (
            <Card>
              <RoomDirections
                room={rooms.find(
                  (room) =>
                    room.id === meeting.roomId ||
                    `${room.location} · ${room.name}` === meeting.room,
                )}
              />
            </Card>
          ) : (
            <Card>
              <h2>회의 진행 상태</h2>
              <StatusBadge status={status} />
              <p className="muted">
                {status === 'summary-needed'
                  ? '회의가 종료되었어요. 참가자 모두 요약을 작성할 수 있고, 생성자가 완료 처리합니다.'
                  : status === 'completed'
                    ? '생성자가 회의 요약을 저장하고 완료한 회의입니다.'
                    : '회의가 취소되었습니다.'}
              </p>
            </Card>
          )}
        </div>
      ) : tab === 'files' ? (
        <Card>
          <div className="section-heading">
            <h2>회의 자료 · {meeting.files.length}개</h2>
          </div>
          {meeting.attachments?.length ? (
            <ul className="attachment-list">
              {meeting.attachments.map((file) => (
                <li key={file.id}>
                  <FileText size={24} />
                  <div>
                    <strong>{file.name}</strong>
                    <small>
                      {file.type || '파일'} ·{' '}
                      {file.blob || file.downloadable
                        ? `${new Intl.NumberFormat('ko-KR').format(file.size)} bytes`
                        : '예시 자료'}
                      <br />
                      {data.people.find((p) => p.id === file.authorId)?.name ?? '등록자'} ·{' '}
                      {fullDate(file.updatedAt)} {time(file.updatedAt)}
                    </small>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!(file.blob || file.downloadable) || busy}
                    aria-label={`${file.name} 다운로드`}
                    onClick={() => void download(file.id)}
                  >
                    <Download size={16} />
                    다운로드
                  </Button>
                  {canUpload ? (
                    <label className="replace-file">
                      교체
                      <input
                        type="file"
                        aria-label={`${file.name} 교체`}
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) setReplacement({ file: f, id: file.id });
                          e.target.value = '';
                        }}
                      />
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              title={meeting.material === 'none' ? '자료 없음' : '자료 등록 예정'}
              description={
                meeting.material === 'none'
                  ? '이 회의는 자료 없이 진행합니다.'
                  : '필요한 자료가 등록되면 이곳에서 확인할 수 있어요.'
              }
            />
          )}{' '}
          {replacement ? (
            <div className="info-notice">
              <p>교체할 파일: {replacement.file.name}</p>
              <div className="form-actions">
                <Button
                  variant="secondary"
                  onClick={() => setReplacement(undefined)}
                  disabled={busy}
                >
                  교체 취소
                </Button>
                <Button
                  onClick={() => void replace(replacement.file, replacement.id)}
                  loading={busy}
                >
                  교체 저장
                </Button>
              </div>
            </div>
          ) : null}
          {canUpload ? (
            <div className="upload-section">
              <p className="muted">
                자료 편집 정책 확정 전, 미리보기에서는 회의 생성자만 등록·교체할 수 있습니다.
              </p>
              <FilePicker value={files} onChange={setFiles} />
              <div className="form-actions">
                <Button onClick={() => void upload()} loading={busy} disabled={!files.length}>
                  자료 등록
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card>
          <h2>회의 요약</h2>
          {meeting.summary ? (
            <div className="summary-read">
              <span className="badge status-completed">
                {meeting.completed ? '완료된 요약' : '임시 저장'}
              </span>
              <h3>주요 논의 내용</h3>
              <p>{meeting.summary.discussion || '작성된 내용이 없어요.'}</p>
              <h3>결정 사항</h3>
              <p>{meeting.summary.decisions || '작성된 내용이 없어요.'}</p>
              <h3>후속 할 일</h3>
              <p>{meeting.summary.nextSteps || '작성된 내용이 없어요.'}</p>
            </div>
          ) : (
            <EmptyState
              compact
              title={
                status === 'scheduled'
                  ? '회의 후 요약을 작성할 수 있어요'
                  : '아직 작성된 요약이 없어요'
              }
              description="회의의 주요 논의와 결정 사항을 함께 남겨주세요."
            />
          )}
          {canSummarize ? (
            <Link to={`/meetings/${id}/summary`} className="button button-primary">
              {meeting.summary ? '요약 수정' : '요약 작성'}
            </Link>
          ) : null}
        </Card>
      )}
      {cancel ? (
        <Modal
          className="cancel-confirm-modal"
          title="예정 회의 취소 확인"
          onClose={() => {
            if (!busy) setCancel(false);
          }}
        >
          <h3>
            <TriangleAlert /> 이 회의를 취소하시겠습니까?
          </h3>
          <ul className="cancel-consequences">
            <li>
              참가자에게 취소 알림을 요청합니다. 계정 연결과 발송 결과는 취소 후 확인할 수 있습니다.
            </li>
            <li>이 회의의 데모 예약이 해제됩니다.</li>
            <li>첨부된 자료와 회의 정보는 보관됩니다.</li>
          </ul>
          <label className="cancel-acknowledgement">
            <input
              type="checkbox"
              checked={cancelAcknowledged}
              onChange={(e) => setCancelAcknowledged(e.target.checked)}
            />
            위 내용을 확인했으며, 회의를 취소합니다.
          </label>
          <FormMessage error={error} />
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setCancel(false)} disabled={busy}>
              돌아가기
            </Button>
            <Button
              variant="danger"
              onClick={() => void cancelMeeting()}
              loading={busy}
              disabled={!cancelAcknowledged}
            >
              회의 취소 확정
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
export function SummaryEditor() {
  const { data, run } = useWorkspace();
  const { id } = useParams();
  const navigate = useNavigate();
  const meeting = data.meetings.find((m) => m.id === id);
  const [summary, setSummary] = useState({
    discussion: meeting?.summary?.discussion ?? '',
    decisions: meeting?.summary?.decisions ?? '',
    nextSteps: meeting?.summary?.nextSteps ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify(summary));
  const allowLeave = useUnsavedChanges(JSON.stringify(summary) !== saved);
  if (!meeting || !canEditSummary(meeting, data.user.id, data.now)) return <Denied />;
  const canComplete = meeting.creatorId === data.user.id && !meeting.completed;
  async function save(complete: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await run(() =>
        previewService.saveSummary(
          data.user.id,
          meeting!.id,
          summary,
          complete,
          meeting!.revision ?? 0,
        ),
      );
      setSaved(JSON.stringify(summary));
      if (complete) {
        allowLeave();
        navigate(`/meetings/${id}?tab=summary`);
      } else
        setSuccess(
          meeting!.completed
            ? '요약 변경을 저장했어요. 완료 상태는 유지됩니다.'
            : '요약을 저장했어요. 회의는 아직 완료되지 않았습니다.',
        );
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  const topic = data.topics.find((t) => t.id === meeting.topicId);
  return (
    <div className="workflow-page summary-page">
      <PageHeading
        title="회의 후 요약 작성"
        description={meeting.title}
        crumbs={[
          { label: topic?.title ?? 'Topic', to: `/topics/${meeting.topicId}` },
          { label: '회의 상세', to: `/meetings/${id}` },
        ]}
      />
      <div className="summary-meeting-meta">
        <StatusBadge status={meetingStatus(meeting, data.now)} />
        <span>
          <CalendarDays size={18} />
          {fullDate(meeting.start)} · {time(meeting.start)}–{time(meeting.end)}
        </span>
        <span>
          <MapPin size={18} />
          {meeting.room}
        </span>
      </div>
      <div className="summary-participants">
        <AvatarGroup
          people={data.people.filter((p) => meeting.participantIds.includes(p.id))}
          max={6}
        />
        <span>
          주최자 · {meeting.hostAtTime ?? data.people.find((p) => p.id === meeting.creatorId)?.name}{' '}
          · 참가자 {meeting.participantIds.length}명
        </span>
      </div>
      <Card className="summary-editor">
        <p className="info-notice">
          {meeting.completed
            ? '참가자 모두 요약을 수정할 수 있어요. 저장해도 완료 상태는 유지됩니다.'
            : '참가자 모두 요약을 작성·수정할 수 있어요. 회의 완료는 생성자가 진행합니다.'}
        </p>
        <div className="stack-form">
          {[
            ['discussion', '주요 논의 내용'],
            ['decisions', '결정 사항'],
            ['nextSteps', '후속 할 일'],
          ].map(([key, label]) => (
            <TextareaField
              key={key}
              label={label}
              rows={5}
              value={summary[key as keyof typeof summary]}
              onChange={(e) => {
                setSummary((s) => ({ ...s, [key]: e.target.value }));
                setSuccess('');
              }}
            />
          ))}
        </div>
        <FormMessage error={!confirm ? error : undefined} success={success} />
        <div className="form-actions">
          <Button variant="secondary" onClick={() => void save(false)} loading={busy}>
            {meeting.completed ? '변경 저장' : '임시 저장'}
          </Button>
          {canComplete ? (
            <Button
              onClick={() => {
                setError('');
                setConfirm(true);
              }}
              disabled={busy}
            >
              요약 저장 및 완료
            </Button>
          ) : null}
        </div>
      </Card>
      {confirm ? (
        <ConfirmDialog
          title="요약을 저장하고 회의를 완료할까요?"
          description="저장에 성공하면 회의가 완료로 표시됩니다. 외부 요약 알림은 전송되지 않습니다."
          actionLabel="저장 및 완료"
          onClose={() => setConfirm(false)}
          onConfirm={() => void save(true)}
          busy={busy}
          error={error}
        />
      ) : null}
    </div>
  );
}
