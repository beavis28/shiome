// three.js で描く 3D 散布図。ドラッグで回転、ホイールで拡大、点にマウスを乗せると値を表示
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ChartPoint, ChartSpec } from '../../types';
import { fmtNum, PALETTE } from './palette';

const label = (text: string, cls: string) => {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return new CSS2DObject(el);
};

export default function Scatter3D({ spec }: { spec: ChartSpec }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ChartPoint | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const pts = (spec.points ?? []).filter((p) => p.z !== undefined);
    const W = () => el.clientWidth;
    const H = () => el.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 100);
    camera.position.set(3.2, 2.4, 3.6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.setSize(W(), H());
    labels.domElement.style.position = 'absolute';
    labels.domElement.style.inset = '0';
    labels.domElement.style.pointerEvents = 'none';
    el.appendChild(labels.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.minDistance = 2.5;
    controls.maxDistance = 9;
    controls.addEventListener('start', () => (controls.autoRotate = false));

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(3, 5, 4);
    scene.add(sun);

    // 各軸を -1〜1 に正規化
    const range = (k: 'x' | 'y' | 'z') => {
      const vs = pts.map((p) => p[k] as number);
      const lo = Math.min(...vs);
      const hi = Math.max(...vs);
      return { lo, hi, n: (v: number) => (hi === lo ? 0 : ((v - lo) / (hi - lo)) * 2 - 1) };
    };
    const rx = range('x');
    const ry = range('y');
    const rz = range('z');

    // 外枠と床のグリッド
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), new THREE.LineBasicMaterial({ color: 0x3a4560 }));
    scene.add(frame);
    const grid = new THREE.GridHelper(2, 4, 0x2b3550, 0x2b3550);
    grid.position.y = -1;
    scene.add(grid);

    // 軸のタイトルと最小・最大
    const axis = (text: string | undefined, pos: [number, number, number]) => {
      const o = label(text ?? '', 'rounded bg-black/40 px-1 text-[11px] font-semibold text-sky-300');
      o.position.set(...pos);
      scene.add(o);
    };
    axis(spec.xTitle ?? 'x', [0, -1.18, 1.15]);
    axis(spec.yTitle ?? 'y', [-1.2, 0, 1.15]);
    axis(spec.zTitle ?? 'z', [1.2, -1.18, 0]);
    const tick = (text: string, pos: [number, number, number]) => {
      const o = label(text, 'text-[9px] text-slate-400');
      o.position.set(...pos);
      scene.add(o);
    };
    tick(fmtNum(rx.lo), [-1, -1.08, 1.08]);
    tick(fmtNum(rx.hi), [1, -1.08, 1.08]);
    tick(fmtNum(ry.lo), [-1.1, -1, 1.08]);
    tick(fmtNum(ry.hi), [-1.1, 1, 1.08]);
    tick(fmtNum(rz.lo), [1.1, -1.08, -1]);
    tick(fmtNum(rz.hi), [1.1, -1.08, 1]);

    // 点（グループごとに色。r があれば大きさに反映）
    const groups = [...new Set(pts.map((p) => p.group ?? ''))];
    const maxR = Math.max(1, ...pts.map((p) => Math.abs(p.r ?? 0)));
    const meshes: THREE.Mesh[] = [];
    for (const p of pts) {
      const size = p.r !== undefined ? 0.05 + Math.sqrt(Math.abs(p.r) / maxR) * 0.11 : 0.07;
      // グループがなく 8 銘柄以内なら、銘柄ごとに色を分ける（ラベルも付く）
      const ci = groups.length === 1 && pts.length <= PALETTE.length ? pts.indexOf(p) : groups.indexOf(p.group ?? '');
      const color = PALETTE[ci % PALETTE.length];
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(size, 24, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05, emissive: color, emissiveIntensity: 0.25 }),
      );
      m.position.set(rx.n(p.x), ry.n(p.y), rz.n(p.z!));
      m.userData = p;
      scene.add(m);
      meshes.push(m);
      // 床への影の線（位置を読みやすくする）
      const drop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([m.position.clone(), new THREE.Vector3(m.position.x, -1, m.position.z)]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 }),
      );
      scene.add(drop);
      if (pts.length <= 30) {
        const t = label(p.label, 'text-[10px] font-semibold text-slate-100 [text-shadow:0_1px_2px_#000]');
        t.position.set(m.position.x + size + 0.04, m.position.y + size, m.position.z);
        scene.add(t);
      }
    }

    // ホバー
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(meshes)[0];
      setHover(hit ? (hit.object.userData as ChartPoint) : null);
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', () => setHover(null));

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const ro = new ResizeObserver(() => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
      labels.setSize(W(), H());
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      el.innerHTML = '';
    };
  }, [spec]);

  const groups = [...new Set((spec.points ?? []).map((p) => p.group ?? ''))].filter(Boolean);
  return (
    <div>
      {groups.length > 1 && (
        <div className="mb-1 flex flex-wrap gap-x-3 text-[10px] text-mute">
          {groups.map((g, i) => (
            <span key={g} className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              {g}
            </span>
          ))}
        </div>
      )}
      <div ref={box} className="relative h-[300px] w-full overflow-hidden rounded-md bg-[radial-gradient(ellipse_at_center,#16203a,#0b0f17)]" />
      <div className="mt-1 flex items-center justify-between text-[10px] text-mute">
        <span>ドラッグで回転 · ホイールで拡大</span>
        {hover && (
          <span className="num text-ink">
            {hover.label}: {spec.xTitle ?? 'x'} {fmtNum(hover.x)} / {spec.yTitle ?? 'y'} {fmtNum(hover.y)} / {spec.zTitle ?? 'z'} {fmtNum(hover.z)}
            {hover.r !== undefined && ` / 大きさ ${fmtNum(hover.r)}`}
          </span>
        )}
      </div>
    </div>
  );
}
