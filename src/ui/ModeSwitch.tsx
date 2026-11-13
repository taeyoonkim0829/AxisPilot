/** The screens: single = one axis (with its parallel arrangement), gantry = XYZ combination (제품 선정);
 *  compareAxis / compareMotor = another maker's axis / motor against Festo's (제품 비교). Picked in `AppHeader`. */
export type AppMode = 'single' | 'gantry' | 'compareAxis' | 'compareMotor'
export const modeLabel: Record<AppMode, string> = {
  single: '단축 선정',
  gantry: '조합축 선정 (Beta)',
  compareAxis: '직교 축',
  compareMotor: '모터',
}

/** The screen's address (hash) */
export const modeHash: Record<AppMode, string> = { single: '', gantry: 'gantry', compareAxis: 'compare-axis', compareMotor: 'compare-motor' }
