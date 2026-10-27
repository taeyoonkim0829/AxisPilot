import { RadioGroup } from './common'
import { useT } from '../i18n'

/** single = one axis (with its parallel arrangement), gantry = XYZ combination */
export type AppMode = 'single' | 'gantry'
const modeLabel: Record<AppMode, string> = { single: '단축 선정', gantry: '조합축 선정 (Beta)' }

/** Screen switch at the top of the input column, above the first input box */
export function ModeSwitch({ mode, onMode }: { mode: AppMode; onMode: (mode: AppMode) => void }) {
  const t = useT()
  return (
    <RadioGroup
      className="mode-switch"
      ariaLabel={t('선정 화면')}
      options={Object.keys(modeLabel) as AppMode[]}
      value={mode}
      onChange={onMode}
      label={(m) => t(modeLabel[m])}
    />
  )
}
