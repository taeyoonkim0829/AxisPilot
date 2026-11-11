import { useT } from '../i18n'

export function Footer() {
  const t = useT()
  return (
    <footer className="app-footer">
      {t('방문 통계를 위해 Google Analytics(쿠키)를 사용합니다. 입력값과 선정 결과는 수집하지 않습니다.')}
      <br />
      © 2026. Kim Taeyoon. All rights reserved.
      <br />
      <a href="mailto:theo.kim0829@gmail.com">theo.kim0829@gmail.com</a>
    </footer>
  )
}
