/**
 * Whether a compatibility code (Apex lists Mitsubishi frame codes like "KP053") names this motor model. The code must
 * not run on into another digit: "SR52" is HG-SR52(B), not the 400 V HG-SR524.
 */
export function namesMotor(model: string, code: string): boolean {
  for (let i = model.indexOf(code); i >= 0; i = model.indexOf(code, i + 1))
    if (!/\d/.test(model[i + code.length] ?? '')) return true
  return false
}
