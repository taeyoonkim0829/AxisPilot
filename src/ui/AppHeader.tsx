import { useEffect, useRef, useState } from 'react'
import { langSwitchLabel, useT, type Lang } from '../i18n'
import { modeLabel, type AppMode } from './ModeSwitch'
import { useTheme } from './theme'

/** The two menus and the screens under each */
const menus: { label: string; modes: AppMode[] }[] = [
  { label: '제품 선정', modes: ['single', 'gantry'] },
  { label: '제품 비교', modes: ['compareAxis', 'compareMotor'] },
]

/** One menu: its name (with the open screen's under it when it is the menu's) and the screens as a dropdown */
function NavMenu({ label, modes, mode, onMode }: { label: string; modes: AppMode[]; mode: AppMode; onMode: (m: AppMode) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = modes.includes(mode)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className={`nav-menu${current ? ' current' : ''}`} ref={ref}>
      <button type="button" className="nav-menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="nav-menu-text">
          <span className="nav-menu-label">{t(label)}</span>
          {current && <span className="nav-menu-sub">{t(modeLabel[mode])}</span>}
        </span>
        <svg className="nav-menu-chevron" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="nav-menu-list" role="menu" aria-label={t(label)}>
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              className={m === mode ? 'active' : ''}
              onClick={() => {
                setOpen(false)
                if (m !== mode) onMode(m)
              }}
            >
              {t(modeLabel[m])}
              {m === mode && (
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The page header: logo (home), the 제품 선정 / 제품 비교 menus, the language and theme switches */
export function AppHeader({ mode, onMode, lang, onLang }: { mode: AppMode; onMode: (m: AppMode) => void; lang: Lang; onLang: (l: Lang) => void }) {
  const t = useT()
  const [theme, toggleTheme] = useTheme()
  const other: Lang = lang === 'ko' ? 'en' : 'ko'
  return (
    <header className="app-header">
      <div className="app-header-inner">
        {/* home = the top of the single axis screen, an empty hash (App's useMode); the inputs stay */}
        <a className="app-logo" href="#" title={t('홈으로')}>
          <img src={`${import.meta.env.BASE_URL}${theme === 'light' ? 'axispilot-logo.svg' : 'axispilot-logo-dark.svg'}`} alt="AxisPilot" width={150} height={28} />
        </a>
        <nav className="app-nav" aria-label={t('주 메뉴')}>
          {menus.map((m) => (
            <NavMenu key={m.label} {...m} mode={mode} onMode={onMode} />
          ))}
        </nav>
        <div className="app-tools">
          <button type="button" className="icon-btn" lang={other} aria-label={langSwitchLabel[lang]} title={langSwitchLabel[lang]} onClick={() => onLang(other)}>
            {other.toUpperCase()}
          </button>
          <button type="button" className="icon-btn" aria-label={t(theme === 'light' ? '다크 모드' : '라이트 모드')} title={t(theme === 'light' ? '다크 모드' : '라이트 모드')} onClick={toggleTheme}>
            {theme === 'light' ? (
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
              </svg>
            ) : (
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
