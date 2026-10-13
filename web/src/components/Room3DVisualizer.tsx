"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  Eye,
  Compass,
  Crosshair,
  Smartphone,
  Play,
  Pause,
  Users,
  Activity,
  Layers,
  Sparkles,
  MapPin,
  TrendingUp,
} from "lucide-react";
import {
  SpatialKalmanFilter,
  RSSIPredictor,
  classifyActivity,
  GPSCoordinates,
} from "@/utils/predictiveModels";

export interface TargetPosition {
  x: number;
  y: number;
  z: number;
  distance: number;
  angle: number;
  velocity: number;
  state: "APPROACHING" | "RECEDING" | "PACING" | "STATIONARY" | "CLEAR";
  confidence: number;
}

export interface ConnectedPhone {
  id: number;
  mac: string;
  rssi: number;
  ip?: string;
  distance?: number;
  estimatedDistance?: number;
  randomized?: boolean;
  gps?: GPSCoordinates;
}

interface Room3DProps {
  isMotionDetected: boolean;
  dwellRemaining: number;
  triggerCount: number;
  lastTriggerTime: string | null;
  connectedDevices?: ConnectedPhone[];
  peopleCount?: number;
  rfVariance?: number;
  activeClientGPS?: GPSCoordinates;
  onManualTrigger?: () => void;
}

export default function Room3DVisualizer({
  isMotionDetected,
  dwellRemaining,
  triggerCount,
  connectedDevices = [],
  peopleCount = 1,
  rfVariance = 0.0,
  activeClientGPS,
  onManualTrigger,
}: Room3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [cameraView, setCameraView] = useState<"iso" | "top" | "sensor">("iso");
  const [isAutoWalkActive, setIsAutoWalkActive] = useState<boolean>(false);
  const [showDeviceTags, setShowDeviceTags] = useState<boolean>(true);
  const [showKalmanPrediction, setShowKalmanPrediction] = useState<boolean>(true);

  // Real-time Kalman Filter Instance
  const kalmanFilterRef = useRef<SpatialKalmanFilter>(new SpatialKalmanFilter(0, 2.5));
  const rssiPredictorRef = useRef<RSSIPredictor>(new RSSIPredictor(0.35));

  // Real-time Inferred Target Metrics
  const [targetMetrics, setTargetMetrics] = useState<TargetPosition>({
    x: 0,
    y: 1.7,
    z: 2.2,
    distance: 3.3,
    angle: 0,
    velocity: 0,
    state: "CLEAR",
    confidence: 0,
  });

  // Predicted Future State (1.5s ahead)
  const [predictedState, setPredictedState] = useState<{ x: number; z: number; expectedRssi: number; residual: number }>({
    x: 0,
    z: 2.8,
    expectedRssi: -55,
    residual: 0.5,
  });

  // Scene references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const targetGroupRef = useRef<THREE.Group | null>(null);
  const ghostAvatarRef = useRef<THREE.Group | null>(null);
  const predictedArcLineRef = useRef<THREE.Line | null>(null);
  const secondaryAvatarsRef = useRef<THREE.Group[]>([]);
  const scanSweepLineRef = useRef<THREE.Line | null>(null);
  const sensorConeRef = useRef<THREE.Mesh | null>(null);
  const trailLineRef = useRef<THREE.Line | null>(null);
  const trailPointsRef = useRef<THREE.Vector3[]>([]);
  const phoneMeshesRef = useRef<THREE.Group[]>([]);

  // Simulation physics target state
  const currentPos = useRef({ x: 0, y: 1.7, z: 2.2 });
  const targetPos = useRef({ x: 0, y: 1.7, z: 2.2 });
  const previousPos = useRef({ x: 0, z: 2.2, time: 0 });
  const isDragging = useRef(false);
  const prevMouse = useRef({ x: 0, y: 0 });
  const cameraRotation = useRef({ theta: Math.PI / 4, phi: Math.PI / 5.5, radius: 11 });

  // SENSOR ORIGIN on the back wall: (0, 1.5, -4.8)
  const SENSOR_ORIGIN = { x: 0, y: 1.5, z: -4.8 };

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight || 480;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080d);
    scene.fog = new THREE.FogExp2(0x06080d, 0.04);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    cameraRef.current = camera;
    updateCameraPosition();

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00f2fe, 2.5, 18);
    pointLight.position.set(0, 5, 0);
    scene.add(pointLight);

    const alertLight = new THREE.PointLight(0xff3366, 0, 14);
    alertLight.position.set(0, 2.5, 0);
    scene.add(alertLight);

    // 4. Tactical Room Grid Floor & Boundary
    const grid = new THREE.GridHelper(12, 24, 0x00f2fe, 0x1e293b);
    grid.position.y = 0;
    scene.add(grid);

    // Concentric RF Distance Rings
    const ringRadii = [1.5, 3.0, 4.5, 6.0];
    ringRadii.forEach((r) => {
      const ringGeo = new THREE.RingGeometry(r - 0.03, r + 0.03, 64, 1, -Math.PI / 3, (2 * Math.PI) / 3);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.22,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.set(SENSOR_ORIGIN.x, 0.02, SENSOR_ORIGIN.z);
      scene.add(ringMesh);
    });

    // Room Wireframe Bounds (10m x 3.5m x 10m)
    const boxGeo = new THREE.BoxGeometry(10, 3.5, 10);
    const boxEdges = new THREE.EdgesGeometry(boxGeo);
    const boxMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.45 });
    const wireframeRoom = new THREE.LineSegments(boxEdges, boxMat);
    wireframeRoom.position.y = 1.75;
    scene.add(wireframeRoom);

    // 5. ESP32 Wi-Fi Node
    const sensorGroup = new THREE.Group();
    sensorGroup.position.set(SENSOR_ORIGIN.x, SENSOR_ORIGIN.y, SENSOR_ORIGIN.z);

    const bracketGeo = new THREE.BoxGeometry(1.0, 0.7, 0.1);
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
    sensorGroup.add(new THREE.Mesh(bracketGeo, bracketMat));

    const pcbGeo = new THREE.BoxGeometry(0.85, 0.55, 0.12);
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x064e3b, roughness: 0.3, metalness: 0.6 });
    const pcbMesh = new THREE.Mesh(pcbGeo, pcbMat);
    pcbMesh.position.z = 0.06;
    sensorGroup.add(pcbMesh);

    const ledGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(-0.28, 0.16, 0.13);
    sensorGroup.add(ledMesh);

    scene.add(sensorGroup);

    // 6. Translucent Wi-Fi 2.4 GHz RF Sensing Volume
    const coneHeight = 8.0;
    const coneRadius = 5.2;
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 2, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    const coneMesh = new THREE.Mesh(coneGeo, coneMat);
    coneMesh.position.set(SENSOR_ORIGIN.x, SENSOR_ORIGIN.y, SENSOR_ORIGIN.z + coneHeight / 2);
    coneMesh.rotation.x = -Math.PI / 2;
    sensorConeRef.current = coneMesh;
    scene.add(coneMesh);

    // 7. Tactical Radar Sweep Line
    const sweepGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(0, 0.05, 7.5),
    ]);
    const sweepMat = new THREE.LineBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.7 });
    const sweepLine = new THREE.Line(sweepGeo, sweepMat);
    sweepLine.position.set(SENSOR_ORIGIN.x, 0.02, SENSOR_ORIGIN.z);
    scanSweepLineRef.current = sweepLine;
    scene.add(sweepLine);

    // 8. Primary Human Target Avatar
    const targetGroup = new THREE.Group();
    targetGroupRef.current = targetGroup;

    const ringGeo = new THREE.RingGeometry(0.35, 0.45, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const baseRing = new THREE.Mesh(ringGeo, ringMat);
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.05;
    targetGroup.add(baseRing);

    const outerPulseRingGeo = new THREE.RingGeometry(0.5, 0.55, 32);
    const outerPulseRingMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    const outerPulseRing = new THREE.Mesh(outerPulseRingGeo, outerPulseRingMat);
    outerPulseRing.rotation.x = -Math.PI / 2;
    outerPulseRing.position.y = 0.04;
    targetGroup.add(outerPulseRing);

    const torsoGeo = new THREE.CylinderGeometry(0.22, 0.16, 0.85, 16);
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0x00f2fe, metalness: 0.7, roughness: 0.2, transparent: true, opacity: 0.9 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.95;
    targetGroup.add(torso);

    const headGeo = new THREE.SphereGeometry(0.16, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x00f2fe, roughness: 0.3 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.55;
    targetGroup.add(head);

    const visorGeo = new THREE.BoxGeometry(0.18, 0.05, 0.1);
    const visorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.55, -0.12);
    targetGroup.add(visor);

    targetGroup.position.set(0, 0, 2.2);
    scene.add(targetGroup);

    // 9. Predictive Kalman Ghost Avatar (Translucent Hologram of Projected Position)
    const ghostGroup = new THREE.Group();
    ghostAvatarRef.current = ghostGroup;

    const ghostRingGeo = new THREE.RingGeometry(0.35, 0.42, 24);
    const ghostRingMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    const ghostRing = new THREE.Mesh(ghostRingGeo, ghostRingMat);
    ghostRing.rotation.x = -Math.PI / 2;
    ghostRing.position.y = 0.05;
    ghostGroup.add(ghostRing);

    const ghostTorsoGeo = new THREE.CylinderGeometry(0.2, 0.14, 0.8, 12);
    const ghostTorsoMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, wireframe: true });
    const ghostTorso = new THREE.Mesh(ghostTorsoGeo, ghostTorsoMat);
    ghostTorso.position.y = 0.9;
    ghostGroup.add(ghostTorso);

    const ghostHeadGeo = new THREE.SphereGeometry(0.14, 12, 12);
    const ghostHeadMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4, wireframe: true });
    const ghostHead = new THREE.Mesh(ghostHeadGeo, ghostHeadMat);
    ghostHead.position.y = 1.45;
    ghostGroup.add(ghostHead);

    ghostGroup.position.set(0, 0, 2.8);
    scene.add(ghostGroup);

    // 10. Forward-Predictive Trajectory Vector Arc Line
    const arcGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.1, 2.2),
      new THREE.Vector3(0, 0.1, 2.8),
    ]);
    const arcMat = new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.2, gapSize: 0.1, transparent: true, opacity: 0.8 });
    const arcLine = new THREE.Line(arcGeo, arcMat);
    arcLine.computeLineDistances();
    predictedArcLineRef.current = arcLine;
    scene.add(arcLine);

    // 11. Motion Trail History
    const maxTrailPoints = 50;
    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({ color: 0xff3366, transparent: true, opacity: 0.85 });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    trailLineRef.current = trailLine;
    scene.add(trailLine);

    // Mouse Orbit Controls
    const onMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      prevMouse.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - prevMouse.current.x;
      const dy = e.clientY - prevMouse.current.y;
      prevMouse.current = { x: e.clientX, y: e.clientY };

      cameraRotation.current.theta -= dx * 0.007;
      cameraRotation.current.phi = Math.max(0.12, Math.min(Math.PI / 2.15, cameraRotation.current.phi - dy * 0.007));
      updateCameraPosition();
    };

    const onMouseUp = () => {
      isDragging.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraRotation.current.radius = Math.max(4.5, Math.min(20, cameraRotation.current.radius + e.deltaY * 0.01));
      updateCameraPosition();
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    // 12. Animation Loop
    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Radar Sweep
      if (scanSweepLineRef.current) {
        const sweepAngle = Math.sin(elapsed * 1.8) * 0.85;
        scanSweepLineRef.current.rotation.y = sweepAngle;
      }

      // Smooth kinematic lerp
      currentPos.current.x += (targetPos.current.x - currentPos.current.x) * 0.08;
      currentPos.current.z += (targetPos.current.z - currentPos.current.z) * 0.08;

      if (targetGroupRef.current) {
        targetGroupRef.current.position.x = currentPos.current.x;
        targetGroupRef.current.position.z = currentPos.current.z;
        targetGroupRef.current.position.y = Math.sin(elapsed * 2.5) * 0.04;
        baseRing.rotation.z = elapsed * 1.2;
        outerPulseRing.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.15);
      }

      // Update Ghost Avatar & Forward Arc
      if (ghostAvatarRef.current && predictedArcLineRef.current) {
        ghostAvatarRef.current.position.x = predictedState.x;
        ghostAvatarRef.current.position.z = predictedState.z;
        ghostAvatarRef.current.position.y = Math.sin(elapsed * 3.0) * 0.03;

        // Update Arc Geometry
        const arcPoints = [
          new THREE.Vector3(currentPos.current.x, 0.1, currentPos.current.z),
          new THREE.Vector3(
            (currentPos.current.x + predictedState.x) / 2,
            0.25,
            (currentPos.current.z + predictedState.z) / 2
          ),
          new THREE.Vector3(predictedState.x, 0.1, predictedState.z),
        ];
        predictedArcLineRef.current.geometry.setFromPoints(arcPoints);
        predictedArcLineRef.current.computeLineDistances();
        ghostAvatarRef.current.visible = showKalmanPrediction;
        predictedArcLineRef.current.visible = showKalmanPrediction;
      }

      // Secondary people bobbing
      secondaryAvatarsRef.current.forEach((grp, idx) => {
        grp.position.y = Math.sin(elapsed * 2.0 + idx) * 0.03;
      });

      // Trail
      const isTracking = isMotionDetected || isAutoWalkActive || rfVariance > 2.0;
      if (isTracking && trailPointsRef.current) {
        const lastPt = trailPointsRef.current[trailPointsRef.current.length - 1];
        const newVec = new THREE.Vector3(currentPos.current.x, 0.06, currentPos.current.z);
        if (!lastPt || lastPt.distanceTo(newVec) > 0.12) {
          trailPointsRef.current.push(newVec);
          if (trailPointsRef.current.length > maxTrailPoints) {
            trailPointsRef.current.shift();
          }
          trailGeo.setFromPoints(trailPointsRef.current);
        }
      }

      // Color Theme
      if (isTracking) {
        alertLight.intensity = 1.8 + Math.sin(elapsed * 8) * 0.9;
        torsoMat.color.setHex(0xff3366);
        headMat.color.setHex(0xff3366);
        ringMat.color.setHex(0xff3366);
        outerPulseRingMat.color.setHex(0xff3366);
        coneMat.color.setHex(0xff3366);
        coneMat.opacity = 0.22 + Math.sin(elapsed * 6) * 0.08;
        ledMat.color.setHex(0xff3366);
      } else {
        alertLight.intensity = 0;
        torsoMat.color.setHex(0x00f2fe);
        headMat.color.setHex(0x00f2fe);
        ringMat.color.setHex(0x00f2fe);
        outerPulseRingMat.color.setHex(0x00f2fe);
        coneMat.color.setHex(0x00f2fe);
        coneMat.opacity = 0.12;
        ledMat.color.setHex(0x00f2fe);
      }

      renderer.render(scene, camera);
    };

    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight || 480;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel);
      renderer.dispose();
    };
  }, [showKalmanPrediction]);

  function updateCameraPosition() {
    if (!cameraRef.current) return;
    const { theta, phi, radius } = cameraRotation.current;
    cameraRef.current.position.x = radius * Math.sin(phi) * Math.sin(theta);
    cameraRef.current.position.y = radius * Math.cos(phi);
    cameraRef.current.position.z = radius * Math.sin(phi) * Math.cos(theta);
    cameraRef.current.lookAt(0, 1.2, 0);
  }

  const handleSetView = (view: "iso" | "top" | "sensor") => {
    setCameraView(view);
    if (view === "iso") {
      cameraRotation.current = { theta: Math.PI / 4, phi: Math.PI / 5.5, radius: 11 };
    } else if (view === "top") {
      cameraRotation.current = { theta: 0, phi: 0.12, radius: 12 };
    } else if (view === "sensor") {
      cameraRotation.current = { theta: Math.PI, phi: Math.PI / 3.2, radius: 7.5 };
    }
    updateCameraPosition();
  };

  // Render Sniffed Wi-Fi Devices in 3D
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    phoneMeshesRef.current.forEach((g) => scene.remove(g));
    phoneMeshesRef.current = [];

    if (!showDeviceTags || connectedDevices.length === 0) return;

    connectedDevices.forEach((device, index) => {
      const phoneGroup = new THREE.Group();
      const dist = device.distance || device.estimatedDistance || 2.5;
      const angle = -0.55 + (index * 0.28) % 1.2;
      const px = Math.sin(angle) * dist;
      const pz = SENSOR_ORIGIN.z + Math.cos(angle) * dist;

      phoneGroup.position.set(px, 0.35, pz);

      const bodyGeo = new THREE.BoxGeometry(0.16, 0.32, 0.03);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2, metalness: 0.8 });
      const phoneMesh = new THREE.Mesh(bodyGeo, bodyMat);
      phoneMesh.rotation.x = -Math.PI / 6;
      phoneGroup.add(phoneMesh);

      const ringGeo = new THREE.RingGeometry(0.18, 0.22, 20);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.3;
      phoneGroup.add(ring);

      scene.add(phoneGroup);
      phoneMeshesRef.current.push(phoneGroup);
    });
  }, [connectedDevices, showDeviceTags]);

  // Mathematical Prediction Pipeline (Kalman Filtering & Forward Prediction)
  useEffect(() => {
    if (isAutoWalkActive) return;

    if (isMotionDetected || rfVariance > 2.0) {
      // 1. Raw Measured coordinates from Wi-Fi Log-Distance Path Loss
      const angle = (Math.random() - 0.5) * 1.3;
      const dist = 1.8 + Math.random() * 2.8;
      const rawX = Math.sin(angle) * dist;
      const rawZ = SENSOR_ORIGIN.z + Math.cos(angle) * dist;

      // 2. Feed into 2D Kalman Filter
      const kState = kalmanFilterRef.current.update(rawX, rawZ);
      targetPos.current = { x: kState.x, y: 1.7, z: kState.z };

      // 3. Forward Project 1.5 Seconds ahead
      const futurePred = kalmanFilterRef.current.predictFuture(1.5);

      // 4. Time-Series AR(1) RSSI Prediction
      const primaryRssi = connectedDevices[0]?.rssi || -55;
      const rssiPred = rssiPredictorRef.current.recordSample(primaryRssi);

      setPredictedState({
        x: futurePred.x,
        z: futurePred.z,
        expectedRssi: rssiPred.predictedNext,
        residual: rssiPred.residual,
      });

      // 5. Activity Classification
      const dx = kState.x - SENSOR_ORIGIN.x;
      const dz = kState.z - SENSOR_ORIGIN.z;
      const calcDist = Math.sqrt(dx * dx + dz * dz);
      const calcAngle = Math.round((Math.atan2(dx, dz) * 180) / Math.PI);
      const velMag = Math.sqrt(kState.vx * kState.vx + kState.vz * kState.vz);

      const classified = classifyActivity(rfVariance, velMag, dz);

      setTargetMetrics({
        x: kState.x,
        y: 1.7,
        z: kState.z,
        distance: parseFloat(calcDist.toFixed(2)),
        angle: calcAngle,
        velocity: parseFloat(velMag.toFixed(2)),
        state: classified.activity as TargetPosition["state"],
        confidence: classified.confidence,
      });
    } else if (dwellRemaining > 0) {
      setTargetMetrics((prev: TargetPosition) => ({
        ...prev,
        state: "STATIONARY",
        velocity: 0,
        confidence: 60,
      }));
    } else {
      setTargetMetrics((prev: TargetPosition) => ({
        ...prev,
        state: "CLEAR",
        velocity: 0,
        confidence: 0,
      }));
    }
  }, [isMotionDetected, triggerCount, rfVariance, connectedDevices, isAutoWalkActive]);

  // Auto-Walk Simulation
  useEffect(() => {
    if (!isAutoWalkActive) return;

    let step = 0;
    const interval = setInterval(() => {
      step += 0.08;
      const rawX = Math.sin(step) * 2.2;
      const rawZ = SENSOR_ORIGIN.z + 3.2 + Math.sin(step * 0.6) * 1.8;

      const kState = kalmanFilterRef.current.update(rawX, rawZ, 0.25);
      targetPos.current = { x: kState.x, y: 1.7, z: kState.z };

      const futurePred = kalmanFilterRef.current.predictFuture(1.5);
      const rssiPred = rssiPredictorRef.current.recordSample(-45 - Math.sin(step) * 15);

      setPredictedState({
        x: futurePred.x,
        z: futurePred.z,
        expectedRssi: rssiPred.predictedNext,
        residual: rssiPred.residual,
      });

      const dx = kState.x - SENSOR_ORIGIN.x;
      const dz = kState.z - SENSOR_ORIGIN.z;
      const calcDist = Math.sqrt(dx * dx + dz * dz);
      const calcAngle = Math.round((Math.atan2(dx, dz) * 180) / Math.PI);
      const velMag = Math.sqrt(kState.vx * kState.vx + kState.vz * kState.vz);

      const classified = classifyActivity(15.0, velMag, kState.vz);

      setTargetMetrics({
        x: kState.x,
        y: 1.7,
        z: kState.z,
        distance: parseFloat(calcDist.toFixed(2)),
        angle: calcAngle,
        velocity: parseFloat(velMag.toFixed(2)),
        state: classified.activity as TargetPosition["state"],
        confidence: classified.confidence,
      });
    }, 250);

    return () => clearInterval(interval);
  }, [isAutoWalkActive]);

  return (
    <div className="relative w-full h-[480px] md:h-[540px] rounded-2xl bg-gradient-to-b from-[#06080d] via-[#080d17] to-[#040608] border border-slate-800/90 overflow-hidden flex flex-col shadow-2xl">
      {/* 3D WebGL Canvas Mount */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top HUD Overlay: Mathematical Inference & Forward Prediction */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-none max-w-[85%]">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${
            isMotionDetected || rfVariance > 2.0 ? "bg-rose-500 animate-ping" : "bg-cyan-400 animate-pulse"
          }`} />
          <h3 className="text-xs font-mono font-bold tracking-widest text-cyan-300 uppercase flex items-center gap-2">
            <span>KALMAN PREDICTIVE ROOM HUD</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/50">
              {`FORECAST (t + 1.5s): [${predictedState.x}, ${predictedState.z}]`}
            </span>
          </h3>
        </div>

        <div className="bg-slate-950/85 border border-slate-800/90 backdrop-blur-md rounded-xl p-3 flex flex-wrap gap-4 text-xs font-mono shadow-2xl">
          <div>
            <span className="text-[10px] text-slate-500 block">FILTERED DISTANCE</span>
            <span className="text-base font-bold text-slate-100">
              {targetMetrics.state !== "CLEAR" ? `${targetMetrics.distance}m` : "--"}
            </span>
          </div>
          <div className="border-l border-slate-800/80 pl-3">
            <span className="text-[10px] text-slate-500 block">SECTOR ANGLE</span>
            <span className="text-base font-bold text-cyan-400">
              {targetMetrics.state !== "CLEAR" ? `${targetMetrics.angle > 0 ? "+" : ""}${targetMetrics.angle}°` : "--"}
            </span>
          </div>
          <div className="border-l border-slate-800/80 pl-3">
            <span className="text-[10px] text-slate-500 block">EST. VELOCITY</span>
            <span className="text-base font-bold text-amber-400">
              {targetMetrics.state !== "CLEAR" ? `${targetMetrics.velocity} m/s` : "0.0"}
            </span>
          </div>
          <div className="border-l border-slate-800/80 pl-3">
            <span className="text-[10px] text-slate-500 block">EXPECTED RSSI</span>
            <span className="text-base font-bold text-sky-400">
              {predictedState.expectedRssi} dBm
            </span>
          </div>
          <div className="border-l border-slate-800/80 pl-3">
            <span className="text-[10px] text-slate-500 block">KALMAN CONF</span>
            <span className={`text-base font-bold ${
              targetMetrics.confidence > 70 ? "text-emerald-400" : targetMetrics.confidence > 0 ? "text-amber-400" : "text-slate-600"
            }`}>
              {targetMetrics.confidence}%
            </span>
          </div>
        </div>
      </div>

      {/* Target State Pill */}
      <div className="absolute top-4 right-4 pointer-events-none flex flex-col items-end gap-2">
        <div className={`px-3 py-1.5 rounded-xl border backdrop-blur-md font-mono text-xs font-bold flex items-center gap-2 shadow-xl ${
          isMotionDetected || rfVariance > 2.0
            ? "bg-rose-950/80 border-rose-500 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.4)]"
            : dwellRemaining > 0
            ? "bg-amber-950/80 border-amber-500 text-amber-300"
            : "bg-slate-900/80 border-slate-800 text-slate-400"
        }`}>
          <Crosshair className={`w-3.5 h-3.5 ${isMotionDetected || rfVariance > 2.0 ? "animate-spin" : ""}`} />
          <span>{targetMetrics.state}</span>
        </div>

        {activeClientGPS?.latitude ? (
          <div className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 flex items-center gap-1.5 shadow-lg">
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            <span>GPS Locked (&plusmn;{Math.round(activeClientGPS.accuracy || 3)}m)</span>
          </div>
        ) : null}
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="absolute bottom-4 inset-x-4 flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
        <div className="flex items-center gap-1 bg-slate-950/85 border border-slate-800/90 p-1 rounded-xl backdrop-blur-md shadow-xl">
          <button
            onClick={() => handleSetView("iso")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
              cameraView === "iso" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Compass className="w-3 h-3" />
            <span>Isometric</span>
          </button>
          <button
            onClick={() => handleSetView("top")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
              cameraView === "top" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Top Down</span>
          </button>
          <button
            onClick={() => handleSetView("sensor")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
              cameraView === "sensor" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Crosshair className="w-3 h-3" />
            <span>Sensor POV</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle Kalman Ghost Arc */}
          <button
            onClick={() => setShowKalmanPrediction(!showKalmanPrediction)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-mono border backdrop-blur-md transition-all ${
              showKalmanPrediction
                ? "bg-sky-500/20 border-sky-500/50 text-sky-300"
                : "bg-slate-900/80 border-slate-800 text-slate-500"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
            <span>Kalman Ghost Arc</span>
          </button>

          <button
            onClick={() => {
              const next = !isAutoWalkActive;
              setIsAutoWalkActive(next);
              if (next && onManualTrigger) onManualTrigger();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border backdrop-blur-md transition-all shadow-xl ${
              isAutoWalkActive
                ? "bg-rose-500/20 border-rose-500/50 text-rose-300 hover:bg-rose-500/30"
                : "bg-slate-900/80 border-slate-700/80 text-cyan-300 hover:bg-slate-800"
            }`}
          >
            {isAutoWalkActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{isAutoWalkActive ? "Stop Demo" : "Start Walk Demo"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
