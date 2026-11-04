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

/** the home view: isometric from the front right, above */
const HOME: Vec3 = [0.85, -1.3, 0.9]

/**
 * View cube faces in BoxGeometry order (+X, −X, +Y, −Y, +Z, −Z of the geometry). The cube is turned a quarter about X,
 * so the geometry's +Y is world up (Z) and its +Z the front (world −Y, where the 정면 camera stands).
 */
const CUBE_FACES = ['우측면', '좌측면', '평면', '저면', '정면', '배면'] as const
const CUBE_PX = 104

/** maker: the colours of the makers' STEP files (bodies without one take their part's colour); part: one colour per part */
type ColourMode = 'maker' | 'part'
const colourLabel: Record<ColourMode, string> = { maker: '제조사 색', part: '부품별 색' }

export default function ComboViewer({ meshes, roles, cog }: { meshes: PartMesh[]; roles: PartRole[]; cog: Vec3 }) {
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const cubeHost = useRef<HTMLDivElement>(null)
  // the camera direction (from the target), kept when the scene is rebuilt
  const viewDir = useRef(new THREE.Vector3(...HOME).normalize())
  const goHome = useRef<() => void>(() => {})
  const setCubeLabels = useRef<(labels: string[]) => void>(() => {})
  const [colours, setColours] = useState<ColourMode>('maker')
  const coloursRef = useRef<ColourMode>('maker')
  const setColouring = useRef<(c: ColourMode) => void>(() => {})
  // the cube's face names follow the language
  const labels = CUBE_FACES.map((f) => t(f))
  const labelKey = labels.join('|')
  // the names the scene builds the cube with (kept up to date by the effect below)
  const labelsRef = useRef(labels)

  useEffect(() => {
    const el = host.current!
    // the view to open with (the first renders below overwrite viewDir before the camera is placed)
    const initial = viewDir.current.clone()
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

    // ---- view cube: turns with the camera; click a face, edge or corner to look from there, drag it to orbit
    const cubeEl = cubeHost.current!
    const cubeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    cubeRenderer.setPixelRatio(window.devicePixelRatio)
    cubeRenderer.setSize(CUBE_PX, CUBE_PX)
    cubeEl.appendChild(cubeRenderer.domElement)
    const cubeScene = new THREE.Scene()
    const cubeCamera = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 10)
    const cubeGeometry = new THREE.BoxGeometry(2, 2, 2)
    const cubeEdges = new THREE.EdgesGeometry(cubeGeometry)
    // the face, edge or corner under the pointer: a blue patch over that region
    const hoverGeometry = new THREE.BoxGeometry(1, 1, 1)
    geometries.push(cubeGeometry, cubeEdges, hoverGeometry)
    const faceMaterials = CUBE_FACES.map(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }))
    const cubeLine = new THREE.LineBasicMaterial({ color: '#5b6573' })
    const hoverMaterial = new THREE.MeshBasicMaterial({ color: '#3d7fd9', transparent: true, opacity: 0.55, depthWrite: false })
    materials.push(...faceMaterials, cubeLine, hoverMaterial)
    const cube = new THREE.Mesh(cubeGeometry, faceMaterials)
    cube.rotation.x = Math.PI / 2
    cube.add(new THREE.LineSegments(cubeEdges, cubeLine))
    const hover = new THREE.Mesh(hoverGeometry, hoverMaterial)
    hover.visible = false
    cubeScene.add(cube, hover)

    const render = () => {
      renderer.render(scene, camera)
      viewDir.current.copy(camera.position).sub(controls.target).normalize()
      cubeCamera.position.copy(viewDir.current).multiplyScalar(4)
      cubeCamera.quaternion.copy(camera.quaternion)
      cubeRenderer.render(cubeScene, cubeCamera)
    }
    controls.addEventListener('change', render)

    const textures: THREE.Texture[] = []
    setCubeLabels.current = (names) => {
      textures.forEach((x) => x.dispose())
      textures.length = 0
      names.forEach((name, i) => {
        const c = document.createElement('canvas')
        c.width = c.height = 128
        const g = c.getContext('2d')!
        g.fillStyle = '#e8ecf1'
        g.fillRect(0, 0, 128, 128)
        g.fillStyle = '#1f2630'
        g.font = `600 ${name.length > 4 ? 24 : 30}px Pretendard, sans-serif`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(name, 64, 66)
        const tex = new THREE.CanvasTexture(c)
        tex.colorSpace = THREE.SRGBColorSpace
        textures.push(tex)
        faceMaterials[i].map = tex
        faceMaterials[i].needsUpdate = true
      })
      render()
    }

    // distance at which the bounding sphere fills the narrower field of view
    const fitDistance = () => {
      const vfov = (camera.fov * Math.PI) / 180
      const fov = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect))
      return (size / 2 / Math.sin(fov / 2)) * 0.8
    }
    const place = (dir: THREE.Vector3, distance: number) => {
      // straight down or up: a hair off the pole, so the view keeps X to the right
      const d = dir.clone().normalize()
      if (Math.abs(d.z) > 0.9999) d.set(0, -1e-4, Math.sign(d.z)).normalize()
      camera.position.copy(controls.target).addScaledVector(d, distance)
      controls.update()
      render()
    }
    let frame = 0
    const lookFrom = (dir: THREE.Vector3, animate = true) => {
      cancelAnimationFrame(frame)
      controls.target.copy(centre)
      const end = dir.clone().normalize()
      const to = fitDistance()
      const from = camera.position.distanceTo(controls.target)
      if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return place(end, to)
      const start = viewDir.current.clone()
      const turn = new THREE.Quaternion().setFromUnitVectors(start, end)
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 350)
        const e = 1 - (1 - k) ** 3
        place(start.clone().applyQuaternion(new THREE.Quaternion().slerp(turn, e)), from + (to - from) * e)
        if (k < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }
    goHome.current = () => lookFrom(new THREE.Vector3(...HOME))

    // the region of the cube under the pointer: each coordinate −1, 0 or +1 (face, edge or corner)
    const ray = new THREE.Raycaster()
    const regionAt = (e: PointerEvent) => {
      const r = cubeRenderer.domElement.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cubeCamera)
      const hit = ray.intersectObject(cube, false)[0]
      if (!hit) return null
      const p = hit.point
      return new THREE.Vector3(...[p.x, p.y, p.z].map((v) => (v > 0.6 ? 1 : v < -0.6 ? -1 : 0)))
    }
    const showHover = (q: THREE.Vector3 | null) => {
      hover.visible = q != null
      if (q) {
        const c = [q.x, q.y, q.z]
        hover.position.set(c[0] * 0.806, c[1] * 0.806, c[2] * 0.806)
        hover.scale.set(c[0] ? 0.4 : 1.2, c[1] ? 0.4 : 1.2, c[2] ? 0.4 : 1.2)
      }
      cubeEl.style.cursor = q ? 'pointer' : 'grab'
      render()
    }
    // dragging the cube orbits the camera about the target (Z stays up)
    const orbit = (dx: number, dy: number) => {
      const offset = camera.position.clone().sub(controls.target)
      offset.applyAxisAngle(camera.up, -dx * 0.012)
      const right = new THREE.Vector3().crossVectors(offset, camera.up).normalize()
      const tilted = offset.clone().applyAxisAngle(right, dy * 0.012)
      const polar = tilted.angleTo(camera.up)
      if (polar > 0.01 && polar < Math.PI - 0.01) offset.copy(tilted)
      camera.position.copy(controls.target).add(offset)
      controls.update()
      render()
    }
    let drag: { x: number; y: number; moved: boolean } | null = null
    const onDown = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      drag = { x: e.clientX, y: e.clientY, moved: false }
      cubeEl.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return showHover(regionAt(e))
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 3) return
      if (!drag.moved) showHover(null)
      drag = { x: e.clientX, y: e.clientY, moved: true }
      cubeEl.style.cursor = 'grabbing'
      orbit(dx, dy)
    }
    const onUp = (e: PointerEvent) => {
      const clicked = drag != null && !drag.moved
      drag = null
      const q = regionAt(e)
      if (clicked && q) lookFrom(q)
      showHover(q)
    }
    const onLeave = () => {
      if (!drag) showHover(null)
    }
    cubeEl.addEventListener('pointerdown', onDown)
    cubeEl.addEventListener('pointermove', onMove)
    cubeEl.addEventListener('pointerup', onUp)
    cubeEl.addEventListener('pointerleave', onLeave)

    setColouring.current = (c) => {
      for (const p of painted) p.mesh.material = c === 'maker' ? p.maker : p.part
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
    setCubeLabels.current(labelsRef.current)
    lookFrom(initial, false)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      cubeEl.removeEventListener('pointerdown', onDown)
      cubeEl.removeEventListener('pointermove', onMove)
      cubeEl.removeEventListener('pointerup', onUp)
      cubeEl.removeEventListener('pointerleave', onLeave)
      textures.forEach((x) => x.dispose())
      cubeRenderer.dispose()
      cubeRenderer.domElement.remove()
      controls.dispose()
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [meshes, roles, cog])

  useEffect(() => {
    labelsRef.current = labelKey.split('|')
    setCubeLabels.current(labelsRef.current)
  }, [labelKey])

  const paint = (c: ColourMode) => {
    setColours(c)
    coloursRef.current = c
    setColouring.current(c)
  }
  const present = colours === 'part' ? [...new Set(roles)] : []
  return (
    <div className="combo-viewer">
      <div className="combo-viewer-bar">
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
      <div className="combo-stage">
        <div className="combo-canvas" ref={host} />
        <div className="view-cube" ref={cubeHost} title={t('클릭: 그 방향에서 보기 · 드래그: 회전')} />
        <button type="button" className="view-home" onClick={() => goHome.current()} title={t('등각')} aria-label={t('등각')}>
          ⌂
        </button>
      </div>
    </div>
  )
}
