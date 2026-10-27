import { axisCog, type AxisEvaluation } from '../calc/axisSelection'
import type { DriveEvaluation } from '../calc/motorSelection'
import type { Requirements } from '../calc/types'
import { comboDrawings, type ComboDrawings, type ComboSelection, type TwinAxis } from '../cad/combo'
import { shaftDrawingFor } from '../cad/drawings'
import type { Kit } from '../data/types'

/**
 * What one axis's combination drawing is built from (step 5, and each axis of the gantry drawing): the selection,
 * its drawing files, the requirements with the COG relative to the first axis, and the second axis of a twin
 * arrangement (its own drive train under motor sync, else the KSK when it has a drawing; LM guides are not drawn).
 */
export function comboInputs(
  axis: AxisEvaluation | null,
  drive: DriveEvaluation | null,
  kit: Kit | null,
  input: Requirements,
): { selection: ComboSelection | null; found: ComboDrawings | null; twin: TwinAxis | undefined; req: Requirements } {
  // The drawing is built from the first axis: the COG is placed relative to its slide centre.
  const req = { ...input, cog: axisCog(input) }
  const selection: ComboSelection | null =
    axis && drive && kit
      ? {
          axis: axis.axis,
          axisModel: axis.order.model,
          stroke: axis.order.stroke ?? req.stroke,
          ...(axis.options?.slides.length
            ? {
                extraSlides: {
                  sides: axis.options.slides.map((code) => (code === axis.axis.additionalSlide?.left ? ('left' as const) : ('right' as const))),
                  pitch: axis.options.pitch * 1000,
                },
              }
            : {}),
          motor: drive.motor,
          gearbox: drive.gearbox,
          kit,
        }
      : null
  const found = selection ? comboDrawings(selection) : null
  const shaftDrawing = axis?.shaft ? shaftDrawingFor(axis.shaft.shaft) : null
  const twin: TwinAxis | undefined =
    axis && axis.layout.axes > 1 && input.parallel
      ? {
          spacing: input.parallel.spacing,
          drive: axis.layout.mode === 'twinMotor',
          ...(axis.shaft && shaftDrawing && !shaftTooShort(axis)
            ? { shaft: { model: axis.shaft.model, length: axis.shaft.length, drawing: shaftDrawing } }
            : {}),
        }
      : undefined
  return { selection, found, twin, req }
}

/**
 * The KSK is shorter than its order range (the axis spacing too short): it is left out of the drawing, as its model,
 * drawn at the shortest nominal length, cannot be shortened (the calc fails `연결축 공칭 길이 LN`)
 */
export const shaftTooShort = (axis: AxisEvaluation): boolean => !!axis.shaft && axis.shaft.length < axis.shaft.shaft.lengthRange[0]

/** The part of a rebuild key that a combination's inputs give */
export const comboKey = (selection: ComboSelection, req: Requirements, twin: TwinAxis | undefined) =>
  [
    selection.axis.id,
    selection.stroke,
    selection.extraSlides ? `${selection.extraSlides.sides.join('+')}@${selection.extraSlides.pitch}` : '',
    selection.motor.id,
    selection.gearbox?.id,
    selection.kit.id,
    req.mounting,
    req.cog.x,
    req.cog.y,
    req.cog.z,
    twin ? `${twin.spacing}/${twin.drive}/${twin.shaft?.model ?? ''}` : '',
  ].join('|')
