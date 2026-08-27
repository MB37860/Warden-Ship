import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { animated, useSpring } from "@react-spring/three";

const AnimatedPointLight = animated.pointLight;
import BookMesh from "./BookMesh";
import NavigatorDeskEnvironment from "./NavigatorDeskEnvironment";

const SHOW_ENVIRONMENT = true;
const DEBUG_BRIGHT = false;

function CabinWalls() {
  const plankXs = Array.from({ length: 8 }, (_, index) => -6.1 + index * 1.74);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial color="#1a1008" roughness={0.95} />
      </mesh>

      <mesh position={[0, 2.0, -4.5]}>
        <planeGeometry args={[14, 6]} />
        <meshStandardMaterial color="#1c1208" roughness={0.9} />
      </mesh>
      {plankXs.map((x) => (
        <mesh key={x} position={[x, 2.0, -4.47]}>
          <boxGeometry args={[0.04, 6, 0.02]} />
          <meshStandardMaterial color="#141008" roughness={0.92} />
        </mesh>
      ))}

      <mesh position={[-5.5, 2.0, -0.5]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[8, 6]} />
        <meshStandardMaterial color="#1c1208" roughness={0.9} />
      </mesh>
      <mesh position={[5.5, 2.0, -0.5]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[8, 6]} />
        <meshStandardMaterial color="#1c1208" roughness={0.9} />
      </mesh>

      <mesh position={[0, 4.5, -0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 8]} />
        <meshStandardMaterial color="#111008" roughness={0.95} />
      </mesh>
      {[-1, -3].map((z) => (
        <mesh key={z} position={[0, 4.36, z]}>
          <boxGeometry args={[14, 0.18, 0.28]} />
          <meshStandardMaterial color="#0e0c06" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function PortholeWindow() {
  return (
    <group position={[-2.8, 2.4, -4.4]}>
      <mesh position={[0, 0, -0.01]}>
        <circleGeometry args={[0.54, 48]} />
        <meshStandardMaterial color="#0a1520" emissive="#0a1828" emissiveIntensity={0.4} roughness={0.72} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.55, 0.72, 56]} />
        <meshStandardMaterial color="#3a2a10" metalness={0.4} roughness={0.6} />
      </mesh>
      <pointLight color="#1a3050" intensity={0.3} position={[0, 0, 0.2]} />
    </group>
  );
}

function WallLantern() {
  return (
    <group>
      <mesh position={[5.3, 2.2, -1.5]}>
        <boxGeometry args={[0.18, 0.28, 0.18]} />
        <meshStandardMaterial color="#2a1a08" metalness={0.5} roughness={0.5} />
      </mesh>
      <pointLight color="#ff9922" intensity={0.4} position={[5.0, 2.2, -1.5]} />
    </group>
  );
}

function CabinAtmosphere() {
  return (
    <group>
      <CabinWalls />
      <PortholeWindow />
      <WallLantern />
    </group>
  );
}

function CandleLight() {
  const { invalidate } = useThree();
  const [spring, api] = useSpring(() => ({ intensity: 0 }));

  useEffect(() => {
    api.start({
      to: async (next) => {
        await next({ intensity: DEBUG_BRIGHT ? 2.2 : 2.05, config: { duration: 560 } });
        await next({ intensity: DEBUG_BRIGHT ? 2.1 : 1.9, config: { duration: 440 } });
      },
      onChange: invalidate,
    });
  }, [api, invalidate]);

  return (
    <>
      {/* Both candles share the same spring, so neither can out-shine the other. */}
      <AnimatedPointLight
        color="#ffb15c"
        intensity={spring.intensity}
        position={[-1.9, 1.2, 0.62]}
      />
      <AnimatedPointLight
        color="#ffb15c"
        intensity={spring.intensity}
        position={[1.9, 1.2, -0.05]}
      />
      <pointLight color="#fff2d6" intensity={DEBUG_BRIGHT ? 1.05 : 0.85} position={[0, 2.3, 1.35]} />
      <pointLight color="#7b8fa9" intensity={DEBUG_BRIGHT ? 0.2 : 0.1} position={[1.8, 1.4, -1.9]} />
    </>
  );
}

function SceneContents(props) {
  return (
    <>
      <color attach="background" args={["#0d0a06"]} />
      <fog attach="fog" args={["#0a0804", 4, 14]} />
      <PerspectiveCamera
        makeDefault
        fov={48}
        position={[0, 2.8, 3.0]}
        onUpdate={(camera) => camera.lookAt(0, 0.2, 0)}
      />
      <ambientLight intensity={DEBUG_BRIGHT ? 0.8 : 0.45} color="#f1d8aa" />
      <CandleLight />
      <CabinAtmosphere />
      {SHOW_ENVIRONMENT && (
        <NavigatorDeskEnvironment
          debug={DEBUG_BRIGHT}
          selectedArtwork={props.selectedArtwork}
          selectedClassification={props.selectedClassification}
        />
      )}
      {DEBUG_BRIGHT ? <axesHelper args={[2.6]} /> : null}
      <BookMesh {...props} />
    </>
  );
}

export default function LogbookScene(props) {
  return (
    <Canvas
      frameloop="demand"
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 1.5]}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
