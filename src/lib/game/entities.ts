import L from "leaflet";
import {
  BELL_COOLDOWN_MS,
  BELL_COUNTDOWN_MS,
  BELL_INTERACT_DISTANCE_M,
  BELL_RADIUS_M,
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
} from "./constants";
import { haversineDistance } from "./geo";
import { slideMove } from "./roadValidation";
import type {
  FacilityType,
  InputState,
  JoystickVector,
  LatLng,
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
export type ZombieState = "CHASE" | "FLEE";

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
    isValid: (lat: number, lng: number) => boolean,
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

    const metersMoved = this.speed * (dt / 1000);
    const latDiff = (dy * metersMoved) / 111111;
    const lngDiff =
      (dx * metersMoved) / (111111 * Math.cos((this.lat * Math.PI) / 180));

    const nextLat = this.lat + latDiff;
    const nextLng = this.lng + lngDiff;
    const moved = slideMove(
      { lat: this.lat, lng: this.lng },
      nextLat,
      nextLng,
      isValid,
    );
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
}

export class Zombie {
  lat: number;
  lng: number;
  baseSpeed = ZOMBIE_BASE_SPEED_MPS;
  speed = ZOMBIE_BASE_SPEED_MPS;
  state: ZombieState = "CHASE";
  marker: L.Marker;

  constructor(lat: number, lng: number, map: L.Map) {
    this.lat = lat;
    this.lng = lng;
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
    isValid: (lat: number, lng: number) => boolean,
  ): void {
    let targetLat = player.lat;
    let targetLng = player.lng;

    let nearPolice = false;
    let policeLat = 0;
    let policeLng = 0;
    let inLight = false;

    const self = this.latlng;
    for (const f of facilities) {
      if (
        f.type === "police" &&
        haversineDistance(self, f.latlng) < f.radius
      ) {
        nearPolice = true;
        policeLat = f.lat;
        policeLng = f.lng;
      }
      if (f.type === "light" && haversineDistance(self, f.latlng) < f.radius) {
        inLight = true;
      }
    }

    if (globalSirenActive) {
      this.state = "FLEE";
      targetLat = player.lat;
      targetLng = player.lng;
    } else if (nearPolice) {
      this.state = "FLEE";
      targetLat = policeLat;
      targetLng = policeLng;
    } else {
      this.state = "CHASE";
    }

    this.speed =
      inLight && this.state === "CHASE"
        ? this.baseSpeed * LIGHT_SLOW_FACTOR
        : this.baseSpeed;
    this.marker.setIcon(
      createEmojiIcon(this.state === "FLEE" ? "🏃" : "🧟", 35),
    );

    let dy = targetLat - this.lat;
    let dx = targetLng - this.lng;
    const distDegrees = Math.hypot(dx, dy);

    if (distDegrees > 0) {
      dy /= distDegrees;
      dx /= distDegrees;

      if (this.state === "FLEE") {
        dy = -dy;
        dx = -dx;
        this.speed = this.baseSpeed * ZOMBIE_FLEE_SPEED_MULTIPLIER;
      }

      const metersMoved = this.speed * (dt / 1000);
      const latDiff = (dy * metersMoved) / 111111;
      const lngDiff =
        (dx * metersMoved) / (111111 * Math.cos((this.lat * Math.PI) / 180));

      const nextLat = this.lat + latDiff;
      const nextLng = this.lng + lngDiff;
      const moved = slideMove(
        { lat: this.lat, lng: this.lng },
        nextLat,
        nextLng,
        isValid,
      );
      this.lat = moved.lat;
      this.lng = moved.lng;
      this.marker.setLatLng([this.lat, this.lng]);
    }

    const distToPlayer = haversineDistance(this.latlng, player.latlng);
    if (this.state === "CHASE" && distToPlayer < ZOMBIE_COLLISION_DISTANCE_M) {
      player.takeDamage();
    }
  }

  destroy(map: L.Map): void {
    map.removeLayer(this.marker);
  }
}

export interface GameFacilityCallbacks {
  onToast: (msg: string) => void;
  onGlobalSiren: () => void;
}

export class GameFacility {
  type: FacilityType;
  lat: number;
  lng: number;
  radius: number;
  bellState: BellState = "IDLE";
  countdown = 0;
  marker: L.Marker;
  circle: L.Circle | null;
  readonly id: string;

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
    this.marker = L.marker([this.lat, this.lng], {
      icon: createEmojiIcon(this.emojiForType(data.type), this.iconSize()),
    }).addTo(map);
    if (data.name || data.address) {
      const lines = [data.name, data.address].filter(Boolean).join("<br/>");
      this.marker.bindPopup(lines);
    }
    this.circle =
      this.type === "police" || this.type === "cctv" || this.type === "light"
        ? null
        : this.createCircle();
    if (this.type === "bell" && this.circle) {
      this.marker.on("click", () => this.interact(() => null));
      this.circle.on("click", () => this.interact(() => null));
    }
  }

  get latlng(): LatLng {
    return { lat: this.lat, lng: this.lng };
  }

  private resolveRadius(type: FacilityType): number {
    if (type === "light") return LIGHT_RADIUS_M;
    if (type === "police") return POLICE_RADIUS_M;
    return BELL_RADIUS_M;
  }

  private emojiForType(type: FacilityType): string {
    if (type === "light") return "💡";
    if (type === "police") return "🚓";
    if (type === "cctv") return "📹";
    return "🚨";
  }

  private iconSize(): number {
    if (this.type === "police") return 30;
    if (this.type === "cctv") return 22;
    if (this.type === "bell") return 25;
    return 20;
  }

  private createCircle(): L.Circle {
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
    if (this.type !== "bell") return;

    if (this.bellState === "COUNTDOWN") {
      this.countdown -= dt;
      const secs = Math.ceil(this.countdown / 1000);
      this.marker.setIcon(
        L.divIcon({
          className: "custom-div-icon",
          html: `<div class="emoji-marker font-bold text-red-500 bg-black/50 rounded-full px-2" style="font-size:16px;">${secs}s</div>`,
          iconAnchor: [15, 15],
        }),
      );
      if (this.countdown <= 0) {
        this.callbacks.onGlobalSiren();
        this.bellState = "COOLDOWN";
        this.countdown = BELL_COOLDOWN_MS;
        this.circle?.setStyle({ color: "gray", fillColor: "gray" });
      }
    } else if (this.bellState === "COOLDOWN") {
      this.countdown -= dt;
      this.marker.setIcon(createEmojiIcon("⏳", 20));
      if (this.countdown <= 0) {
        this.bellState = "IDLE";
        this.circle?.setStyle({ color: "red", fillColor: "#ef4444" });
        this.marker.setIcon(createEmojiIcon("🚨", 25));
      }
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
    this.callbacks.onToast("비상벨 작동! 10초 뒤 사이렌이 울립니다.");
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