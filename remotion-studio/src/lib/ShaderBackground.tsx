import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useRef } from 'react';
import * as THREE from 'three';

/* Evolving shader background — frontendmaxxing's `gradient-mesh` (Stripe-style
   4-colour weighted-distance mesh), ported to @remotion/three, made DARK and
   EVOLVING: the palette lerps through a sequence of deep "moods" across the whole
   timeline so the background changes + alternates as the video plays, while the
   flowing drift never stops. Deterministic: uTime = frame/fps, palette = f(frame).
   Replaces the cheap CSS aurora. */

// dark but SATURATED moods (visible colour, not "just blue"). each = 4 corner colours.
const MOODS: number[][][] = [
  [[0.05, 0.10, 0.26], [0.04, 0.19, 0.31], [0.14, 0.07, 0.29], [0.02, 0.06, 0.15]], // blue → cyan
  [[0.17, 0.06, 0.29], [0.23, 0.08, 0.24], [0.08, 0.05, 0.27], [0.04, 0.03, 0.14]], // violet → magenta
  [[0.03, 0.18, 0.21], [0.04, 0.23, 0.22], [0.07, 0.13, 0.23], [0.02, 0.08, 0.13]], // teal → green
  [[0.14, 0.06, 0.23], [0.06, 0.13, 0.31], [0.19, 0.10, 0.27], [0.03, 0.06, 0.15]], // plum → blue
];

const VERT = 'void main(){ gl_Position = vec4(position, 1.0); }';
const FRAG = `
precision highp float;
uniform float u_time; uniform vec2 u_resolution;
uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_c3; uniform vec3 u_c4;
uniform float u_speed; uniform float u_grain;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int k=0;k<4;k++){ v+=a*vnoise(p); p=p*2.02+5.1; a*=0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * u_speed;
  // organic domain warp — colour regions FLOW like liquid, not 4 rigid blobs
  vec2 w = uv + (vec2(fbm(uv*2.6 + vec2(t, 0.0)), fbm(uv*2.6 + vec2(0.0, t + 9.0))) - 0.5) * 0.38;
  vec2 p1 = vec2(0.20 + sin(t*1.0)*0.16,       0.18 + cos(t*0.9)*0.13);
  vec2 p2 = vec2(0.82 + cos(t*0.7)*0.13,       0.22 + sin(t*0.8)*0.14);
  vec2 p3 = vec2(0.78 + sin(t*0.6+1.7)*0.13,   0.80 + cos(t*0.7+0.7)*0.13);
  vec2 p4 = vec2(0.22 + cos(t*0.5+2.3)*0.13,   0.78 + sin(t*0.6+1.1)*0.13);
  float w1 = 1.0/(0.0001 + dot(w-p1,w-p1)*7.0);
  float w2 = 1.0/(0.0001 + dot(w-p2,w-p2)*7.0);
  float w3 = 1.0/(0.0001 + dot(w-p3,w-p3)*7.0);
  float w4 = 1.0/(0.0001 + dot(w-p4,w-p4)*7.0);
  float ws = w1+w2+w3+w4;
  vec3 col = (u_c1*w1 + u_c2*w2 + u_c3*w3 + u_c4*w4)/ws;
  // a slow light band sweeping across for depth + movement
  float band = sin((w.x*1.2 + w.y*0.8) * 3.14159 - t*1.6) * 0.5 + 0.5;
  col += pow(band, 3.0) * 0.055;
  float vig = smoothstep(1.25, 0.30, length(uv-0.5));   // darken edges so content reads
  col *= 0.58 + 0.42*vig;
  col += (hash(gl_FragCoord.xy + u_time) - 0.5) * u_grain; // film grain
  gl_FragColor = vec4(col, 1.0);
}`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (A: number[], B: number[], t: number) => [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];

const Plane = ({ frame, fps, total, width, height }: { frame: number; fps: number; total: number; width: number; height: number }) => {
  // evolving palette — cycle (and loop) through the moods across the timeline
  const progress = total ? (frame / total) : 0;
  const seg = progress * MOODS.length;
  const i = ((Math.floor(seg) % MOODS.length) + MOODS.length) % MOODS.length;
  const j = (i + 1) % MOODS.length;
  const tt = seg - Math.floor(seg);
  const c = [0, 1, 2, 3].map((k) => mix3(MOODS[i][k], MOODS[j][k], tt));

  const u = useRef({
    u_time: { value: 0 }, u_resolution: { value: new THREE.Vector2(width, height) },
    u_c1: { value: new THREE.Vector3() }, u_c2: { value: new THREE.Vector3() },
    u_c3: { value: new THREE.Vector3() }, u_c4: { value: new THREE.Vector3() },
    u_speed: { value: 0.16 }, u_grain: { value: 0.022 },
  }).current;
  u.u_time.value = frame / fps;
  u.u_resolution.value.set(width, height);
  u.u_c1.value.set(c[0][0], c[0][1], c[0][2]); u.u_c2.value.set(c[1][0], c[1][1], c[1][2]);
  u.u_c3.value.set(c[2][0], c[2][1], c[2][2]); u.u_c4.value.set(c[3][0], c[3][1], c[3][2]);

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial fragmentShader={FRAG} vertexShader={VERT} uniforms={u} />
    </mesh>
  );
};

export const ShaderBackground = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill>
      <ThreeCanvas width={width} height={height} gl={{ antialias: false, preserveDrawingBuffer: true }}>
        <Plane frame={frame} fps={fps} total={durationInFrames} width={width} height={height} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
