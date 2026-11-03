import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { PartRole } from '../cad/combo'
import { EDGE_ANGLE, type PartMesh } from '../cad/occt'
import type { Vec3 } from '../cad/step'
import { useT } from '../i18n'
import { RadioGroup } from './common'

// 3D preview of the assembled combination (Z up). Loaded lazily with three.js.

const ROLE_COLORS: Record<PartRole, string> = {
  axis: '#b9c1cb',
  kit: '#3d7fd9',
  gearbox: '#e0892b',
  motor: '#3a4250',
  shaft: '#3fa7a0',
  adapter: '#b07a4a',
  guide: '#8f9aa8',
}
const COG_COLOR = '#d6392b'

type ViewName = 'iso' | 'front' | 'top' | 'side'
const VIEW_DIRS: Record<ViewName, Vec3> = {
  iso: [0.85, -1.3, 0.9],
  front: [0, -1, 0],
  top: [0, -0.0001, 1],
  side: [1, 0, 0],
}
const viewLabel: Record<ViewName, string> = { iso: '등각', front: '정면', top: '평면', side: '우측면' }

/** maker: the colours of the makers' STEP files (bodies without one take their part's colour); part: one colour per part */
type ColourMode = 'maker' | 'part'
const colourLabel: Record<ColourMode, string> = { maker: '제조사 색', part: '부품별 색' }

export default function ComboViewer({ meshes, roles, cog }: { meshes: PartMesh[]; roles: PartRole[]; cog: Vec3 }) {
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const setView = useRef<(v: ViewName) => void>(() => {})
  const [view, setViewName] = useState<ViewName>('iso')
  const viewRef = useRef<ViewName>('iso')
  const [colours, setColours] = useState<ColourMode>('maker')
  const coloursRef = useRef<ColourMode>('maker')
  const setColouring = useRef<(c: ColourMode) => void>(() => {})

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const edgeColor = getComputedStyle(el).getPropertyValue('--text').trim() || '#1a1d21'

    const group = new THREE.Group()
    const geometries: THREE.BufferGeometry[] = []
    const materials: THREE.Material[] = []
    const material = (color: string) => {
      const m = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.15,
        roughness: 0.55,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
      materials.push(m)
      return m
    }
    const byRole = Object.fromEntries(Object.entries(ROLE_COLORS).map(([r, c]) => [r, material(c)])) as unknown as Record<PartRole, THREE.Material>
    const edgeMaterial = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.3 })
    materials.push(edgeMaterial)
    // the files' colours: linear RGB, one material per colour
    const byColour = new Map<string, THREE.Material>()
    const makerMaterial = (rgb: number[]) => {
      const key = rgb.join()
      let m = byColour.get(key)
      if (!m) {
        m = material('#ffffff')
        ;(m as THREE.MeshStandardMaterial).color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace)
        byColour.set(key, m)
      }
      return m
    }
    const painted: { mesh: THREE.Mesh; part: THREE.Material; maker: THREE.Material | THREE.Material[] }[] = []
    for (const m of meshes) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
      if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
      g.setIndex(new THREE.BufferAttribute(m.index, 1))
      if (!m.normals) g.computeVertexNormals()
      geometries.push(g)
      const part = byRole[roles[m.part] ?? 'axis']
      const own = m.color ? makerMaterial(m.color) : part
      let maker: THREE.Material | THREE.Material[] = own
      // (only when the faces cover every triangle: a group-drawn mesh leaves out what no group holds)
      const covered = m.faces.reduce((n, f) => n + f.last - f.first + 1, 0) === m.index.length / 3
      if (covered && m.faces.some((f) => f.color)) {
        // faces coloured on their own: one draw group per face, the body's colour where a face has none
        maker = m.faces.map((f, i) => {
          g.addGroup(f.first * 3, (f.last - f.first + 1) * 3, i)
          return f.color ? makerMaterial(f.color) : own
        })
      }
      const mesh = new THREE.Mesh(g, coloursRef.current === 'maker' ? maker : part)
      painted.push({ mesh, part, maker })
      group.add(mesh)
      let edges: THREE.BufferGeometry
      if (m.edges) {
        edges = new THREE.BufferGeometry()
        edges.setAttribute('position', new THREE.BufferAttribute(m.edges, 3))
      } else edges = new THREE.EdgesGeometry(g, EDGE_ANGLE)
      geometries.push(edges)
      group.add(new THREE.LineSegments(edges, edgeMaterial))
    }
    scene.add(group)

    const box = new THREE.Box3().setFromObject(group)
    const size = box.getSize(new THREE.Vector3()).length()
    const centre = box.getCenter(new THREE.Vector3())

    // centre of gravity: a red ball with a line from the slide centre
    const cogPoint = new THREE.Vector3(...cog)
    const ball = new THREE.SphereGeometry(size * 0.008, 24, 16)
    const cogMaterial = new THREE.MeshBasicMaterial({ color: COG_COLOR, depthTest: false })
    const lineMaterial = new THREE.LineDashedMaterial({ color: COG_COLOR, dashSize: size * 0.01, gapSize: size * 0.006, depthTest: false })
    geometries.push(ball)
    materials.push(cogMaterial, lineMaterial)
    const marker = new THREE.Mesh(ball, cogMaterial)
    marker.position.copy(cogPoint)
    marker.renderOrder = 2
    const leaderGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), cogPoint])
    geometries.push(leaderGeometry)
    const leader = new THREE.Line(leaderGeometry, lineMaterial)
    leader.computeLineDistances()
    leader.renderOrder = 2
    scene.add(marker, leader)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.6))
    const camera = new THREE.PerspectiveCamera(30, 1, size / 100, size * 20)
    camera.up.set(0, 0, 1)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(0.4, -0.3, 1)
    camera.add(sun)
    scene.add(camera)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(centre)
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    setColouring.current = (c) => {
      for (const p of painted) p.mesh.material = c === 'maker' ? p.maker : p.part
      render()
    }
    setView.current = (v) => {
      const dir = new THREE.Vector3(...VIEW_DIRS[v]).normalize()
      // fit the bounding sphere into the narrower of the two fields of view
      const vfov = (camera.fov * Math.PI) / 180
      const fov = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect))
      const distance = (size / 2 / Math.sin(fov / 2)) * 0.8
      camera.position.copy(centre).addScaledVector(dir, distance)
      controls.target.copy(centre)
      controls.update()
      render()
    }
    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()
    setView.current(viewRef.current)

    return () => {
      observer.disconnect()
      controls.dispose()
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [meshes, roles, cog])

  const pick = (v: ViewName) => {
    setViewName(v)
    viewRef.current = v
    setView.current(v)
  }
  const paint = (c: ColourMode) => {
    setColours(c)
    coloursRef.current = c
    setColouring.current(c)
  }
  const present = colours === 'part' ? [...new Set(roles)] : []
  return (
    <div className="combo-viewer">
      <div className="combo-viewer-bar">
        <RadioGroup options={Object.keys(VIEW_DIRS) as ViewName[]} value={view} onChange={pick} label={(v) => t(viewLabel[v])} />
        <RadioGroup options={['maker', 'part'] as ColourMode[]} value={colours} onChange={paint} label={(c) => t(colourLabel[c])} />
        <ul className="combo-legend">
          {present.map((r) => (
            <li key={r}>
              <span className="swatch" style={{ background: ROLE_COLORS[r] }} />
              {t({ axis: '축', kit: '연결키트', gearbox: '감속기', motor: '모터', shaft: '연결축', adapter: '조합 키트', guide: '가이드' }[r])}
            </li>
          ))}
          <li>
            <span className="swatch round" style={{ background: COG_COLOR }} />
            {t('무게 중심')}
          </li>
        </ul>
      </div>
      <div className="combo-canvas" ref={host} />
    </div>
  )
}
