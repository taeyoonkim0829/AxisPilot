// Shapes of the JSON files in data/. Field units are listed in data/README.md
// (mm, kg, N, Nm, kg·cm², m/s, m/s², rpm).

export type AxisFamily = 'ELGT' | 'ELGD' | 'EGC' | 'ESBF'
export type DriveKind = 'belt' | 'spindle'

export interface Axis {
  id: string
  family: AxisFamily
  variant: '' | 'HD' | 'WD'
  size: number | null
  drive: DriveKind
  slide: 'GK' | 'GV'
  longSlide: boolean
  model: string
  category: string | null
  guideType: string | null
  strokeRangeText: string | null
  speedLimitStroke: number | null
  maxStroke: number
  maxFeedForce: number
  /** N, ELGD-BS: max. feed force with a parallel kit (data sheet p.6), when lower than with an axial kit */
  maxFeedForceParallel?: number | null
  noLoadTorque: number
  maxDrivingTorque: number | null
  maxSpeed: number
  maxAcceleration: number
  repeatability: number | null
  baseMass: number
  massPer10mm: number
  slideMass: number
  /** kg per 10 mm stroke added to the moving mass (ESBF piston rod); absent for slide axes */
  slideMassPer10mm?: number | null
  /** ball screw axes: [working stroke mm, max. speed m/s], read from the data sheet speed-stroke curve */
  speedCurve?: [number, number][] | null
  /** ELGD-BS: [working stroke mm, max. feed force N] towards the motor (screw buckling), read from the data sheet curve */
  feedForceCurve?: [number, number][] | null
  /** ESBF: [rod length mm, max. pressure force N] — buckling limit, read from the data sheet curve */
  pressureForceCurve?: [number, number][] | null
  /** ESBF: [stroke mm, max. lateral force on the piston rod N], read from the data sheet curve; replaces the guide check */
  rodLateralForceCurve?: [number, number][] | null
  pulleyDiameter: number | null
  feedConstant: number | null
  spindleDiameter: number | null
  spindlePitch: number | null
  inertiaJ0: number
  inertiaJHPerMeter: number
  inertiaJLPerKg: number
  FxMax: number | null
  FyMax: number | null
  FzMax: number | null
  MxMax: number | null
  MyMax: number | null
  MzMax: number | null
  Iy: number | null
  Iz: number | null
  baseLength: number | null
  slideLength: number | null
  screwDynamicLoadRating: number | null
  /** ESBF-BS: the screw life also ends after this many switching cycles (round trips) */
  maxSwitchingCycles?: number | null
  allowableDeflection: number | null
  standardStrokes: number[] | string[] | null
  /** Released mounting positions: 'horizontal' only for ELGT-TB (data sheet); absent = any */
  mountingPosition?: 'any' | 'horizontal' | null
  /** Order type code with … where the stroke goes (ELGT-BS, ELGD, EGC); `model` when missing (ESBF) */
  typeCode?: string | null
  /** order number per standard stroke (mm as key) */
  strokePartNumbers?: Record<string, string> | null
  /** module number for other strokes (modular product system) */
  moduleNumber?: string | null
  /** mm, strokes the modular product system takes: any whole mm in `variable` [min, max], plus the `fixed` ones */
  moduleStrokes?: { variable: [number, number] | null; fixed: number[] } | null
  /** mechanical interface code for mounting kits; null when unknown */
  interfaceCode: string | null
  /** mm, belt axes: distance between the drive cover faces at both shaft ends (from the CAD model); a connecting shaft spans the axis spacing minus this */
  driveWidth?: number | null
  /** Additional (passive, standard) slide on the same guide, ordered in the modular product system */
  additionalSlide?: AdditionalSlide | null
  /** Toothed belt materials to choose from, the one in `typeCode` first */
  beltMaterials?: BeltMaterial[] | null
}

export interface AdditionalSlide {
  /** type code of a slide on the left / right (ELGD ZL/ZR, EGC KL/KR) */
  left: string
  right: string
  /** both sides at once (EGC KL + KR) */
  both: boolean
  /** mm, length of the additional slide and the gap to the main slide; the working stroke loses both per slide */
  length: number
  gap: number
  /** kg */
  mass: number
  /** kg·cm² at the drive shaft per additional slide (EGC JW); null = JL × mass */
  inertia: number | null
}

export interface BeltMaterial {
  /** type code (PU1, PU2); null for a material without one (EGC chloroprene rubber) */
  code: string | null
  /** Nm, max. no-load torque with this belt; null = not in the data sheet (the axis value is used) */
  noLoadTorque: number | null
}

export type MotorMaker = 'Festo' | 'Siemens' | 'Mitsubishi'

export interface Motor {
  id: string
  maker: MotorMaker
  /** product family from the model name: Festo EMMT, Siemens 1FK2, Mitsubishi HK-KT */
  family: string
  brake: boolean
  model: string
  description: string | null
  series: string | null
  ratedPower: number | null
  ratedTorque: number
  peakTorque: number
  ratedSpeed: number
  maxSpeed: number | null
  /** kg·cm², including the brake on brake models */
  inertia: number
  allowableInertiaRatio: number | null
  reverseEfficiency: number | null
  capacitorEnergy: number | null
  regenPower: number | null
  amplifier: string | null
  /** mechanical interface code for mounting kits; brake and non-brake models share it; null when unknown */
  interfaceCode: string | null
  /** A */
  nominalCurrent?: number | null
  peakCurrent?: number | null
  /** Nm/A */
  torqueConstant?: number | null
  /** V, supply class the item is rated for: 200/230 (200–240 V AC), 400 (380–480 V AC) or 48 (DC) */
  voltage?: number | null
  // Motors with a drive package in the data (see data/README.md)
  /**
   * drive range the motor runs on (`Controller` family + voltage class): Festo CMMT-AS-3A (230 V), CMMT-AS-11A
   * (400 V) or CMMT-ST (48 V DC); Siemens S210-1AC / S210-3AC (1FK2), V90-200V / V90-400V (1FL6)
   */
  controller?: string | null
  /** Festo's preferred drive for the motor (EMMT-AS combination table) */
  preferredController?: string | null
  /** stepper motor: torque limited by `torqueCurve` */
  stepper?: boolean
  /** open-loop stepper (EMMS-ST): no encoder, runs at nominal current */
  openLoop?: boolean
  /** [rpm, Nm] max. torque at 48 V DC (steppers) */
  torqueCurve?: [number, number][] | null
  /** Festo: order type of the base configuration (smooth shaft, single-turn encoder …) and its part number */
  orderCode?: string | null
  partNumber?: string | null
  /** kg; so far only Mitsubishi HK-* */
  mass?: number | null
}

/** Servo drive: Festo CMMT-AS / CMMT-ST, Siemens S210 / V90 */
export interface Controller {
  id: string
  model: string
  family: string
  maker: string
  partNumber: string
  motorType: 'AS' | 'ST' | null
  supply: string
  /**
   * Festo '3A' (1-phase 230 V), '11A' (3-phase 400 V), 'ST' (24/48 V DC); Siemens S210 '1AC' / '3AC', V90 '200V' /
   * '400V'. With the family it names the drive range a motor's `controller` points to (`driveRange`).
   */
  voltageClass: string
  /** regular expression on the motor model: the motors the maker's combination table pairs with this drive */
  motors?: string
  /** A rms per phase */
  nominalCurrent: number
  /** A; null = not documented (Mitsubishi: the combination table guarantees the motor's max. current) */
  peakCurrent: number | null
  /** s, max. time at peak current; null = not documented (not checked) */
  peakDuration: number | null
  /** W */
  nominalPower: number
  peakPower: number | null
  /** m, without external mains filter; null = not documented */
  maxCableLength: number | null
  /** integrated braking resistor: Ω, W (pulse), Ws, W (nominal); null = none. Pulse values null = not documented (Mitsubishi) */
  internalResistor: { resistance: number | null; pulsePower: number | null; pulseEnergy: number | null; nominalPower: number } | null
  /** Ω [min, max] for an external braking resistor (Siemens: minimum only) */
  externalResistance: [number, number | null]
  /** W, max. continuous power of an external braking resistor */
  externalMaxPower: number | null
  /** V, intermediate circuit level the resistor ratings are given for (380 or 780); null without CACR ratings */
  resistorVoltage: number | null
  /** matching CACR braking resistors (model names) */
  brakingResistors: string[]
}

export interface BrakingResistor {
  id: string
  model: string
  family: string
  maker: string
  partNumber: string
  resistance: number
  /** W at 35% duty cycle */
  power35: number | null
  ratedPower: number | null
  /** Ws / W at 380 V and 780 V intermediate circuit */
  pulseEnergy380: number | null
  nominalPower380: number | null
  pulseEnergy780: number | null
  nominalPower780: number | null
}

/** One cable option: a role for a group of motors on a drive range, for a span of cable lengths */
export interface Cable {
  id: string
  maker: string
  family: string
  role: 'motor' | 'encoder' | 'adapter' | 'brake'
  /** drive family: CMMT-AS, CMMT-ST, S210, V90 */
  controller: string
  /** regular expression on the motor model */
  motors: string
  /** only for motors with brake */
  brakeOnly: boolean
  /** m, (min, max] cable lengths this option covers */
  range: [number, number]
  /** cross-section code (Q7 …) and mm² */
  code: string | null
  crossSection: number | null
  /** type with {L} for the length in m */
  type: string
  /** part number per standard length (m as key) */
  partNumbers: Record<string, string>
  /**
   * other lengths: `variable` = a part number of its own for any length (M23/M40, Sub-D), `modular` = configured in
   * the modular product system and ordered by its module number (`module`, e.g. NEBM-LX/M17); the type gets the length.
   * null = standard lengths only (the next longer one is ordered).
   */
  configurable: {
    kind: 'variable' | 'modular'
    type: string
    partNumber: string
    module?: string
    /** m: length increment and range */
    step: number
    min: number
    max: number
  } | null
  /** m, fixed length part (adapters) */
  fixedLength?: number
}

export interface Gearbox {
  id: string
  /** i, e.g. 5 for 5:1 */
  ratio: number
  model: string
  /** model prefix: Apex AB/PA/AE…, Festo EMGA */
  family: string
  maker: string
  flangeSize: number | null
  compatibleMotors: string[] | null
  continuousTorque: number | null
  maxTorque: number | null
  /** kg·cm², at the input (motor) side */
  inertia: number
  /** % */
  efficiency: number | null
  /** mechanical interface code for mounting kits, at the output (axis) side; null when unknown */
  interfaceCode: string | null
  /** interface code at the drive (motor) side; equals the motor's interfaceCode. null when unknown (all Apex for now) */
  driveCode?: string | null
  /** rpm (Festo EMGA, Apex AB/ABR) */
  maxInputSpeed?: number
  /** kg (Festo EMGA, Apex AB/ABR) */
  mass?: number | null
  // Festo EMGA only (from the Festo documentation)
  /** order number */
  partNumber?: string
  // Apex AB/ABR only (from the Apex catalog)
  /** 1 or 2 */
  stage?: number
  /** rpm */
  nominalInputSpeed?: number
  /** Nm, T2NOT = 3 × continuousTorque */
  emergencyStopTorque?: number
  /** arcmin per backlash class: P0 micro, P1 reduced, P2 standard; null = not made */
  backlashArcmin?: { P0: number | null; P1: number | null; P2: number | null }
}

/**
 * One Festo motor mounting kit for one axis/motor interface code pair (a kit listed for several codes
 * appears once per pair). It fits when `axisCode` equals the axis's `interfaceCode` and `motorCode` equals
 * the motor's, or the gearbox's when a gearbox sits in between.
 */
export interface Kit {
  /** product|axisCode|motorCode */
  id: string
  family: 'axial' | 'parallel'
  /** axial (EAMM-A, coupling) or parallel (EAMM-U, belt) */
  type: 'axial' | 'parallel'
  /** null for SA kits */
  partNumber: string | null
  product: string
  axisCode: string
  motorCode: string
  /** inspection window */
  window: boolean
  /** axial kits: coupling type (Jaw, Disk) */
  coupling?: string | null
  /** parallel kits: pulley part number, when ordered separately */
  pulley?: string | null
  /** SA = custom-made in Korea; codes come from the kit name, ask TEC before using */
  special: boolean
  sa?: { projectNo: string | null; motorMaker: string | null; motorModel: string | null } | null
  // From the EAMM-A / EAMM-U data sheets; null for kits not in them (e.g. the BF…/EB… kits, older K… kits)
  /** kg·cm² */
  inertia: number | null
  /** Nm, max. permissible transferable torque */
  transmissibleTorque: number | null
  /** i (1 for every EAMM-U) */
  ratio: number | null
  efficiency: number | null
  /** rpm */
  maxSpeed: number | null
  /** Nm, parallel kits: no-load driving torque */
  noLoadTorque?: number | null
  /** kg */
  mass: number | null
  /** mm */
  length: number | null
  /** data sheet row the values come from when it is the kit's current generation (…-G2) */
  dataSource?: string | null
}

/**
 * Connecting shaft (Festo KSK): drive shafts, couplings and a tube joining the drive shafts of two parallel toothed
 * belt axes, ordered by nominal length LN (the gap between the drive covers). From the KSK operating instructions
 * (8239742, 2025-12) and data sheets.
 */
export interface ConnectingShaft {
  id: string
  maker: 'Festo'
  family: 'KSK'
  model: string
  /** order type code with … where the nominal length goes */
  typeCode: string
  partNumber: string
  size: string
  /** mm, coupling bore */
  bore: number
  /** mm, nominal length LN [min, max] */
  lengthRange: [number, number]
  /** Nm */
  ratedTorque: number
  /** mm, ± */
  maxAxialOffset: number
  /** kg·cm² at LN = 0 / per m of LN */
  inertiaJ0: number
  inertiaJLPerMeter: number
  /** kg at LN = 0 / per m of LN */
  baseMass: number
  massPerMeter: number
  /** axes it fits (belt drive), each with its max. speed curve [LN mm, rpm] */
  axes: { family: AxisFamily; variant: Axis['variant']; size: number; speedCurve: [number, number][] }[]
}

/** An axis of a gantry kit fit: family, variant and size, and the drive when the kit is for one only */
export interface AdapterAxis {
  family: AxisFamily
  variant: Axis['variant']
  size: number
  drive: Axis['drive']
  /** the axis needs the long slide (ELGD …-L) */
  longSlide?: boolean
  /** carried axes: where the kit holds it (assembly instructions, measured on the STEP models). `end`: mm from the
   *  base slide centre along the carried axis's body (angle kits: the wall's reach) to its near end. `pinned`: the
   *  kit's pins and screws go into the profile's pin bores and threaded bores at the drive end (ELGT), so the near
   *  end is the drive flange (`baseLength` is measured from it) and the axis cannot move along the kit; otherwise
   *  the profile is clamped (ELGD on EHAM-AK-E24: its end at clearance A 77.5 mm from the console end) */
  end?: number
  pinned?: boolean
  /** pinned: the profile's threaded bores, the first row's distance from the drive flange and their pitch (mm) */
  threads?: { first: number; pitch: number }
  /** pinned: the kit's screws into the profile, nearest and farthest from the base slide centre along the body (mm) */
  screws?: [number, number]
}

/**
 * Festo kit joining two axes of a gantry (EHAM angle and adapter kits, EAHF profile mountings): the carried axis's
 * profile on the base axis's slide. `angle`: the carried slide faces across the base slide's normal (X floor, Y on
 * the wall side); `plate`: both slides face the same way (crossed axes, Z on a wall-mounted Y).
 * Custom brackets (data/adapters/Custom, `custom: true`, made to order) have no part number; `beam`: a cross beam
 * bolted between the walls of two Festo angle kits on the twin base axes (in place of the carried ELGT profile),
 * carrying a Z axis on a Festo EHAM-MA plate on its pad (`beam.carries` z) or the Y axis pinned on its front face
 * (y); `gantryJoint` takes one where no Festo kit spans the twin base axes.
 */
export interface AxisAdapter {
  id: string
  maker: 'Festo' | 'Custom'
  family: 'EHAM-AK' | 'EHAM-MA' | 'EAHF' | 'Custom'
  model: string
  /** null for custom brackets */
  partNumber: string | null
  joint: 'angle' | 'plate' | 'beam'
  base: AdapterAxis[]
  carried: AdapterAxis[]
  /** angle kits come in two mirror-image versions (…-ML / …-MR) */
  hand: 'left' | 'right' | null
  /** ELGD angle kits: …-L for a cantilever, …-S for a three-dimensional gantry */
  layout: 'cantilever' | 'gantry' | null
  /** mm, working stroke range of the carried axis the kit is for */
  carriedStroke: [number, number] | null
  /** angle kits: mm the wall spans along its reach from the base slide centre, [behind, ahead] (STEP models); two
   *  mirrored kits reaching towards each other collide unless the base spacing is at least twice the ahead value */
  wall?: [number, number] | null
  /** kg */
  mass: number
  /** further parts to order with it (`quantity` per kit, when known) */
  accessories: { model: string; partNumber: string; quantity?: number; note?: string }[]
  dataSource: string
  /** custom bracket (made to order): never preferred over a Festo kit */
  custom?: boolean
  /** custom bracket: its dimensioned drawing (PDF, data/… path) */
  drawing?: string
  /** `beam` brackets: the Festo angle kit pair it is bolted between (-ML, -MR; each base slide takes the hand reaching
   *  inwards), `end` (mm, the kits' carried end: beam end from the base slide centre, so the base spacing
   *  D = L + 2 · end), length range and reference length (mm), mass per metre (kg/m; `mass` is at the reference
   *  length), what it carries (`z`: a Z axis on the EHAM-MA plate in `accessories` on its pad, `pad` the pad's
   *  hole pattern and `padHeight` (mm) its centre above the base slide surface; `y`: the Y axis pinned on its front face, `pattern` the profile pattern it reproduces) */
  beam?: {
    kits: [string, string]
    end: number
    length: [number, number]
    referenceLength: number
    massPerMeter: number
    carries: 'y' | 'z'
    pad?: string
    padHeight?: number
    pattern?: string
  }
}
