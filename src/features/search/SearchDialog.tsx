import { useEffect, useRef, useState, type RefObject } from 'react';
import { CalendarDays, ChevronRight, Search } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Workspace } from '../../domain/models';
import { fullDate, searchWorkspace, time } from '../../domain/selectors';
import { Modal } from '../../components/ui';
import { TopicIcon } from '../../components/TopicCard';
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const index = text.toLocaleLowerCase('ko').indexOf(needle.toLocaleLowerCase('ko'));
  return index === -1 ? (
    <>{text}</>
  ) : (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}
export function SearchDialog({
  data,
  onClose,
  returnFocusRef,
}: {
  data: Workspace;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [filter, setFilter] = useState(params.get('type') ?? 'all');
  const results = searchWorkspace(data, query);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(Number(params.get('scroll') ?? 0));
  useEffect(() => {
    containerRef.current?.scrollTo(0, initialScroll.current);
  }, []);
  function updateSearch(value: string, type: string) {
    setQuery(value);
    setFilter(type);
    const next = new URLSearchParams(params);
    next.set('q', value);
    next.set('type', type);
    next.delete('scroll');
    setParams(next, { replace: true });
  }
  function select(path: string) {
    const next = new URLSearchParams(params);
    next.set('scroll', String(containerRef.current?.scrollTop ?? 0));
    const searchUrl = `${location.pathname}?${next.toString()}`;
    navigate(searchUrl, { replace: true });
    navigate(path, { state: { fromSearch: searchUrl } });
  }
  return (
    <Modal
      title="회의와 Topic 검색"
      description="내가 접근할 수 있는 Topic과 회의를 검색합니다."
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      className="search-modal"
    >
      <label className="search-field">
        <Search size={21} />
        <span className="sr-only">검색어</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => updateSearch(e.target.value, filter)}
          placeholder="회의, 주제, 사람을 검색해보세요"
        />
      </label>
      <div className="search-filters" role="group" aria-label="검색 결과 종류">
        {[
          ['all', '전체', results.topics.length + results.meetings.length],
          ['topics', 'Topic', results.topics.length],
          ['meetings', '회의', results.meetings.length],
        ].map(([id, label, count]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            className={filter === id ? 'selected' : ''}
            onClick={() => updateSearch(query, String(id))}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <div className="search-results" ref={containerRef} aria-live="polite">
        {!query.trim() ? (
          <div className="search-message">
            <Search size={30} />
            <h3>어떤 대화를 찾고 계신가요?</h3>
            <p>회의명, 주제, 장소 또는 참석자 이름을 입력해보세요.</p>
          </div>
        ) : (
          <>
            {filter !== 'meetings' && results.topics.length ? (
              <section>
                <h3>
                  Topic <span>{results.topics.length}개</span>
                </h3>
                {results.topics.map((t) => (
                  <button
                    className="search-result"
                    key={t.id}
                    onClick={() => select(`/topics/${t.id}`)}
                  >
                    <TopicIcon topic={t} />
                    <span>
                      <strong>
                        <Highlight text={t.title} query={query} />
                      </strong>
                      <small>
                        <Highlight text={t.description} query={query} />
                      </small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </section>
            ) : null}
            {filter !== 'topics' && results.meetings.length ? (
              <section>
                <h3>
                  회의 <span>{results.meetings.length}개</span>
                </h3>
                {results.meetings.map((m) => (
                  <button
                    className="search-result"
                    key={m.id}
                    onClick={() => select(`/meetings/${m.id}`)}
                  >
                    <span className="topic-icon tone-blue">
                      <CalendarDays size={24} />
                    </span>
                    <span>
                      <strong>
                        <Highlight text={m.title} query={query} />
                      </strong>
                      <small>
                        {fullDate(m.start)} {time(m.start)} ·{' '}
                        <Highlight text={m.room} query={query} />
                      </small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </section>
            ) : null}
            {(
              filter === 'topics'
                ? !results.topics.length
                : filter === 'meetings'
                  ? !results.meetings.length
                  : !results.topics.length && !results.meetings.length
            ) ? (
              <div className="search-message">
                <Search size={30} />
                <h3>검색 결과가 없어요</h3>
                <p>다른 검색어로 다시 찾아보세요.</p>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="search-footer">
        접근 권한이 있는 정보만 표시됩니다.<span>ESC로 닫기</span>
      </div>
    </Modal>
  );
}
