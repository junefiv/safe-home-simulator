"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JoystickVector } from "@/lib/game/types";

interface JoystickProps {
  onChange: (vector: JoystickVector) => void;
  visible: boolean;
}

export function Joystick({ onChange, visible }: JoystickProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const updateFromEvent = useCallback((clientX: number, clientY: number) => {
    const zone = zoneRef.current;
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const maxDist = rect.width / 2;
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }
    setKnobOffset({ x: dx, y: dy });
    onChangeRef.current({ x: dx / maxDist, y: dy / maxDist });
  }, []);

  const end = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setKnobOffset({ x: 0, y: 0 });
    onChangeRef.current({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      if ("touches" in e) {
        const t = e.touches[0];
        updateFromEvent(t.clientX, t.clientY);
      } else {
        updateFromEvent(e.clientX, e.clientY);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
    };
  }, [end, updateFromEvent]);

  if (!visible) return null;

  return (
    <div
      id="joystick-zone"
      ref={zoneRef}
      style={{ display: "block" }}
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        updateFromEvent(e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        dragging.current = true;
        const t = e.touches[0];
        updateFromEvent(t.clientX, t.clientY);
      }}
    >
      <div
        id="joystick-knob"
        style={{
          transform: `translate(calc(-50% + ${knobOffset.x}px), calc(-50% + ${knobOffset.y}px))`,
        }}
      />
    </div>
  );
}