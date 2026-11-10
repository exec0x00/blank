import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { color } from "../theme";

const CANDLES = [-128, -64, 0, 64, 128];

/** Two-tier cake; the candles light one after another from `lightAt`. */
export const Cake: React.FC<{ size?: number; lightAt?: number }> = ({ size = 640, lightAt = 12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <svg viewBox="-320 -360 640 700" width={size} height={(size * 700) / 640} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="tierA" x1="0" x2="1">
          <stop offset="0" stopColor="#ff9fb6" />
          <stop offset="0.55" stopColor="#ffc4d2" />
          <stop offset="1" stopColor="#e9799a" />
        </linearGradient>
        <linearGradient id="tierB" x1="0" x2="1">
          <stop offset="0" stopColor="#fff1dc" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f3d9b8" />
        </linearGradient>
        <radialGradient id="flame" cx="50%" cy="70%" r="65%">
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset="0.45" stopColor="#ffd35c" />
          <stop offset="1" stopColor="#ff7a2f" />
        </radialGradient>
        <radialGradient id="glow">
          <stop offset="0" stopColor="rgba(255,214,120,0.75)" />
          <stop offset="1" stopColor="rgba(255,214,120,0)" />
        </radialGradient>
      </defs>

      {/* stand */}
      <ellipse cx="0" cy="300" rx="300" ry="26" fill="rgba(0,0,0,0.35)" />
      <path d="M-70 250 L70 250 L44 300 L-44 300 Z" fill={color.goldDeep} />
      <ellipse cx="0" cy="246" rx="290" ry="26" fill={color.gold} />
      <ellipse cx="0" cy="240" rx="290" ry="24" fill={color.goldPale} />

      {/* bottom tier */}
      <path d="M-240 70 Q-240 50 -220 50 L220 50 Q240 50 240 70 L240 240 L-240 240 Z" fill="url(#tierA)" />
      <path
        d="M-240 70 Q-240 50 -220 50 L220 50 Q240 50 240 70 L240 110 Q215 150 190 110 Q165 80 140 118 Q115 170 90 118 Q65 84 40 116 Q15 160 -10 116 Q-35 84 -60 118 Q-85 176 -110 118 Q-135 84 -160 112 Q-185 150 -210 112 Q-225 92 -240 110 Z"
        fill="url(#tierB)"
      />
      {[-190, -110, -30, 50, 130, 205].map((x, i) => (
        <circle key={i} cx={x} cy={196 + (i % 2) * 14} r="10" fill={i % 2 ? color.gold : "#ffffff"} />
      ))}

      {/* top tier */}
      <path d="M-170 -90 Q-170 -110 -150 -110 L150 -110 Q170 -110 170 -90 L170 52 L-170 52 Z" fill="url(#tierB)" />
      <path
        d="M-170 -90 Q-170 -110 -150 -110 L150 -110 Q170 -110 170 -90 L170 -56 Q148 -22 126 -58 Q104 -84 82 -52 Q60 -8 38 -54 Q16 -84 -6 -54 Q-28 -16 -50 -54 Q-72 -84 -94 -52 Q-116 -14 -138 -54 Q-154 -74 -170 -56 Z"
        fill="#ff86a6"
      />
      {[-120, -40, 40, 120].map((x, i) => (
        <path
          key={i}
          transform={`translate(${x} 16) scale(0.62)`}
          d="M0 14 C-12 5 -16 -1 -16 -6.5 C-16 -11.5 -12.2 -15 -7.7 -15 C-4.6 -15 -1.7 -13.3 0 -10.4 C1.7 -13.3 4.6 -15 7.7 -15 C12.2 -15 16 -11.5 16 -6.5 C16 -1 12 5 0 14Z"
          fill={color.rose}
        />
      ))}

      {/* candles */}
      {CANDLES.map((x, i) => {
        const lit = spring({ frame: frame - lightAt - i * 7, fps, config: { damping: 8, mass: 0.5 } });
        const flick = 1 + Math.sin(frame * 0.9 + i * 2.1) * 0.08 + Math.sin(frame * 0.37 + i) * 0.06;
        const lean = Math.sin(frame * 0.5 + i * 1.7) * 5;
        return (
          <g key={i} transform={`translate(${x} -110)`}>
            <rect x="-9" y="-92" width="18" height="92" rx="5" fill={i % 2 ? color.gold : "#ffffff"} />
            {[0, 1, 2].map((k) => (
              <path
                key={k}
                d={`M-9 ${-78 + k * 28} L9 ${-90 + k * 28} L9 ${-78 + k * 28} L-9 ${-66 + k * 28} Z`}
                fill={i % 2 ? "#ffffff" : color.rose}
                opacity="0.85"
              />
            ))}
            <line x1="0" y1="-92" x2="0" y2="-104" stroke="#5a3a2a" strokeWidth="3" />
            <g transform={`translate(0 -104) scale(${lit})`}>
              <circle r="78" fill="url(#glow)" opacity={0.75 * flick} />
              <path
                transform={`rotate(${lean}) scale(${flick})`}
                d="M0 -52 C16 -30 20 -16 20 -6 C20 6 11 14 0 14 C-11 14 -20 6 -20 -6 C-20 -16 -16 -30 0 -52Z"
                fill="url(#flame)"
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
};
