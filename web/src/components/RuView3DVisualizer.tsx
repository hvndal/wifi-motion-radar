"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { SkeletonPose, SKELETON_BONES, KeypointName } from "@/utils/ruviewCore";
import { Box, Layers, Radio, Activity, Eye } from "lucide-react";

interface RuView3DProps {
  pose: SkeletonPose;
  wifiVariance: number;
  csiVariance: number;
  isMotionDetected: boolean;
}

export default function RuView3DVisualizer({
  pose,
  wifiVariance,
  csiVariance,
  isMotionDetected,
}: RuView3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Mesh refs for animation
  const jointMeshesRef = useRef<Map<KeypointName, THREE.Mesh>>(new Map());
  const boneLinesRef = useRef<THREE.LineSegments | null>(null);
  const pointCloudRef = useRef<THREE.Points | null>(null);
  const fresnelMeshRef = useRef<THREE.Mesh | null>(null);
  const rfWavesRef = useRef<THREE.Mesh[]>([]);

  // Orbit controls state
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const cameraAngleRef = useRef({ theta: 0.8, phi: 0.6, radius: 6.5 });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 700;
    const height = 440;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080f);
    scene.fog = new THREE.FogExp2(0x06080f, 0.08);
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    cameraRef.current = camera;
    updateCameraPosition();

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0x221133, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x06b6d4, 2.0);
    dirLight.position.set(4, 6, 4);
    scene.add(dirLight);

    const purpleLight = new THREE.PointLight(0xa855f7, 3.0, 10);
    purpleLight.position.set(-3, 3, -2);
    scene.add(purpleLight);

    // 5. Floor Grid
    const grid = new THREE.GridHelper(7, 14, 0xa855f7, 0x1e293b);
    grid.position.y = 0;
    scene.add(grid);

    // Room Bounding Walls (Holographic Wireframe)
    const roomGeo = new THREE.BoxGeometry(6, 3, 6);
    const roomEdges = new THREE.EdgesGeometry(roomGeo);
    const roomLine = new THREE.LineSegments(
      roomEdges,
      new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.4 })
    );
    roomLine.position.y = 1.5;
    scene.add(roomLine);

    // 6. Wi-Fi AP & ESP32 Node Markers
    // ESP32 Node (Cyan) at (2.2, 0.4, 2.2)
    const espGeo = new THREE.BoxGeometry(0.25, 0.1, 0.35);
    const espMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.8,
    });
    const espMesh = new THREE.Mesh(espGeo, espMat);
    espMesh.position.set(2.2, 0.2, 2.2);
    scene.add(espMesh);

    // Router AP (Purple) at (-2.2, 1.8, -2.2)
    const apGeo = new THREE.BoxGeometry(0.35, 0.15, 0.25);
    const apMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0xa855f7,
      emissiveIntensity: 0.8,
    });
    const apMesh = new THREE.Mesh(apGeo, apMat);
    apMesh.position.set(-2.2, 1.8, -2.2);
    scene.add(apMesh);

    // 7. 3D Fresnel Zone Ellipsoid between AP and ESP32
    const fresnelGeo = new THREE.SphereGeometry(1, 24, 16);
    fresnelGeo.scale(0.8, 0.8, 3.4);
    const fresnelMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });
    const fresnelMesh = new THREE.Mesh(fresnelGeo, fresnelMat);
    // Center between AP and ESP32
    fresnelMesh.position.set(0, 1.0, 0);
    fresnelMesh.lookAt(2.2, 0.2, 2.2);
    scene.add(fresnelMesh);
    fresnelMeshRef.current = fresnelMesh;

    // 8. Multipath Point Cloud Scatter (200 particles)
    const pCount = 200;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 5.5;
      pPos[i * 3 + 1] = Math.random() * 2.8;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 5.5;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x06b6d4,
      size: 0.05,
      transparent: true,
      opacity: 0.6,
    });
    const pCloud = new THREE.Points(pGeo, pMat);
    scene.add(pCloud);
    pointCloudRef.current = pCloud;

    // 9. 17-Keypoint WiFi-DensePose Skeleton
    const jointGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.0,
    });

    const jointMap = new Map<KeypointName, THREE.Mesh>();
    pose.keypoints.forEach((kp) => {
      const mesh = new THREE.Mesh(jointGeo, jointMat.clone());
      mesh.position.set(kp.x, kp.y, kp.z);
      scene.add(mesh);
      jointMap.set(kp.name, mesh);
    });
    jointMeshesRef.current = jointMap;

    // Bone Segments Lines
    const bonePositions = new Float32Array(SKELETON_BONES.length * 2 * 3);
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute("position", new THREE.BufferAttribute(bonePositions, 3));
    const boneMat = new THREE.LineBasicMaterial({
      color: 0xa855f7,
      linewidth: 2,
      transparent: true,
      opacity: 0.85,
    });
    const boneLines = new THREE.LineSegments(boneGeo, boneMat);
    scene.add(boneLines);
    boneLinesRef.current = boneLines;

    // Animation loop
    let animId: number;
    let clock = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      clock += 0.015;

      // Pulse Fresnel Ellipsoid
      if (fresnelMeshRef.current) {
        const s = 1.0 + Math.sin(clock * 2) * 0.03;
        fresnelMeshRef.current.scale.set(0.8 * s, 0.8 * s, 3.4);
      }

      // Scatter Point Cloud when motion is active
      if (pointCloudRef.current) {
        pointCloudRef.current.rotation.y += isMotionDetected ? 0.006 : 0.001;
      }

      renderer.render(scene, camera);
    };
    animate();

    // Mouse Drag Listeners for Orbiting Camera
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - prevMouseRef.current.x;
      const dy = e.clientY - prevMouseRef.current.y;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };

      cameraAngleRef.current.theta -= dx * 0.008;
      cameraAngleRef.current.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, cameraAngleRef.current.phi - dy * 0.008));
      updateCameraPosition();
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraAngleRef.current.radius = Math.max(2.5, Math.min(11.0, cameraAngleRef.current.radius + e.deltaY * 0.005));
      updateCameraPosition();
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(animId);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel);
      renderer.dispose();
    };
  }, []);

  const updateCameraPosition = () => {
    if (!cameraRef.current) return;
    const { theta, phi, radius } = cameraAngleRef.current;
    cameraRef.current.position.x = radius * Math.sin(phi) * Math.sin(theta);
    cameraRef.current.position.y = radius * Math.cos(phi);
    cameraRef.current.position.z = radius * Math.sin(phi) * Math.cos(theta);
    cameraRef.current.lookAt(0, 0.9, 0);
  };

  // Update 17-Keypoint joint positions & bones when pose changes
  useEffect(() => {
    const jointMap = jointMeshesRef.current;
    if (jointMap.size === 0) return;

    // Update Spheres
    const kpMap = new Map<KeypointName, { x: number; y: number; z: number }>();
    pose.keypoints.forEach((kp) => {
      kpMap.set(kp.name, { x: kp.x, y: kp.y, z: kp.z });
      const mesh = jointMap.get(kp.name);
      if (mesh) {
        // Smooth interpolation
        mesh.position.lerp(new THREE.Vector3(kp.x, kp.y, kp.z), 0.4);
      }
    });

    // Update Bone Lines
    const boneLines = boneLinesRef.current;
    if (boneLines) {
      const posAttr = boneLines.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      let ptr = 0;

      SKELETON_BONES.forEach(([fromName, toName]) => {
        const from = kpMap.get(fromName);
        const to = kpMap.get(toName);
        if (from && to) {
          arr[ptr++] = from.x;
          arr[ptr++] = from.y;
          arr[ptr++] = from.z;
          arr[ptr++] = to.x;
          arr[ptr++] = to.y;
          arr[ptr++] = to.z;
        }
      });
      posAttr.needsUpdate = true;
    }
  }, [pose]);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-800 bg-[#06080f] shadow-2xl">
      <div ref={mountRef} className="w-full h-[440px] block cursor-grab active:cursor-grabbing" />

      {/* Top HUD Overlay */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
          <Eye className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-200 font-bold">WIFI-DENSEPOSE 3D</span>
          <span className="text-purple-400 font-semibold">17 Keypoints</span>
        </div>

        <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
          <span className={`w-2 h-2 rounded-full ${pose.activity === "FALL_DETECTED" ? "bg-rose-500 animate-ping" : isMotionDetected ? "bg-cyan-400 animate-pulse" : "bg-emerald-400"}`} />
          <span className={pose.activity === "FALL_DETECTED" ? "text-rose-400 font-bold" : "text-slate-300"}>
            {pose.activity}
          </span>
        </div>
      </div>

      {/* Bottom HUD Controls & Legend */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3 bg-black/75 backdrop-blur-md p-2.5 rounded-xl border border-slate-800/80 text-[11px] font-mono pointer-events-none">
        <div className="flex items-center gap-4 text-slate-400">
          <span className="flex items-center gap-1.5 text-cyan-300">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            ESP32 Sensor (COM3)
          </span>
          <span className="flex items-center gap-1.5 text-purple-300">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
            Wi-Fi Router AP
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-0.5 bg-cyan-400/60" />
            1st Fresnel Ellipsoid
          </span>
        </div>

        <div className="text-slate-400 flex items-center gap-2">
          <span>Drag to Orbit &bull; Scroll to Zoom</span>
        </div>
      </div>
    </div>
  );
}
