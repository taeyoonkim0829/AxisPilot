import { jsPDF } from 'jspdf'
import { layoutSheet, PHANTOM, type DrawingInput } from './dxf'

// The KS drawing sheet of `layoutSheet` as a PDF page of the sheet's size, printed at its scale (1:1 paper mm):
// black lines, thick ones at their width, thin ones 0.25 mm, the COG lines two-dot chain.

const THIN = 0.25
/** cap height of Helvetica as a share of the font size */
const CAP = 0.72
const PT_PER_MM = 72 / 25.4

export function drawingPdf(input: DrawingInput): Blob {
  const sheet = layoutSheet(input)
  const { n, w, h } = sheet
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [w, h] })
  doc.setProperties({ title: input.title[0] ?? 'Drawing', creator: 'AxisPilot' })
  doc.setDrawColor(0, 0, 0)
  doc.setFillColor(0, 0, 0)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  // model mm → paper mm, y up → PDF y down
  const X = (x: number) => x / n
  const Y = (y: number) => h - y / n
  const dash = (layer: string) =>
    layer === 'COG' ? doc.setLineDashPattern(PHANTOM.map((v) => Math.max(Math.abs(v), 0.3)), 0) : doc.setLineDashPattern([], 0)
  for (const o of sheet.ops) {
    if (o.k === 'line') {
      dash(o.layer)
      doc.setLineWidth(THIN)
      doc.line(X(o.x1), Y(o.y1), X(o.x2), Y(o.y2))
    } else if (o.k === 'poly') {
      dash(o.layer)
      doc.setLineWidth(Math.max(THIN, o.width / n))
      const pts = o.closed ? [...o.points, o.points[0]] : o.points
      for (let i = 1; i < pts.length; i++) doc.line(X(pts[i - 1][0]), Y(pts[i - 1][1]), X(pts[i][0]), Y(pts[i][1]))
    } else if (o.k === 'circle') {
      dash(o.layer)
      doc.setLineWidth(THIN)
      doc.circle(X(o.x), Y(o.y), o.r / n, 'S')
    } else if (o.k === 'solid') {
      const [a, b, c] = o.points
      doc.triangle(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), X(c[0]), Y(c[1]), 'F')
    } else {
      doc.setFontSize((o.height / n / CAP) * PT_PER_MM)
      // centred: start half the text width back along its direction (jsPDF centres rotated text across the page)
      const back = o.align === 'centre' ? doc.getTextWidth(o.value) / 2 : 0
      const r = (o.rotation * Math.PI) / 180
      doc.text(o.value, X(o.x) - back * Math.cos(r), Y(o.y) + back * Math.sin(r), { angle: o.rotation, baseline: 'alphabetic' })
    }
  }
  return doc.output('blob')
}
