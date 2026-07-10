import L from "leaflet";
import {
  BELL_COOLDOWN_MS,
  BELL_COUNTDOWN_MS,
  BELL_INTERACT_DISTANCE_M,
  BELL_RADIUS_M,
  BELL_STUN_DURATION_MS,
  CCTV_AGGRO_COOLDOWN_MS,
  CCTV_AGGRO_RELEASE_MS,
  CCTV_RADIUS_M,
  GLOBAL_SIREN_DURATION_MS,
  LIGHT_RADIUS_M,
  LIGHT_SLOW_FACTOR,
  PLAYER_INVULNERABLE_MS,
  PLAYER_MARKER_PX,
  PLAYER_MAX_HP,
  PLAYER_SPEED_MPS,
  POLICE_RADIUS_M,
  POLICE_BARRIER_FORM_MS,
  ZOMBIE_BASE_SPEED_MPS,
  ZOMBIE_COLLISION_DISTANCE_M,
  ZOMBIE_FLEE_SPEED_MULTIPLIER,
  ZOMBIE_MARKER_PX,
  ZOMBIE_RESPAWN_FADE_IN_MS,
  ZOMBIE_RESPAWN_FADE_OUT_MS,
  ZOMBIE_STUCK_ESCAPE_MS,
  ZOMBIE_STUCK_MIN_PROGRESS_M,
  ZOMBIE_STUCK_RESPAWN_MS,
  STORE_BOOST_DURATION_MS,
  STORE_COOLDOWN_MS,
  STORE_GAUGE_FILL_MS,
  STORE_RADIUS_M,
} from "./constants";
import { haversineDistance, offsetByMeters } from "./geo";
import { type RoadGraph } from "./roadGraph";
import {
  navigateToward,
  slideMove,
  ZOMBIE_STUCK_PROBE_ANGLES,
  type MovementResolver,
} from "./roadValidation";
import type {
  FacilityType,
  InputState,
  JoystickVector,
  LatLng,
  MovementLayer,
  NormalizedFacility,
  WalkLine,
} from "./types";

export interface ZombieNavigationContext {
  walkLines: WalkLine[];
  roadGraph: RoadGraph | null;
  findSpawnPosition: () => LatLng | null;
}

export function createEmojiIcon(emoji: string, size = 30): L.DivIcon {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div class="emoji-marker" style="font-size:${size}px;">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function createFacilityIcon(emoji: string, size: number, type: FacilityType): L.DivIcon {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div class="emoji-marker facility-marker-${type}" style="font-size:${size}px;">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** 마커 이모지에 걷기/뛰기 모션 클래스를 적용한다. */
function applyMotionClass(
  marker: L.Marker,
  motion: "idle" | "walk" | "run",
): void {
  const el = marker.getElement();
  if (!el) return;
  const inner = el.querySelector(".emoji-marker");
  if (!inner) return;
  inner.classList.toggle("emoji-walk", motion === "walk");
  inner.classList.toggle("emoji-run", motion === "run");
}

export function createHomeIcon(): L.DivIcon {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div class="home-marker"><span class="home-marker-emoji">🏠</span><span class="home-marker-label">집</span></div>`,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
  });
}

export type BellState = "IDLE" | "COUNTDOWN" | "COOLDOWN";
export type ZombieState = "CHASE" | "FLEE" | "STUNNED" | "DISTRACTED";

export interface PlayerCallbacks {
  onDamage: () => void;
  onHpChange: (hp: number) => void;
}

export class Player {
  lat: number;
  lng: number;
  speed = PLAYER_SPEED_MPS;
  hp = PLAYER_MAX_HP;
  invulnerableTime = 0;
  marker: L.Marker;
  movementLayer: MovementLayer = "surface";

  constructor(
    lat: number,
    lng: number,
    private map: L.Map,
    private callbacks: PlayerCallbacks,
  ) {
    this.lat = lat;
    this.lng = lng;
    this.marker = L.marker([lat, lng], {
      icon: createEmojiIcon("🏃‍♂️", PLAYER_MARKER_PX),
      zIndexOffset: 1000,
    }).addTo(map);
  }

  get latlng(): LatLng {
    return { lat: this.lat, lng: this.lng };
  }

  update(
    dt: number,
    keys: InputState,
    joystick: JoystickVector,
    playing: boolean,
    movement: MovementResolver,
    speedMultiplier = 1,
  ): void {
    if (!playing) return;

    let dx = 0;
    let dy = 0;

    if (keys.w || keys.ArrowUp) dy += 1;
    if (keys.s || keys.ArrowDown) dy -= 1;
    if (keys.a || keys.ArrowLeft) dx -= 1;
    if (keys.d || keys.ArrowRight) dx += 1;

    if (joystick.x !== 0 || joystick.y !== 0) {
      dx = joystick.x;
      dy = -joystick.y;
    }

    const length = Math.hypot(dx, dy);
    if (length > 0) {
      dx /= length;
      dy /= length;
    }

    const metersMoved = this.speed * speedMultiplier * (dt / 1000);
    const latDiff = (dy * metersMoved) / 111111;
    const lngDiff =
      (dx * metersMoved) / (111111 * Math.cos((this.lat * Math.PI) / 180));

    const nextLat = this.lat + latDiff;
    const nextLng = this.lng + lngDiff;
    const current = { lat: this.lat, lng: this.lng };
    const moved = slideMove(
      current,
      nextLat,
      nextLng,
      (lat, lng) => movement.canMove(current, { lat, lng }, this.movementLayer),
    );
    this.movementLayer = movement.resolveLayer(current, moved, this.movementLayer);
    const actuallyMoved =
      Math.abs(moved.lat - current.lat) > 1e-9 ||
      Math.abs(moved.lng - current.lng) > 1e-9;
    this.lat = moved.lat;
    this.lng = moved.lng;

    this.marker.setLatLng([this.lat, this.lng]);
    applyMotionClass(
      this.marker,
      !actuallyMoved ? "idle" : speedMultiplier > 1 ? "run" : "walk",
    );
    this.map.panTo([this.lat, this.lng], {
      animate: false,
      noMoveStart: true,
    });

    if (this.invulnerableTime > 0) {
      this.invulnerableTime -= dt;
      this.marker.setOpacity(
        Math.floor(Date.now() / 150) % 2 === 0 ? 0.3 : 1,
      );
    } else {
      this.marker.setOpacity(1);
    }
  }

  takeDamage(): void {
    if (this.invulnerableTime > 0) return;
    this.hp -= 1;
    this.invulnerableTime = PLAYER_INVULNERABLE_MS;
    this.callbacks.onHpChange(this.hp);
    this.callbacks.onDamage();
  }

  heal(amount = 1): void {
    const nextHp = Math.min(PLAYER_MAX_HP, this.hp + amount);
    if (nextHp === this.hp) return;
    this.hp = nextHp;
    this.callbacks.onHpChange(this.hp);
  }
}

export class Zombie {
  lat: number;
  lng: number;
  baseSpeed = ZOMBIE_BASE_SPEED_MPS;
  speed = ZOMBIE_BASE_SPEED_MPS;
  state: ZombieState = "CHASE";
  marker: L.Marker;
  movementLayer: MovementLayer;
  /** CCTV 어그로 해제 남은 시간(ms). >0 이면 플레이어를 쫓지 않음 */
  aggroReleaseTimer = 0;
  /** CCTV id별 어그로 해제 재발동 쿨다운 남은 시간(ms) */
  cctvCooldowns = new Map<string, number>();
  stuckTimer = 0;
  pathRefreshTimer = 0;
  waypoints: LatLng[] = [];
  waypointIndex = 0;
  fadePhase: "none" | "out" | "in" = "none";
  fadeTimer = 0;
  lastChaseDistM = Infinity;
  roadSnapCooldown = 0;

  constructor(
    lat: number,
    lng: number,
    map: L.Map,
    movementLayer: MovementLayer = "surface",
  ) {
    this.lat = lat;
    this.lng = lng;
    this.movementLayer = movementLayer;
    this.marker = L.marker([lat, lng], {
      icon: createEmojiIcon("🧟", ZOMBIE_MARKER_PX),
      zIndexOffset: 500,
    }).addTo(map);
  }

  get latlng(): LatLng {
    return { lat: this.lat, lng: this.lng };
  }

  private refreshChasePath(player: Player, nav: ZombieNavigationContext): void {
    void nav;
    this.waypoints = [player.latlng];
    this.waypointIndex = 0;
  }

  private canStepTo(
    current: LatLng,
    lat: number,
    lng: number,
    movement: MovementResolver,
    facilities: GameFacility[],
  ): boolean {
    return (
      movement.canMove(current, { lat, lng }, this.movementLayer) &&
      !facilities.some(
        (facility) =>
          facility.type === "police" &&
          facility.activated &&
          haversineDistance({ lat, lng }, facility.latlng) < facility.radius,
      )
    );
  }

  private stepToward(
    dt: number,
    targetLat: number,
    targetLng: number,
    movement: MovementResolver,
    facilities: GameFacility[],
    flee: boolean,
    useStuckEscape: boolean,
  ): boolean {
    let dy = targetLat - this.lat;
    let dx = targetLng - this.lng;
    const distDegrees = Math.hypot(dx, dy);
    if (distDegrees <= 0) return false;

    dy /= distDegrees;
    dx /= distDegrees;

    if (flee) {
      dy = -dy;
      dx = -dx;
    }

    const speed = flee ? this.speed * ZOMBIE_FLEE_SPEED_MULTIPLIER : this.speed;
    const metersMoved = speed * (dt / 1000);
    const latDiff = (dy * metersMoved) / 111111;
    const lngDiff =
      (dx * metersMoved) / (111111 * Math.cos((this.lat * Math.PI) / 180));

    const nextLat = this.lat + latDiff;
    const nextLng = this.lng + lngDiff;
    const current = { lat: this.lat, lng: this.lng };
    const isValid = (lat: number, lng: number) =>
      this.canStepTo(current, lat, lng, movement, facilities);

    const moved = useStuckEscape
      ? navigateToward(
          current,
          { lat: nextLat, lng: nextLng },
          metersMoved,
          isValid,
          { probeAngles: ZOMBIE_STUCK_PROBE_ANGLES, flee },
        )
      : slideMove(current, nextLat, nextLng, isValid);

    this.movementLayer = movement.resolveLayer(current, moved, this.movementLayer);
    const actuallyMoved =
      Math.abs(moved.lat - current.lat) > 1e-9 ||
      Math.abs(moved.lng - current.lng) > 1e-9;
    this.lat = moved.lat;
    this.lng = moved.lng;
    this.marker.setLatLng([this.lat, this.lng]);
    return actuallyMoved;
  }

  update(
    dt: number,
    player: Player,
    facilities: GameFacility[],
    globalSirenActive: boolean,
    globalStunActive: boolean,
    storeChargingActive: boolean,
    movement: MovementResolver,
    nav: ZombieNavigationContext,
  ): void {
    const previousState = this.state;

    for (const [id, remaining] of this.cctvCooldowns) {
      const next = remaining - dt;
      if (next <= 0) this.cctvCooldowns.delete(id);
      else this.cctvCooldowns.set(id, next);
    }
    if (this.aggroReleaseTimer > 0) {
      this.aggroReleaseTimer -= dt;
    }

    if (globalStunActive) {
      this.state = "STUNNED";
      this.speed = 0;
      this.stuckTimer = 0;
      this.fadePhase = "none";
      if (previousState !== "STUNNED") {
        this.marker.setIcon(createEmojiIcon("⚡🧟⚡", ZOMBIE_MARKER_PX));
      }
      applyMotionClass(this.marker, "idle");
      this.marker.setOpacity(Math.floor(Date.now() / 120) % 2 === 0 ? 0.45 : 1);
      return;
    }

    if (storeChargingActive) {
      this.state = "STUNNED";
      this.speed = 0;
      this.stuckTimer = 0;
      this.fadePhase = "none";
      if (previousState !== "STUNNED") {
        this.marker.setIcon(createEmojiIcon("🧟", ZOMBIE_MARKER_PX));
      }
      applyMotionClass(this.marker, "idle");
      this.marker.setOpacity(1);
      return;
    }

    if (this.fadePhase === "out") {
      this.fadeTimer += dt;
      const t = Math.min(1, this.fadeTimer / ZOMBIE_RESPAWN_FADE_OUT_MS);
      this.marker.setOpacity(1 - t);
      applyMotionClass(this.marker, "idle");
      if (this.fadeTimer >= ZOMBIE_RESPAWN_FADE_OUT_MS) {
        const spawn = nav.findSpawnPosition();
        if (spawn) {
          this.lat = spawn.lat;
          this.lng = spawn.lng;
          this.marker.setLatLng([this.lat, this.lng]);
        }
        this.stuckTimer = 0;
        this.waypoints = [];
        this.waypointIndex = 0;
        this.pathRefreshTimer = 0;
        this.fadePhase = "in";
        this.fadeTimer = 0;
        this.marker.setOpacity(0);
        this.marker.setIcon(createEmojiIcon("🧟", ZOMBIE_MARKER_PX));
      }
      return;
    }

    if (this.fadePhase === "in") {
      this.fadeTimer += dt;
      const t = Math.min(1, this.fadeTimer / ZOMBIE_RESPAWN_FADE_IN_MS);
      this.marker.setOpacity(t);
      applyMotionClass(this.marker, "idle");
      if (this.fadeTimer >= ZOMBIE_RESPAWN_FADE_IN_MS) {
        this.fadePhase = "none";
        this.fadeTimer = 0;
        this.marker.setOpacity(1);
      }
      return;
    }

    this.marker.setOpacity(1);

    let nearPolice = false;
    let policeLat = 0;
    let policeLng = 0;
    let inLight = false;

    const self = this.latlng;
    for (const f of facilities) {
      if (
        f.type === "police" &&
        f.activated &&
        haversineDistance(self, f.latlng) < f.radius
      ) {
        nearPolice = true;
        policeLat = f.lat;
        policeLng = f.lng;
      }
      if (f.type === "light" && haversineDistance(self, f.latlng) < f.radius) {
        inLight = true;
      }
      if (f.type === "cctv" && haversineDistance(self, f.latlng) < f.radius) {
        // 이 CCTV로 최근에 어그로가 해제되지 않았다면 새로 해제한다.
        if (!this.cctvCooldowns.has(f.id)) {
          this.aggroReleaseTimer = CCTV_AGGRO_RELEASE_MS;
          this.cctvCooldowns.set(f.id, CCTV_AGGRO_COOLDOWN_MS);
        }
      }
    }

    const distracted = this.aggroReleaseTimer > 0;

    if (nearPolice) {
      this.state = "FLEE";
    } else if (globalSirenActive) {
      this.state = "FLEE";
    } else if (distracted) {
      // 어그로 해제: 플레이어를 쫓지 않고 그 자리에 멈춘다.
      this.state = "DISTRACTED";
    } else {
      this.state = "CHASE";
    }

    this.speed = inLight ? this.baseSpeed * LIGHT_SLOW_FACTOR : this.baseSpeed;
    if (this.state !== previousState) {
      this.lastChaseDistM = Infinity;
      this.marker.setIcon(
        createEmojiIcon(
          this.state === "FLEE"
            ? "🏃"
            : this.state === "DISTRACTED"
              ? "❓🧟"
              : "🧟",
          ZOMBIE_MARKER_PX,
        ),
      );
    }

    if (this.state === "DISTRACTED") {
      this.stuckTimer = 0;
      applyMotionClass(this.marker, "idle");
      return;
    }

    this.refreshChasePath(player, nav);
    const useRoadPath = false;

    let moveTargetLat = player.lat;
    let moveTargetLng = player.lng;
    if (useRoadPath && this.waypoints.length > 0) {
      const wp = this.waypoints[this.waypointIndex];
      moveTargetLat = wp.lat;
      moveTargetLng = wp.lng;
    } else if (this.state === "FLEE") {
      moveTargetLat = nearPolice ? policeLat : player.lat;
      moveTargetLng = nearPolice ? policeLng : player.lng;
    }

    const distDegrees = Math.hypot(moveTargetLat - this.lat, moveTargetLng - this.lng);

    if (distDegrees > 0) {
      const stepTargetLat = moveTargetLat;
      const stepTargetLng = moveTargetLng;
      const useStuckEscape = this.stuckTimer >= ZOMBIE_STUCK_ESCAPE_MS;

      const distToPlayerBefore = haversineDistance(this.latlng, player.latlng);
      const stepTarget = { lat: stepTargetLat, lng: stepTargetLng };
      const distToStepBefore = haversineDistance(this.latlng, stepTarget);
      const threatPos = {
        lat: nearPolice ? policeLat : player.lat,
        lng: nearPolice ? policeLng : player.lng,
      };
      const threatDistBefore =
        this.state === "FLEE" ? haversineDistance(this.latlng, threatPos) : 0;

      const actuallyMoved = this.stepToward(
        dt,
        stepTargetLat,
        stepTargetLng,
        movement,
        facilities,
        this.state === "FLEE",
        useStuckEscape,
      );

      const distToPlayerAfter = haversineDistance(this.latlng, player.latlng);
      const distToStepAfter = haversineDistance(this.latlng, stepTarget);
      const threatDistAfter =
        this.state === "FLEE" ? haversineDistance(this.latlng, threatPos) : 0;

      const madeProgress =
        this.state === "FLEE"
          ? threatDistAfter > threatDistBefore + ZOMBIE_STUCK_MIN_PROGRESS_M * 0.5
          : useRoadPath && this.waypoints.length > 0
            ? distToStepBefore - distToStepAfter >= ZOMBIE_STUCK_MIN_PROGRESS_M
            : distToPlayerBefore - distToPlayerAfter >= ZOMBIE_STUCK_MIN_PROGRESS_M;

      this.lastChaseDistM =
        this.state === "FLEE" ? threatDistAfter : distToPlayerAfter;

      const wantsToMove = this.state === "CHASE" || this.state === "FLEE";
      if (wantsToMove && this.speed > 0) {
        if (!actuallyMoved || !madeProgress) {
          this.stuckTimer += dt;
        } else {
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = 0;
      }

      if (this.stuckTimer >= ZOMBIE_STUCK_RESPAWN_MS) {
        this.fadePhase = "out";
        this.fadeTimer = 0;
        applyMotionClass(this.marker, "idle");
        return;
      }

      if (this.stuckTimer >= ZOMBIE_STUCK_ESCAPE_MS && this.state === "CHASE") {
        this.marker.setIcon(createEmojiIcon("🫠🧟", ZOMBIE_MARKER_PX));
      } else if (this.stuckTimer === 0 && this.state === "CHASE") {
        this.marker.setIcon(createEmojiIcon("🧟", ZOMBIE_MARKER_PX));
      }

      applyMotionClass(
        this.marker,
        !actuallyMoved ? "idle" : this.state === "FLEE" ? "run" : "walk",
      );
    } else {
      this.stuckTimer = 0;
      applyMotionClass(this.marker, "idle");
    }

    const distToPlayer = haversineDistance(this.latlng, player.latlng);
    const playerProtected = facilities.some(
      (facility) =>
        facility.type === "police" &&
        facility.activated &&
        haversineDistance(player.latlng, facility.latlng) < facility.radius,
    );
    if (
      this.state === "CHASE" &&
      !playerProtected &&
      this.movementLayer === player.movementLayer &&
      distToPlayer < ZOMBIE_COLLISION_DISTANCE_M
    ) {
      player.takeDamage();
    }
  }

  destroy(map: L.Map): void {
    map.removeLayer(this.marker);
  }
}

export interface GameFacilityCallbacks {
  onToast: (msg: string) => void;
  onBellStun: (durationMs: number) => void;
  onStoreBoost: (durationMs: number) => void;
  onPoliceRest: () => void;
}

export class GameFacility {
  type: FacilityType;
  lat: number;
  lng: number;
  radius: number;
  bellState: BellState = "IDLE";
  countdown = 0;
  marker: L.Marker | L.CircleMarker;
  circle: L.Circle | null;
  readonly id: string;
  activated = false;
  /** 편의점 게이지 진행도 0~1 */
  gaugeProgress = 0;
  /** 파출소 배리어 파이 채움 0~1 */
  policeBarrierProgress = 0;
  policeBarrierForming = false;
  private policePieFill: L.Polygon | null = null;
  private policeBarrierEdge: L.Polyline | null = null;
  private policeDisplayLat: number;
  private policeDisplayLng: number;

  constructor(
    data: NormalizedFacility,
    private map: L.Map,
    private callbacks: GameFacilityCallbacks,
  ) {
    this.id = data.id;
    this.type = data.type;
    this.lat = data.lat;
    this.lng = data.lng;
    this.radius = this.resolveRadius(data.type);
    const mapLat = data.displayLat ?? this.lat;
    const mapLng = data.displayLng ?? this.lng;
    this.policeDisplayLat = mapLat;
    this.policeDisplayLng = mapLng;
    this.marker =
      data.type === "light"
        ? L.circleMarker([mapLat, mapLng], {
            radius: 3,
            color: "#facc15",
            fillColor: "#fde047",
            fillOpacity: 0.85,
            weight: 1,
          }).addTo(map)
        : L.marker([mapLat, mapLng], {
            icon: createFacilityIcon(this.emojiForType(data.type), this.iconSize(), data.type),
            zIndexOffset: this.markerZIndex(),
          }).addTo(map);
    if (data.name || data.address) {
      const lines = [data.name, data.address].filter(Boolean).join("<br/>");
      this.marker.bindPopup(lines);
    }
    this.circle =
      this.type === "light" ||
      this.type === "bell" ||
      this.type === "cctv" ||
      this.type === "store" ||
      this.type === "police"
        ? this.createCircle(mapLat, mapLng)
        : null;
  }

  private markerZIndex(): number {
    if (this.type === "police") return 690;
    if (this.type === "store") return 680;
    if (this.type === "bell") return 670;
    if (this.type === "cctv") return 660;
    return 650;
  }

  get latlng(): LatLng {
    return { lat: this.lat, lng: this.lng };
  }

  private resolveRadius(type: FacilityType): number {
    if (type === "light") return LIGHT_RADIUS_M;
    if (type === "cctv") return CCTV_RADIUS_M;
    if (type === "police") return POLICE_RADIUS_M;
    if (type === "store") return STORE_RADIUS_M;
    return BELL_RADIUS_M;
  }

  private emojiForType(type: FacilityType): string {
    if (type === "store") return "🏪";
    if (type === "light") return "💡";
    if (type === "police") return "🚓";
    if (type === "cctv") return "📹";
    return "🚨";
  }

  private iconSize(): number {
    if (this.type === "police") return 28;
    if (this.type === "cctv") return 22;
    if (this.type === "bell") return 25;
    if (this.type === "store") return 28;
    return 20;
  }

  private createCircle(mapLat: number, mapLng: number): L.Circle {
    if (this.type === "cctv") {
      return L.circle([mapLat, mapLng], {
        radius: this.radius,
        color: "#38bdf8",
        fillColor: "#0ea5e9",
        fillOpacity: 0.1,
        weight: 1,
      }).addTo(this.map);
    }
    if (this.type === "light") {
      return L.circle([mapLat, mapLng], {
        radius: this.radius,
        color: "yellow",
        fillColor: "#fde047",
        fillOpacity: 0.3,
        weight: 1,
      }).addTo(this.map);
    }
    if (this.type === "police") {
      return L.circle([mapLat, mapLng], {
        radius: this.radius,
        color: "#60a5fa",
        fillColor: "#3b82f6",
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: "5, 6",
        className: "police-barrier-idle",
      }).addTo(this.map);
    }
    if (this.type === "store") {
      return L.circle([mapLat, mapLng], {
        radius: this.radius,
        color: "#22c55e",
        fillColor: "#4ade80",
        fillOpacity: 0.2,
        weight: 1,
      }).addTo(this.map);
    }
    return L.circle([mapLat, mapLng], {
      radius: this.radius,
      color: "red",
      fillColor: "#ef4444",
      fillOpacity: 0.5,
      weight: 2,
    }).addTo(this.map);
  }

  updatePoliceBarrier(dt: number): void {
    if (this.type !== "police" || !this.policeBarrierForming) return;

    this.policeBarrierProgress = Math.min(
      1,
      this.policeBarrierProgress + dt / POLICE_BARRIER_FORM_MS,
    );
    this.renderPoliceBarrierPie();

    const ringWeight = 1.5 + this.policeBarrierProgress * 1.5;
    this.circle?.setStyle({
      color: "#93c5fd",
      weight: ringWeight,
      fillOpacity: 0,
      dashArray: this.policeBarrierProgress >= 1 ? undefined : "5, 6",
    });

    if (this.policeBarrierProgress >= 1) {
      this.finishPoliceBarrier();
    }
  }

  private startPoliceBarrierFormation(): void {
    this.policeBarrierForming = true;
    this.policeBarrierProgress = 0;
    this.circle?.setStyle({
      color: "#93c5fd",
      fillOpacity: 0,
      weight: 2,
      dashArray: "5, 6",
      className: "police-barrier-forming",
    });
    this.renderPoliceBarrierPie();
    this.callbacks.onToast("경찰 안전구역이 형성되고 있습니다...");
  }

  private finishPoliceBarrier(): void {
    this.policeBarrierForming = false;
    this.activated = true;
    this.clearPoliceBarrierLayers();
    this.circle?.setStyle({
      color: "#2563eb",
      fillColor: "#3b82f6",
      fillOpacity: 0.32,
      weight: 3,
      dashArray: undefined,
      className: "police-barrier-active",
    });
    this.callbacks.onPoliceRest();
    this.callbacks.onToast(
      "경찰 안전구역이 활성화되었습니다. 이곳에서는 무제한으로 쉴 수 있습니다.",
    );
  }

  private clearPoliceBarrierLayers(): void {
    if (this.policePieFill) {
      this.map.removeLayer(this.policePieFill);
      this.policePieFill = null;
    }
    if (this.policeBarrierEdge) {
      this.map.removeLayer(this.policeBarrierEdge);
      this.policeBarrierEdge = null;
    }
  }

  private renderPoliceBarrierPie(): void {
    const center = { lat: this.policeDisplayLat, lng: this.policeDisplayLng };
    const sweep = this.policeBarrierProgress * Math.PI * 2;
    if (sweep <= 0.001) {
      this.clearPoliceBarrierLayers();
      return;
    }

    const piePoints = buildPolicePiePolygon(center, this.radius, sweep);
    const fillOpacity = 0.18 + this.policeBarrierProgress * 0.22;

    if (!this.policePieFill) {
      this.policePieFill = L.polygon(piePoints, {
        color: "#60a5fa",
        fillColor: "#3b82f6",
        fillOpacity,
        weight: 2,
        className: "police-barrier-pie",
      }).addTo(this.map);
    } else {
      this.policePieFill.setLatLngs(piePoints);
      this.policePieFill.setStyle({ fillOpacity, weight: 2 });
    }

    const startAngle = -Math.PI / 2;
    const edge = offsetByMeters(
      center,
      Math.cos(startAngle + sweep) * this.radius,
      Math.sin(startAngle + sweep) * this.radius,
    );
    const edgeLine: L.LatLngExpression[] = [
      [center.lat, center.lng],
      [edge.lat, edge.lng],
    ];

    if (!this.policeBarrierEdge) {
      this.policeBarrierEdge = L.polyline(edgeLine, {
        color: "#dbeafe",
        weight: 3,
        opacity: 0.95,
        className: "police-barrier-sweep",
      }).addTo(this.map);
    } else {
      this.policeBarrierEdge.setLatLngs(edgeLine);
    }
  }

  update(dt: number): void {
    if (this.type !== "bell") return;

    if (this.bellState === "COUNTDOWN") {
      this.countdown -= dt;
      const secs = Math.ceil(this.countdown / 1000);
      if (!(this.marker instanceof L.Marker)) return;
      this.marker.setIcon(
        L.divIcon({
          className: "custom-div-icon",
          html: `<div class="emoji-marker font-bold text-red-500 bg-black/50 rounded-full px-2" style="font-size:16px;">${secs}s</div>`,
          iconAnchor: [15, 15],
        }),
      );
      if (this.countdown <= 0) {
        this.callbacks.onBellStun(BELL_STUN_DURATION_MS);
        this.bellState = "COOLDOWN";
        this.countdown = BELL_COOLDOWN_MS;
        this.circle?.setStyle({ color: "gray", fillColor: "gray" });
      }
    } else if (this.bellState === "COOLDOWN") {
      this.countdown -= dt;
      if (this.marker instanceof L.Marker) {
        this.marker.setIcon(createEmojiIcon("⏳", 20));
      }
      if (this.countdown <= 0) {
        this.bellState = "IDLE";
        this.circle?.setStyle({ color: "red", fillColor: "#ef4444" });
        if (this.marker instanceof L.Marker) {
          this.marker.setIcon(
            createEmojiIcon(this.emojiForType(this.type), this.iconSize()),
          );
        }
      }
    }
  }

  /**
   * 편의점 게이지: 반경 안에 머무르면 게이지가 차오르고, 가득 차면 발동한다.
   * 발동 후에는 쿨다운 동안 재충전되지 않는다.
   */
  updateStore(dt: number, playerPos: LatLng, playing: boolean): void {
    if (this.type !== "store") return;

    if (this.bellState === "COOLDOWN") {
      this.countdown -= dt;
      this.gaugeProgress = 0;
      if (this.marker instanceof L.Marker) {
        this.marker.setIcon(createEmojiIcon("⏳", this.iconSize()));
      }
      if (this.countdown <= 0) {
        this.bellState = "IDLE";
        this.circle?.setStyle({ color: "#22c55e", fillColor: "#4ade80" });
        if (this.marker instanceof L.Marker) {
          this.marker.setIcon(
            createEmojiIcon(this.emojiForType(this.type), this.iconSize()),
          );
        }
      }
      return;
    }

    const inRange =
      playing && haversineDistance(this.latlng, playerPos) <= this.radius;

    if (inRange) {
      this.gaugeProgress = Math.min(1, this.gaugeProgress + dt / STORE_GAUGE_FILL_MS);
      this.circle?.setStyle({ color: "#16a34a", fillColor: "#22c55e", fillOpacity: 0.35 });
      if (this.gaugeProgress >= 1) {
        this.gaugeProgress = 0;
        this.bellState = "COOLDOWN";
        this.countdown = STORE_COOLDOWN_MS;
        this.callbacks.onStoreBoost(STORE_BOOST_DURATION_MS);
        this.callbacks.onToast(
          "에너지 드링크 획득! 5초 동안 이동 속도가 1.2배가 됩니다.",
        );
        this.circle?.setStyle({ color: "gray", fillColor: "gray", fillOpacity: 0.2 });
      }
    } else if (this.gaugeProgress > 0) {
      // 반경을 벗어나면 게이지가 서서히 줄어든다.
      this.gaugeProgress = Math.max(0, this.gaugeProgress - dt / STORE_GAUGE_FILL_MS);
      if (this.gaugeProgress === 0) {
        this.circle?.setStyle({ color: "#22c55e", fillColor: "#4ade80", fillOpacity: 0.2 });
      }
    }
  }

  touch(playerPos: LatLng, playing = true): void {
    if (!playing) return;

    const dist = haversineDistance(this.latlng, playerPos);

    // 파출소·지구대: 반경(8m) 안에 들어오면 배리어 형성 시작
    if (this.type === "police") {
      if (this.activated || this.policeBarrierForming || dist > this.radius) return;
      this.startPoliceBarrierFormation();
      return;
    }

    // 안심벨: 근접 시 카운트다운 시작
    if (this.type === "bell") {
      if (this.bellState !== "IDLE" || dist > BELL_INTERACT_DISTANCE_M) return;
      this.bellState = "COUNTDOWN";
      this.countdown = BELL_COUNTDOWN_MS;
      this.callbacks.onToast("비상벨 감지! 5초 뒤 좀비가 3초간 감전됩니다.");
    }
  }

  interact(getPlayerLatLng: () => LatLng | null, playing = true): void {
    if (!playing || this.type !== "bell" || this.bellState !== "IDLE") return;
    const playerPos = getPlayerLatLng();
    if (!playerPos) return;

    const dist = haversineDistance(this.latlng, playerPos);
    if (dist > BELL_INTERACT_DISTANCE_M) {
      this.callbacks.onToast("안심벨에 더 가까이 다가가야 합니다.");
      return;
    }

    this.bellState = "COUNTDOWN";
    this.countdown = BELL_COUNTDOWN_MS;
    this.callbacks.onToast("비상벨 감지! 5초 뒤 좀비가 3초간 감전됩니다.");
  }

  destroy(): void {
    this.map.removeLayer(this.marker);
    this.clearPoliceBarrierLayers();
    if (this.circle) this.map.removeLayer(this.circle);
  }
}

function buildPolicePiePolygon(
  center: LatLng,
  radiusM: number,
  sweepRadians: number,
): L.LatLngExpression[] {
  const startAngle = -Math.PI / 2;
  const segments = Math.max(8, Math.ceil(32 * (sweepRadians / (Math.PI * 2))));
  const points: L.LatLngExpression[] = [[center.lat, center.lng]];

  for (let i = 0; i <= segments; i += 1) {
    const angle = startAngle + (sweepRadians * i) / segments;
    const pt = offsetByMeters(
      center,
      Math.cos(angle) * radiusM,
      Math.sin(angle) * radiusM,
    );
    points.push([pt.lat, pt.lng]);
  }

  return points;
}

/** 편의점 반경에서 게이지 충전 중이면 좀비를 멈춘다. */
export function isPlayerStoreCharging(
  playerPos: LatLng,
  facilities: GameFacility[],
): boolean {
  for (const facility of facilities) {
    if (facility.type !== "store" || facility.bellState === "COOLDOWN") continue;
    if (facility.gaugeProgress <= 0) continue;
    if (haversineDistance(facility.latlng, playerPos) <= facility.radius) {
      return true;
    }
  }
  return false;
}

export function triggerGlobalSirenState(): {
  active: boolean;
  timer: number;
} {
  return { active: true, timer: GLOBAL_SIREN_DURATION_MS };
}
