import { useId, useRef, useState } from 'react'
import { useT } from '../i18n'
import { lockAdmin, unlockAdmin, useAdmin } from './admin'

export function Footer() {
  const t = useT()
  const admin = useAdmin()
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  return (
    <footer className="app-footer">
      {t('방문 통계를 위해 Google Analytics(쿠키)를 사용합니다. 입력값과 선정 결과는 수집하지 않습니다.')}
      <br />
      © 2026. Kim Taeyoon. All rights reserved.
      <br />
      <a href="mailto:theo.kim0829@gmail.com">theo.kim0829@gmail.com</a>
      {' · '}
      <button
        type="button"
        className="footer-link"
        onClick={() => {
          if (admin) return lockAdmin()
          setPassword('')
          setWrong(false)
          dialog.current?.showModal()
        }}
      >
        {t(admin ? '관리자 모드 끄기' : '관리자')}
      </button>
      <dialog ref={dialog} className="notice" aria-labelledby={id} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <h2 id={id}>{t('관리자 모드')}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (await unlockAdmin(password)) dialog.current?.close()
            else setWrong(true)
          }}
        >
          <div className="notice-text">
            <label className={wrong ? 'field field-invalid' : 'field'}>
              <span className="field-label">{t('비밀번호')}</span>
              <span className="field-input">
                <input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
              </span>
              {wrong && <span className="field-hint">{t('비밀번호가 맞지 않습니다')}</span>}
            </label>
          </div>
          <button type="submit" className="notice-ok">
            {t('확인')}
          </button>
        </form>
      </dialog>
    </footer>
  )
}
