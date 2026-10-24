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
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { PersonAvatar } from '../components/PersonAvatar';
import { Brand } from '../components/Brand';
import { Button, Modal } from '../components/ui';
import type { Person } from '../domain/models';
const baseNavItems = [
  { to: '/', label: '홈', icon: Home },
  { to: '/topics', label: '토픽', icon: FolderOpen },
  { to: '/rooms', label: '회의실', icon: CalendarDays },
  { to: '/settings/notifications', label: '알림 설정', icon: Bell },
];
export function AppShell({
  children,
  user,
  tools,
  searchTriggerRef,
  onChooseAccount,
}: {
  children: ReactNode;
  user?: Person;
  onChooseAccount?: () => void;
  tools: ReactNode;
  searchTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const navItems = user?.isAdmin
    ? [...baseNavItems, { to: '/admin', label: '관리자 관리', icon: Settings2 }]
    : baseNavItems;
  const [params, setParams] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  function openSearch() {
    const next = new URLSearchParams(params);
    next.set('search', '1');
    setParams(next);
  }
  if (location.pathname === '/login') {
    return (
      <main id="main-content" className="login-root">
        {children}
      </main>
    );
  }
  return (
    <>
      <a href="#main-content" className="skip-link">
        본문으로 바로가기
      </a>
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
                <PersonAvatar
                  person={user ?? { id: 'unknown', name: '나', team: '' }}
                  className="profile-avatar"
                />
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
            <PersonAvatar
              person={user ?? { id: 'unknown', name: '나', team: '' }}
              className="profile-avatar"
            />
            <h3>{user?.name ?? '미리보기'}</h3>
            <p>
              {user?.team ?? '예시 계정'}
              {user?.position ? ` · ${user.position}` : ''}
            </p>
            <p className="muted">미리보기용 예시 프로필입니다.</p>
            {onChooseAccount ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setProfileOpen(false);
                  onChooseAccount();
                }}
              >
                테스트 계정 변경
              </Button>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
