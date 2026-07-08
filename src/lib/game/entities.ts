import L from "leaflet";
import {
  BELL_COOLDOWN_MS,
  BELL_COUNTDOWN_MS,
  BELL_INTERACT_DISTANCE_M,
  BELL_RADIUS_M,
  BELL_STUN_DURATION_MS,
  CCTV_RADIUS_M,
  GLOBAL_SIREN_DURATION_MS,
  LIGHT_RADIUS_M,
  LIGHT_SLOW_FACTOR,
  PLAYER_INVULNERABLE_MS,
  PLAYER_MAX_HP,
  PLAYER_SPEED_MPS,
  POLICE_RADIUS_M,
  ZOMBIE_BASE_SPEED_MPS,
  ZOMBIE_COLLISION_DISTANCE_M,
  ZOMBIE_FLEE_SPEED_MULTIPLIER,
  STORE_FLEE_DURATION_MS,
  STORE_COOLDOWN_MS,
} from "./constants";
import { haversineDistance } from "./geo";
import {
  navigateToward,
  slideMove,
  ZOMBIE_PROBE_ANGLES,
  type MovementResolver,
} from "./roadValidation";
import type {
  FacilityType,
  InputState,
  JoystickVector,
  LatLng,
  MovementLayer,
  NormalizedFacility,
} from "./types";

export function createEmojiIcon(emoji: string, size = 30): L.DivIcon {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div class="emoji-marker" style="font-size:${size}px;">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
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
export type ZombieState = "CHASE" | "FLEE" | "STUNNED" | "WANDER";

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
      icon: createEmojiIcon("🏃‍♂️", 40),
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
    this.lat = moved.lat;
    this.lng = moved.lng;

    this.marker.setLatLng([this.lat, this.lng]);
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
  wanderHeading = 0;
  wanderTimer = 0;

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
      icon: createEmojiIcon("🧟", 35),
      zIndexOffset: 500,
    }).addTo(map);
  }

  get latlng(): LatLng {
    return { lat: this.lat, lng: this.lng };
  }

  update(
    dt: number,
    player: Player,
    facilities: GameFacility[],
    globalSirenActive: boolean,
    globalStunActive: boolean,
    movement: MovementResolver,
  ): void {
    const previousState = this.state;
    if (globalStunActive) {
      this.state = "STUNNED";
      this.speed = 0;
      if (previousState !== "STUNNED") {
        this.marker.setIcon(createEmojiIcon("⚡🧟⚡", 35));
      }
      this.marker.setOpacity(Math.floor(Date.now() / 120) % 2 === 0 ? 0.45 : 1);
      return;
    }
    this.marker.setOpacity(1);

    let targetLat = player.lat;
    let targetLng = player.lng;

    let nearPolice = false;
    let policeLat = 0;
    let policeLng = 0;
    let inLight = false;
    let inCctv = false;

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
        inCctv = true;
      }
    }

    if (nearPolice) {
      this.state = "FLEE";
      targetLat = policeLat;
      targetLng = policeLng;
    } else if (globalSirenActive) {
      this.state = "FLEE";
      targetLat = player.lat;
      targetLng = player.lng;
    } else if (inCctv) {
      this.state = "WANDER";
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderHeading = Math.random() * Math.PI * 2;
        this.wanderTimer = 700 + Math.random() * 900;
      }
      targetLat = this.lat + Math.sin(this.wanderHeading) * 0.001;
      targetLng = this.lng + Math.cos(this.wanderHeading) * 0.001;
    } else {
      this.state = "CHASE";
    }

    this.speed = inLight ? this.baseSpeed * LIGHT_SLOW_FACTOR : this.baseSpeed;
    if (this.state !== previousState) {
      this.marker.setIcon(
        createEmojiIcon(
          this.state === "FLEE" ? "🏃" : this.state === "WANDER" ? "❓🧟" : "🧟",
          35,
        ),
      );
    }

    let dy = targetLat - this.lat;
    let dx = targetLng - this.lng;
    const distDegrees = Math.hypot(dx, dy);

    if (distDegrees > 0) {
      dy /= distDegrees;
      dx /= distDegrees;

      if (this.state === "FLEE") {
        dy = -dy;
        dx = -dx;
        this.speed *= ZOMBIE_FLEE_SPEED_MULTIPLIER;
      }

      const metersMoved = this.speed * (dt / 1000);
      const latDiff = (dy * metersMoved) / 111111;
      const lngDiff =
        (dx * metersMoved) / (111111 * Math.cos((this.lat * Math.PI) / 180));

      const nextLat = this.lat + latDiff;
      const nextLng = this.lng + lngDiff;
      const current = { lat: this.lat, lng: this.lng };
      const moved = navigateToward(
        current,
        { lat: nextLat, lng: nextLng },
        metersMoved,
        (lat, lng) =>
          movement.canMove(current, { lat, lng }, this.movementLayer) &&
          !facilities.some(
            (facility) =>
              facility.type === "police" &&
              facility.activated &&
              haversineDistance({ lat, lng }, facility.latlng) < facility.radius,
          ),
        { probeAngles: ZOMBIE_PROBE_ANGLES },
      );
      this.movementLayer = movement.resolveLayer(current, moved, this.movementLayer);
      this.lat = moved.lat;
      this.lng = moved.lng;
      this.marker.setLatLng([this.lat, this.lng]);
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
  onStoreFlee: (durationMs: number) => void;
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
    this.marker =
      data.type === "light" || data.type === "cctv"
        ? L.circleMarker([this.lat, this.lng], {
            radius: data.type === "light" ? 3 : 4,
            color: data.type === "light" ? "#facc15" : "#38bdf8",
            fillColor: data.type === "light" ? "#fde047" : "#0ea5e9",
            fillOpacity: 0.85,
            weight: 1,
          }).addTo(map)
        : L.marker([this.lat, this.lng], {
            icon: createEmojiIcon(this.emojiForType(data.type), this.iconSize()),
          }).addTo(map);
    if (data.name || data.address) {
      const lines = [data.name, data.address].filter(Boolean).join("<br/>");
      this.marker.bindPopup(lines);
    }
    this.circle =
      this.type === "light" || this.type === "bell" || this.type === "cctv"
        ? this.createCircle()
        : null;
  }

  get latlng(): LatLng {
    return { lat: this.lat, lng: this.lng };
  }

  private resolveRadius(type: FacilityType): number {
    if (type === "light") return LIGHT_RADIUS_M;
    if (type === "cctv") return CCTV_RADIUS_M;
    if (type === "police") return POLICE_RADIUS_M;
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
    if (this.type === "police") return 30;
    if (this.type === "cctv") return 22;
    if (this.type === "bell") return 25;
    if (this.type === "store") return 28;
    return 20;
  }

  private createCircle(): L.Circle {
    if (this.type === "cctv") {
      return L.circle([this.lat, this.lng], {
        radius: this.radius,
        color: "#38bdf8",
        fillColor: "#0ea5e9",
        fillOpacity: 0.1,
        weight: 1,
      }).addTo(this.map);
    }
    if (this.type === "light") {
      return L.circle([this.lat, this.lng], {
        radius: this.radius,
        color: "yellow",
        fillColor: "#fde047",
        fillOpacity: 0.3,
        weight: 1,
      }).addTo(this.map);
    }
    if (this.type === "police") {
      return L.circle([this.lat, this.lng], {
        radius: this.radius,
        color: "blue",
        fillColor: "#3b82f6",
        fillOpacity: 0.2,
        weight: 1,
        dashArray: "5, 5",
      }).addTo(this.map);
    }
    return L.circle([this.lat, this.lng], {
      radius: this.radius,
      color: "red",
      fillColor: "#ef4444",
      fillOpacity: 0.5,
      weight: 2,
    }).addTo(this.map);
  }

  update(dt: number): void {
    if (this.type !== "bell" && this.type !== "store") return;

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
        if (this.type === "bell") {
          this.callbacks.onBellStun(BELL_STUN_DURATION_MS);
        } else {
          this.callbacks.onStoreFlee(STORE_FLEE_DURATION_MS);
        }
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

  touch(playerPos: LatLng, playing = true): void {
    if (!playing || haversineDistance(this.latlng, playerPos) > BELL_INTERACT_DISTANCE_M) {
      return;
    }

    if (this.type === "police") {
      if (this.activated) return;
      this.activated = true;
      this.circle = this.createCircle();
      this.callbacks.onPoliceRest();
      this.callbacks.onToast("경찰 안전구역이 활성화되었습니다. 이곳에서는 무제한으로 쉴 수 있습니다.");
      return;
    }

    if (this.type === "store") {
      if (this.bellState !== "IDLE") return;
      this.bellState = "COOLDOWN";
      this.countdown = STORE_COOLDOWN_MS;
      this.callbacks.onStoreFlee(STORE_FLEE_DURATION_MS);
      this.callbacks.onToast(
        "에너지 드링크 획득! 5초 동안 이동 속도가 1.2배가 되고 좀비가 도망갑니다.",
      );
      return;
    }

    if (this.type !== "bell" || this.bellState !== "IDLE") {
      return;
    }

    this.bellState = "COUNTDOWN";
    this.countdown = BELL_COUNTDOWN_MS;
    this.callbacks.onToast(
      this.type === "bell"
        ? "비상벨 감지! 5초 뒤 좀비가 감전됩니다."
        : "편의점 진입! 5초 뒤 좀비가 반대 방향으로 도망갑니다.",
    );
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
    this.callbacks.onToast("비상벨 감지! 5초 뒤 좀비가 감전됩니다.");
  }

  destroy(): void {
    this.map.removeLayer(this.marker);
    if (this.circle) this.map.removeLayer(this.circle);
  }
}

export function triggerGlobalSirenState(): {
  active: boolean;
  timer: number;
} {
  return { active: true, timer: GLOBAL_SIREN_DURATION_MS };
}
