import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function seededUnit(seed) {
  const value = Math.sin(seed * 127.1) * 43758.5453;
  return value - Math.floor(value);
}

function buildStarPositions(count, radius, minY) {
  return Array.from({ length: count }, (_, index) => {
    const theta = seededUnit(index + 1) * Math.PI * 2;
    const y = minY + seededUnit(index + 97) ** 1.85 * (1 - minY);
    const horizontalRadius = Math.sqrt(Math.max(0, 1 - y * y));

    return [
      Math.cos(theta) * horizontalRadius * radius,
      y * radius,
      Math.sin(theta) * horizontalRadius * radius,
    ];
  });
}

function TwinklingStars({ stars }) {
  const twinkleRefs = useRef([]);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    twinkleRefs.current.forEach((mesh, index) => {
      if (!mesh) return;

      const pulse =
        (Math.sin(elapsed * (1.35 + (index % 5) * 0.24) + index * 1.7) + 1) /
        2;
      const scale = 0.78 + pulse * 0.42;
      mesh.scale.setScalar(scale);
      mesh.material.opacity = 0.32 + pulse * 0.58;
    });
  });

  return (
    <group>
      {stars
        .filter((_, index) => index % 13 === 0)
        .map((position, index) => (
          <mesh
            key={`twinkle-${index}`}
            ref={(node) => {
              twinkleRefs.current[index] = node;
            }}
            position={position}
            scale={[1, 1, 1]}
            renderOrder={-89}
          >
            <sphereGeometry args={[0.13, 8, 8]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.48}
              depthWrite={false}
              fog={false}
              toneMapped={false}
            />
          </mesh>
        ))}
    </group>
  );
}

function NightSky({
  radius = 72,
  starCount = 90,
  minStarY = 0.12,
  moonPosition = [34, 28, -38],
  topColor = "#071326",
  horizonColor = "#163b5c",
  moonColor = "#f4e6ba",
  warmSkyStrength = 0,
  warmHorizonColor = "#c86b36",
  warmBandColor = "#d13f6f",
}) {
  const skyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTopColor: { value: new THREE.Color(topColor) },
          uHorizonColor: { value: new THREE.Color(horizonColor) },
          uWarmHorizonColor: { value: new THREE.Color(warmHorizonColor) },
          uWarmBandColor: { value: new THREE.Color(warmBandColor) },
          uWarmSkyStrength: { value: warmSkyStrength },
        },
        vertexShader: `
          varying vec3 vWorldPosition;

          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 uTopColor;
          uniform vec3 uHorizonColor;
          uniform vec3 uWarmHorizonColor;
          uniform vec3 uWarmBandColor;
          uniform float uWarmSkyStrength;
          varying vec3 vWorldPosition;

          void main() {
            vec3 direction = normalize(vWorldPosition);
            float height = direction.y;
            float blend = smoothstep(-0.1, 0.82, height);
            vec3 color = mix(uHorizonColor, uTopColor, blend);

            float horizonWarmth = smoothstep(0.46, -0.02, height) * uWarmSkyStrength;
            float bandCenter =
              0.16 +
              sin(direction.x * 3.2 + direction.z * 2.4) * 0.045 +
              direction.x * 0.08;
            float warmBand =
              smoothstep(0.17, 0.0, abs(height - bandCenter)) *
              smoothstep(-0.04, 0.2, height) *
              smoothstep(0.56, 0.08, height) *
              uWarmSkyStrength;

            color = mix(color, uWarmHorizonColor, horizonWarmth * 0.42);
            color = mix(color, uWarmBandColor, warmBand * 0.26);

            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    [horizonColor, topColor, warmBandColor, warmHorizonColor, warmSkyStrength],
  );

  const stars = useMemo(
    () => buildStarPositions(starCount, radius * 0.94, minStarY),
    [minStarY, radius, starCount],
  );

  const moonQuaternion = useMemo(() => {
    const quaternion = new THREE.Quaternion();
    const matrix = new THREE.Matrix4();
    matrix.lookAt(
      new THREE.Vector3(...moonPosition),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
    );
    quaternion.setFromRotationMatrix(matrix);
    return quaternion;
  }, [moonPosition]);

  return (
    <group>
      <mesh renderOrder={-100}>
        <sphereGeometry args={[radius, 48, 24]} />
        <primitive object={skyMaterial} attach="material" />
      </mesh>

      <group>
        {stars.map((position, index) => {
          const starSize =
            index % 17 === 0 ? 0.17 : index % 7 === 0 ? 0.12 : 0.075;
          const starColor =
            index % 11 === 0
              ? "#fffdf2"
              : index % 5 === 0
                ? "#fbfeff"
                : "#ffffff";

          return (
            <mesh key={index} position={position} renderOrder={-90}>
              <sphereGeometry args={[starSize, 8, 8]} />
              <meshBasicMaterial
                color={starColor}
                depthWrite={false}
                fog={false}
                toneMapped={false}
              />
            </mesh>
          );
        })}
        <TwinklingStars stars={stars} />
      </group>

      <mesh
        position={moonPosition}
        quaternion={moonQuaternion}
        renderOrder={-80}
      >
        <circleGeometry args={[2.4, 48]} />
        <meshBasicMaterial color={moonColor} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default NightSky;
