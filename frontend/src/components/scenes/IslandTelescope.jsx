import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import useWebGLAvailable from "../../hooks/useWebGLAvailable";
import islandModel from "../../assets/models/island.glb";
import telescopeModel from "../../assets/models/telescope.glb";
import NightSky from "../shared/NightSky";
import styles from "./IslandTelescope.module.css";

function tuneMaterial(material) {
  if (!material || !material.color) {
    return;
  }

  if ("roughness" in material && typeof material.roughness === "number") {
    material.roughness = THREE.MathUtils.clamp(material.roughness, 0.32, 0.9);
  }

  if ("metalness" in material && typeof material.metalness === "number") {
    material.metalness = Math.min(material.metalness, 0.5);
  }

  const luminance =
    0.2126 * material.color.r +
    0.7152 * material.color.g +
    0.0722 * material.color.b;

  if (luminance < 0.08) {
    material.color.multiplyScalar(1.55);
  }

  material.needsUpdate = true;
}

function useNormalizedModel(scene, targetHeight) {
  return useMemo(() => {
    const model = scene.clone(true);

    model.traverse((node) => {
      if (!node.isMesh || !node.material) {
        return;
      }

      node.castShadow = true;
      node.receiveShadow = true;

      if (Array.isArray(node.material)) {
        node.material = node.material.map((entry) => {
          const cloned = entry.clone();
          tuneMaterial(cloned);
          return cloned;
        });
      } else {
        const cloned = node.material.clone();
        tuneMaterial(cloned);
        node.material = cloned;
      }
    });

    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const height = Math.max(size.y, 0.001);
    const scale = targetHeight / height;

    model.scale.setScalar(scale);
    model.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );

    return model;
  }, [scene, targetHeight]);
}

const SEA_OVERLAY_HEIGHT = 2.72;
const WAVE_OVERLAY_HEIGHT = 2.86;
const SEA_OVERLAY_SIZE = 140;

function IslandSea() {
  const seaMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uDeepColor: { value: new THREE.Color("#062235") },
          uShallowColor: { value: new THREE.Color("#12a5c4") },
          uHighlightColor: { value: new THREE.Color("#d2fbff") },
        },
        vertexShader: `
          uniform float uTime;
          varying vec2 vUv;
          varying vec2 vCentered;
          varying float vWave;

          void main() {
            vUv = uv;
            vCentered = position.xy / 22.5;

            vec3 nextPosition = position;
            float radius = length(vCentered);
            float angle = atan(vCentered.y, vCentered.x);
            float coastBreak =
              sin(angle * 5.0 + uTime * 0.16) * 0.26 +
              sin(angle * 11.0 - uTime * 0.12) * 0.14;
            float radialSwell = sin(radius * 27.0 + uTime * 0.55 + coastBreak) * 0.038;
            float lowSwell = sin(radius * 9.0 + uTime * 0.28) * 0.032;
            float edgeFade = 1.0 - smoothstep(0.88, 1.35, radius);

            vWave = (radialSwell + lowSwell) * edgeFade;
            nextPosition.z += vWave;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(nextPosition, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uDeepColor;
          uniform vec3 uShallowColor;
          uniform vec3 uHighlightColor;

          varying vec2 vUv;
          varying vec2 vCentered;
          varying float vWave;

          void main() {
            float radius = length(vCentered);
            float angle = atan(vCentered.y, vCentered.x);
            float edgeDepth = smoothstep(0.08, 0.72, radius);
            float edgeAlpha =
              smoothstep(0.0, 0.08, vUv.x) *
              smoothstep(0.0, 0.08, vUv.y) *
              smoothstep(0.0, 0.08, 1.0 - vUv.x) *
              smoothstep(0.0, 0.08, 1.0 - vUv.y);
            float brokenMask =
              0.58 +
              0.24 * sin(angle * 13.0 + uTime * 0.22) +
              0.18 * sin(angle * 23.0 - uTime * 0.17);
            float radialShimmer =
              smoothstep(
                0.78,
                0.99,
                sin(radius * 58.0 + uTime * 0.82 + brokenMask)
              );
            float islandFade = smoothstep(0.12, 0.24, radius);
            float outerFade = 1.0 - smoothstep(0.9, 1.18, radius);

            vec3 color = mix(uShallowColor, uDeepColor, edgeDepth * 0.7);
            color += uHighlightColor * radialShimmer * brokenMask * islandFade * outerFade * 0.15;
            color += uHighlightColor * smoothstep(0.032, 0.076, vWave) * 0.12;

            gl_FragColor = vec4(color, 0.92 * edgeAlpha);
          }
        `,
      }),
    [],
  );
  const seaMaterialRef = useRef(seaMaterial);

  useEffect(() => {
    seaMaterialRef.current = seaMaterial;
  }, [seaMaterial]);

  useFrame((state) => {
    seaMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh
      position={[0, SEA_OVERLAY_HEIGHT, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <planeGeometry args={[SEA_OVERLAY_SIZE, SEA_OVERLAY_SIZE, 160, 160]} />
      <primitive object={seaMaterial} attach="material" />
    </mesh>
  );
}

function IncomingWaves() {
  const waveMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uFoamColor: { value: new THREE.Color("#d6fbff") },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec2 vCentered;

          void main() {
            vUv = uv;
            vCentered = position.xy / 22.5;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uFoamColor;

          varying vec2 vUv;
          varying vec2 vCentered;

          void main() {
            float radius = length(vCentered);
            float angle = atan(vCentered.y, vCentered.x);
            float edgeAlpha =
              smoothstep(0.0, 0.08, vUv.x) *
              smoothstep(0.0, 0.08, vUv.y) *
              smoothstep(0.0, 0.08, 1.0 - vUv.x) *
              smoothstep(0.0, 0.08, 1.0 - vUv.y);
            float shorelineNoise =
              sin(angle * 7.0 + uTime * 0.26) * 0.42 +
              sin(angle * 17.0 - uTime * 0.19) * 0.24 +
              sin(angle * 29.0 + radius * 10.0) * 0.12;
            float inwardPhase = radius * 42.0 + uTime * 0.9 + shorelineNoise;
            float ring = smoothstep(0.86, 0.995, sin(inwardPhase));
            float brokenRing =
              ring * smoothstep(0.18, 0.34, radius) * (1.0 - smoothstep(0.76, 1.05, radius));
            float brokenMask =
              smoothstep(0.18, 0.96, 0.62 + 0.38 * sin(angle * 21.0 + uTime * 0.32));
            float opacity = brokenRing * brokenMask * edgeAlpha * 0.32;

            gl_FragColor = vec4(uFoamColor, opacity);
          }
        `,
      }),
    [],
  );
  const waveMaterialRef = useRef(waveMaterial);

  useEffect(() => {
    waveMaterialRef.current = waveMaterial;
  }, [waveMaterial]);

  useFrame((state) => {
    waveMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh
      position={[0, WAVE_OVERLAY_HEIGHT, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={3}
    >
      <planeGeometry args={[SEA_OVERLAY_SIZE, SEA_OVERLAY_SIZE]} />
      <primitive object={waveMaterial} attach="material" />
    </mesh>
  );
}

function IslandSet({ isHovered, onHoverChange, onInteract }) {
  const { scene: islandSceneRaw } = useGLTF(islandModel);
  const { scene: telescopeSceneRaw } = useGLTF(telescopeModel);
  const islandScene = useNormalizedModel(islandSceneRaw, 9.2);
  const telescopeScene = useNormalizedModel(telescopeSceneRaw, 2.25);
  const islandRef = useRef(null);
  const telescopeRef = useRef(null);

  const glowColor = useMemo(() => new THREE.Color("#eaf3ff"), []);
  const telescopeMaterials = useMemo(() => {
    const materials = [];
    telescopeScene.traverse((node) => {
      if (!node.isMesh || !node.material) {
        return;
      }
      const list = Array.isArray(node.material) ? node.material : [node.material];
      list.forEach((material) => {
        if (!material.emissive) {
          return;
        }
        material.userData.baseEmissive = material.emissive.clone();
        material.userData.baseEmissiveIntensity =
          typeof material.emissiveIntensity === "number"
            ? material.emissiveIntensity
            : 1;
        materials.push(material);
      });
    });
    return materials;
  }, [telescopeScene]);

  useFrame((state) => {
    if (!islandRef.current || !telescopeRef.current) {
      return;
    }

    const float = Math.sin(state.clock.elapsedTime * 0.62) * 0.08;
    islandRef.current.position.y = -2.55 + float;
    islandRef.current.rotation.y =
      -0.5 + Math.sin(state.clock.elapsedTime * 0.22) * 0.035;

    telescopeRef.current.position.y = 0.18 + float * 0.9;
    telescopeRef.current.rotation.y =
      -0.1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.03;

    telescopeMaterials.forEach((material) => {
      const baseEmissive = material.userData.baseEmissive;
      const baseIntensity = material.userData.baseEmissiveIntensity ?? 1;
      if (baseEmissive) {
        material.emissive.copy(isHovered ? glowColor : baseEmissive);
      }
      // Small fixed glow so the model reads a touch brighter on hover
      // instead of washing out to white.
      material.emissiveIntensity = isHovered ? 0.12 : baseIntensity;
    });
  });

  return (
    <group>
      <group
        ref={islandRef}
        position={[0, -2.55, -4.2]}
        rotation={[0.02, -0.5, 0]}
      >
        <primitive object={islandScene} />
        <IslandSea />
        <IncomingWaves />
      </group>

      <mesh
        position={[2.05, -0.08, -0.85]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <circleGeometry args={[1.2, 44]} />
        <meshStandardMaterial
          color="#0f1b1a"
          roughness={1}
          metalness={0.02}
          transparent
          opacity={0.42}
        />
      </mesh>

      <group
        ref={telescopeRef}
        position={[2.05, 0.18, -0.85]}
        rotation={[0.08, -0.1, 0]}
      >
        <primitive
          object={telescopeScene}
          onPointerOver={(event) => {
            event.stopPropagation();
            onHoverChange(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            onHoverChange(false);
            document.body.style.cursor = "";
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onInteract();
          }}
        />
      </group>
    </group>
  );
}

function ArrivalSequence({ isActive, onArrivalComplete, controlsRef }) {
  const { camera, scene } = useThree();
  const sequenceRef = useRef({
    active: false,
    startedAt: 0,
    impactAt: 0,
    impactTriggered: false,
    arrivalCompleted: false,
  });
  const ballRef = useRef(null);
  const ballTextureRef = useRef(null);
  const ballTrailLightRef = useRef(null);
  const impactLightRef = useRef(null);
  const shockwaveRef = useRef(null);
  const debrisRef = useRef([]);
  const dustRef = useRef([]);
  const startPosition = useMemo(() => new THREE.Vector3(2.5, 5, 13), []);
  const targetPosition = useMemo(() => new THREE.Vector3(2.05, 3.6, -0.2), []);
  const islandCenter = useMemo(() => new THREE.Vector3(0, 0, -4), []);
  const impactCenter = useMemo(() => new THREE.Vector3(2.05, 3.6, -0.2), []);
  const cameraGoal = useMemo(() => new THREE.Vector3(4, 11, 14), []);

  const createCannonballTexture = useCallback(() => {
    const size = 64;
    const data = new Uint8Array(size * size);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.floor(90 + Math.random() * 165);
    }
    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }, []);

  const cleanupObjects = useCallback(() => {
    if (ballRef.current) {
      scene.remove(ballRef.current);
      ballRef.current.geometry.dispose();
      ballRef.current.material.dispose();
      ballRef.current = null;
    }

    if (ballTextureRef.current) {
      ballTextureRef.current.dispose();
      ballTextureRef.current = null;
    }

    if (ballTrailLightRef.current) {
      scene.remove(ballTrailLightRef.current);
      ballTrailLightRef.current = null;
    }

    if (impactLightRef.current) {
      scene.remove(impactLightRef.current);
      impactLightRef.current = null;
    }

    if (shockwaveRef.current) {
      scene.remove(shockwaveRef.current);
      shockwaveRef.current.geometry.dispose();
      shockwaveRef.current.material.dispose();
      shockwaveRef.current = null;
    }

    debrisRef.current.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    debrisRef.current = [];

    dustRef.current.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    dustRef.current = [];
  }, [scene]);

  useEffect(() => cleanupObjects, [cleanupObjects]);

  useEffect(() => {
    if (isActive && controlsRef?.current) {
      controlsRef.current.enabled = false;
    }
  }, [controlsRef, isActive]);

  const startSequence = useCallback(
    (clockTime) => {
      if (ballTextureRef.current) {
        ballTextureRef.current.dispose();
      }
      const ballTexture = createCannonballTexture();
      ballTextureRef.current = ballTexture;

      const ballGeometry = new THREE.SphereGeometry(0.07, 24, 24);
      const ballMaterial = new THREE.MeshStandardMaterial({
        color: "#2a2a2a",
        emissive: "#0a0a0a",
        emissiveIntensity: 0.05,
        roughness: 0.5,
        metalness: 0.85,
        bumpMap: ballTexture,
        bumpScale: 0.08,
        roughnessMap: ballTexture,
        metalnessMap: ballTexture,
      });
      const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
      ballMesh.position.copy(startPosition);
      scene.add(ballMesh);
      ballRef.current = ballMesh;

      sequenceRef.current.active = true;
      sequenceRef.current.startedAt = clockTime;
      sequenceRef.current.impactTriggered = false;
      sequenceRef.current.arrivalCompleted = false;
    },
    [createCannonballTexture, scene, startPosition],
  );

  const triggerImpact = useCallback(
    (clockTime) => {
      sequenceRef.current.impactTriggered = true;
      sequenceRef.current.impactAt = clockTime;

      if (ballRef.current && ballRef.current.visible) {
        ballRef.current.visible = false;
        if (ballTrailLightRef.current) {
          scene.remove(ballTrailLightRef.current);
          ballTrailLightRef.current = null;
        }
      }

      const impactLight = new THREE.PointLight("#ffcc44", 35, 24, 2.2);
      impactLight.position.copy(impactCenter);
      scene.add(impactLight);
      impactLightRef.current = impactLight;

      const shockwaveGeometry = new THREE.TorusGeometry(0.2, 0.06, 16, 64);
      const shockwaveMaterial = new THREE.MeshBasicMaterial({
        color: "#ffd7a6",
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });
      const shockwaveMesh = new THREE.Mesh(
        shockwaveGeometry,
        shockwaveMaterial,
      );
      shockwaveMesh.position.copy(impactCenter);
      shockwaveMesh.rotation.x = Math.PI / 2;
      shockwaveMesh.scale.setScalar(0);
      scene.add(shockwaveMesh);
      shockwaveRef.current = shockwaveMesh;

      const debris = Array.from({ length: 16 }, () => {
        const size = 0.05 + Math.random() * 0.1;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshStandardMaterial({
          color: "#9b7a57",
          roughness: 0.9,
          metalness: 0,
          transparent: true,
          opacity: 0.9,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(impactCenter);
        // Velocities converted to units/sec and slowed by 30% (70% speed)
        const velocity = new THREE.Vector3(
          (Math.random() - 0.5) * 7.56,
          3.36 + Math.random() * 6.72,
          (Math.random() - 0.5) * 7.56,
        );
        scene.add(mesh);
        return { mesh, velocity, age: 0 };
      });
      debrisRef.current = debris;

      const dust = Array.from({ length: 6 }, () => {
        const geometry = new THREE.PlaneGeometry(0.5, 0.35);
        const material = new THREE.MeshBasicMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(impactCenter);
        mesh.position.add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            0.2 + Math.random() * 0.6,
            (Math.random() - 0.5) * 1.2,
          ),
        );
        scene.add(mesh);
        return { mesh, age: 0 };
      });
      dustRef.current = dust;
    },
    [impactCenter, scene],
  );

  useFrame((state, delta) => {
    if (!sequenceRef.current.active && isActive) {
      startSequence(state.clock.elapsedTime);
    }

    if (!sequenceRef.current.active) {
      return;
    }

    const elapsed = state.clock.elapsedTime - sequenceRef.current.startedAt;
    const dropDuration = 2.8;
    const t = Math.min(elapsed / dropDuration, 1);
    const arc = 1.2 * 4 * t * (1 - t);

    if (ballRef.current && !sequenceRef.current.impactTriggered) {
      const nextX = THREE.MathUtils.lerp(startPosition.x, targetPosition.x, t);
      const nextZ = THREE.MathUtils.lerp(startPosition.z, targetPosition.z, t);
      const nextY =
        THREE.MathUtils.lerp(startPosition.y, targetPosition.y, t) + arc;
      ballRef.current.position.set(nextX, nextY, nextZ);
      if (!ballTrailLightRef.current) {
        const trailLight = new THREE.PointLight("#d8d8d8", 3.2, 14, 2);
        scene.add(trailLight);
        ballTrailLightRef.current = trailLight;
      }
      ballTrailLightRef.current.position.copy(ballRef.current.position);

      if (t >= 1 || ballRef.current.position.distanceTo(targetPosition) < 0.5) {
        ballRef.current.position.copy(targetPosition);
        triggerImpact(state.clock.elapsedTime);
      }
    }

    if (sequenceRef.current.impactTriggered) {
      const impactElapsed =
        state.clock.elapsedTime - sequenceRef.current.impactAt;
      // Scale impact duration to slow it down by 30%
      const slowImpactElapsed = impactElapsed * 0.7;

      if (impactLightRef.current) {
        const lightFade = Math.min(slowImpactElapsed / 0.9, 1);
        impactLightRef.current.intensity = 35 * (1 - lightFade);
      }

      if (shockwaveRef.current) {
        const waveProgress = Math.min(slowImpactElapsed / 0.8, 1);
        const waveScale = THREE.MathUtils.lerp(0, 5, waveProgress);
        shockwaveRef.current.scale.setScalar(waveScale);
        shockwaveRef.current.material.opacity = 0.7 * (1 - waveProgress);
      }

      const slowDelta = delta * 0.7;

      debrisRef.current.forEach((chunk) => {
        chunk.age += slowDelta;
        // Gravity scaled by slowDelta
        chunk.velocity.y -= 14.112 * slowDelta;
        // Position update scaled smoothly by slowDelta
        chunk.mesh.position.addScaledVector(chunk.velocity, slowDelta);
        chunk.mesh.material.opacity = Math.max(1 - chunk.age / 2, 0);
        chunk.mesh.visible = chunk.mesh.material.opacity > 0.02;
      });

      dustRef.current.forEach((puff) => {
        puff.age += slowDelta;
        const progress = Math.min(puff.age / 1.5, 1);
        const scale = THREE.MathUtils.lerp(0.6, 2.4, progress);
        puff.mesh.scale.set(scale, scale, scale);
        puff.mesh.material.opacity = 0.4 * (1 - progress);
        puff.mesh.lookAt(camera.position);
      });

      if (sequenceRef.current.arrivalCompleted && slowImpactElapsed > 2.4) {
        sequenceRef.current.active = false;
      }
    }

    if (elapsed < 2) {
      camera.position.lerp(cameraGoal, 0.035);
      camera.lookAt(islandCenter);
    } else if (!sequenceRef.current.arrivalCompleted) {
      sequenceRef.current.arrivalCompleted = true;
      if (controlsRef?.current) {
        controlsRef.current.enabled = true;
      }
      onArrivalComplete?.();
    }
  });

  return null;
}

function IslandCinematicCamera({ active }) {
  const { camera } = useThree();
  const startedAtRef = useRef(null);
  const desiredPosition = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!active) {
      startedAtRef.current = null;
      return;
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startedAtRef.current;
    const angle = -0.78 + elapsed * 0.035;
    const radius = 8.4 + Math.sin(elapsed * 0.18) * 0.28;
    const height = 2.55 + Math.sin(elapsed * 0.24) * 0.16;

    desiredPosition.set(
      Math.cos(angle) * radius - 0.2,
      height,
      -3.55 + Math.sin(angle) * radius,
    );
    lookTarget.set(
      0.15,
      0.85 + Math.sin(elapsed * 0.16) * 0.08,
      -3.6,
    );

    camera.position.lerp(desiredPosition, 0.022);
    camera.lookAt(lookTarget);
  });

  return null;
}

function IslandScene({
  isHovered,
  onHoverChange,
  onInteract,
  ballArriving,
  onArrivalComplete,
  cinematicMode,
}) {
  const controlsRef = useRef(null);
  return (
    <Canvas
      dpr={[1, 1.35]}
      shadows
      camera={{ position: [0.8, 15, 8.8], fov: 50, near: 0.1, far: 80 }}
      gl={{ antialias: false, alpha: false, powerPreference: "default" }}
    >
      <color attach="background" args={["#081a2d"]} />
      <fog attach="fog" args={["#081a2d", 8, 42]} />
      <NightSky
        radius={64}
        starCount={280}
        minStarY={0.005}
        moonPosition={[28, 12, -30]}
        topColor="#071427"
        horizonColor="#164469"
        moonColor="#edf7ff"
        warmSkyStrength={0.64}
        warmHorizonColor="#f08f3f"
        warmBandColor="#df624c"
      />

      <ambientLight intensity={0.48} color="#c8ddf1" />
      <hemisphereLight
        args={["#d6e8ff", "#173147", 0.5]}
        position={[0, 14, 0]}
      />
      <directionalLight
        position={[4.8, 8.2, 5.1]}
        intensity={1.85}
        color="#ffd8ac"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <spotLight
        position={[-1.2, 4.8, 2.6]}
        intensity={5.8}
        angle={0.48}
        penumbra={0.52}
        color="#a7d3ff"
      />

      <IslandSet
        isHovered={isHovered}
        onHoverChange={onHoverChange}
        onInteract={onInteract}
      />
      <ArrivalSequence
        isActive={ballArriving}
        onArrivalComplete={onArrivalComplete}
        controlsRef={controlsRef}
      />
      <IslandCinematicCamera active={cinematicMode} />
      <OrbitControls
        ref={controlsRef}
        target={[0.25, 0.35, -3.75]}
        enablePan={false}
        enableZoom
        minDistance={5.5}
        maxDistance={15}
        minPolarAngle={Math.PI * 0.06}
        maxPolarAngle={Math.PI * 0.48}
        enabled={!ballArriving}
      />
      {/* Procedural night environment — no remote HDRI fetch, so it works
          offline and never loses the WebGL context on a network failure. */}
      <Environment resolution={64} frames={1} background={false}>
        <Lightformer intensity={0.7} color="#5b7fb0" position={[0, 6, -6]} scale={[12, 12, 1]} />
        <Lightformer intensity={0.35} color="#2a3a5a" position={[-6, 2, 4]} scale={[8, 8, 1]} />
        <Lightformer intensity={0.3} color="#243049" position={[6, 2, 4]} scale={[8, 8, 1]} />
      </Environment>
    </Canvas>
  );
}

function IslandTelescope({
  onLookThrough,
  onBackToRoom,
  onBackToShip,
  ballArriving = false,
  onArrivalComplete,
  cinematicMode = false,
}) {
  const [isHovered, setHovered] = useState(false);
  const [isLooking, setLooking] = useState(false);
  const isWebGLAvailable = useWebGLAvailable();

  useEffect(() => {
    if (!isLooking) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      onLookThrough();
    }, 760);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isLooking, onLookThrough]);

  return (
    <div
      className={`${styles.islandRoot} ${cinematicMode ? styles.cinematicMode : ""}`}
    >
      {isWebGLAvailable ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
          }}
        >
          <IslandScene
            isHovered={isHovered}
            onHoverChange={setHovered}
            onInteract={() => setLooking(true)}
            ballArriving={ballArriving}
            onArrivalComplete={onArrivalComplete}
            cinematicMode={cinematicMode}
          />
        </div>
      ) : (
        <div className={styles.fallbackNotice}>WebGL unavailable</div>
      )}

      {!cinematicMode ? <p
        className={`${styles.interactionHint} ${isHovered ? styles.interactionHintActive : ""}`}
      >
        {isHovered
          ? "Click the telescope to see the stars"
          : "Rotate your view and hover the telescope"}
      </p> : null}

      <div
        className={`${styles.scopeFlash} ${isLooking ? styles.scopeFlashActive : ""}`}
      />

      {!cinematicMode ? <div className={styles.controls}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onBackToRoom}
        >
          Back to Chest Room
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onBackToShip}
        >
          Back to Ship
        </button>
      </div> : null}
    </div>
  );
}

useGLTF.preload(islandModel);
useGLTF.preload(telescopeModel);

export default IslandTelescope;
