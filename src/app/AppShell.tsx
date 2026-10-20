import { useState, type ReactNode, type RefObject } from 'react';
import {
  Bell,
  CalendarDays,
  ChevronDown,
  Settings2,
  FolderOpen,
  Home,
  Menu,
  Search,
  X,
} from 'lucide-react';
import { Link, NavLink, useSearchParams } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Button, Modal } from '../components/ui';
import type { Person } from '../domain/models';
const baseNavItems = [
  { to: '/', label: '홈', icon: Home },
  { to: '/topics', label: 'Topic', icon: FolderOpen },
  { to: '/rooms', label: '회의실', icon: CalendarDays },
  { to: '/settings/notifications', label: '알림 설정', icon: Bell },
];
export function AppShell({
  children,
  user,
  tools,
  searchTriggerRef,
}: {
  children: ReactNode;
  user?: Person;
  tools: ReactNode;
  searchTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const navItems = user?.isAdmin
    ? [...baseNavItems, { to: '/admin', label: '관리자 관리', icon: Settings2 }]
    : baseNavItems;
  const [params, setParams] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  function openSearch() {
    const next = new URLSearchParams(params);
    next.set('search', '1');
    setParams(next);
  }
  return (
    <>
      <a href="#main-content" className="skip-link">
        본문으로 바로가기
      </a>
      <div className="preview-banner">
        <span>
          <span className="preview-dot" />
          디자인 미리보기
        </span>
        <p>예시 데이터로 둘러보는 로봇집사입니다. 실제 계정·예약과 연결되지 않습니다.</p>
      </div>
      <div className="app-frame">
        <aside className="sidebar">
          <Link to="/" className="brand-link" aria-label="로봇집사 홈">
            <Brand />
          </Link>
          <nav aria-label="주 메뉴">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
                title={label}
              >
                <Icon size={21} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="sidebar-message">
              좋은 대화의 시작,
              <br />
              <strong>로봇집사와 함께.</strong>
            </span>
            <span className="version">DESIGN PREVIEW · V1.0</span>
          </div>
        </aside>
        <div className="app-content">
          <header className="topbar">
            <Button
              variant="text"
              className="icon-button mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={22} />
            </Button>
            <Link to="/" className="mobile-brand" aria-label="로봇집사 홈">
              로봇집사
            </Link>
            <button ref={searchTriggerRef} className="search-trigger" onClick={openSearch}>
              <Search size={20} />
              <span>회의, 주제, 사람을 검색해보세요.</span>
              <span className="search-trigger-hint">검색</span>
            </button>
            <div className="topbar-right">
              <Link
                to="/settings/notifications"
                className="icon-button notification-link"
                aria-label="알림 설정"
              >
                <Bell size={21} />
              </Link>
              <span className="topbar-divider" />
              <Button
                variant="text"
                className="profile-button"
                onClick={() => setProfileOpen(true)}
                aria-label="내 프로필"
              >
                <span className="profile-avatar">{user?.name.slice(0, 1) ?? '나'}</span>
                <strong>{user?.name ?? '미리보기'}</strong>
                <ChevronDown size={15} />
              </Button>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          {tools}
        </div>
      </div>
      {menuOpen ? (
        <Modal title="메뉴" onClose={() => setMenuOpen(false)} className="mobile-nav">
          <Brand />
          <nav aria-label="모바일 메뉴">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} onClick={() => setMenuOpen(false)} className="nav-item">
                <Icon size={20} />
                {label}
              </Link>
            ))}
          </nav>
          <Button variant="text" onClick={() => setMenuOpen(false)}>
            <X size={16} />
            메뉴 닫기
          </Button>
        </Modal>
      ) : null}
      {profileOpen ? (
        <Modal title="내 프로필" onClose={() => setProfileOpen(false)}>
          <div className="profile-details">
            <span className="profile-avatar">{user?.name.slice(0, 1) ?? '나'}</span>
            <h3>{user?.name ?? '미리보기'}</h3>
            <p>{user?.team ?? '예시 계정'}</p>
            <p className="muted">미리보기용 예시 프로필입니다.</p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
