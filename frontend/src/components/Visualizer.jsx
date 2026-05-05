import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export default function Visualizer({ analyzer }) {
  const groupRef = useRef();
  
  // 128 bars for a highly detailed, smooth circle
  const NUM_BARS = 128;
  const radius = 5;
  
  // Data array
  const dataArray = useMemo(() => {
    if (!analyzer) return new Uint8Array(0);
    return new Uint8Array(analyzer.frequencyBinCount);
  }, [analyzer]);

  const barRefs = useRef([]);

  // CRITICAL FIX: Translate the geometry origin to the bottom.
  // This ensures the bars only grow OUTWARDS, instead of growing in both directions and making a mess.
  const barGeometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.12, 1, 0.1);
    geo.translate(0, 0.5, 0);
    return geo;
  }, []);

  useFrame(() => {
    if (!analyzer || !groupRef.current) return;
    analyzer.getByteFrequencyData(dataArray);

    for (let i = 0; i < NUM_BARS; i++) {
      const mesh = barRefs.current[i];
      if (!mesh) continue;
      
      // We map the 128 bars to the first 128 frequencies (bass to lower-treble)
      const dataValue = dataArray[i]; 
      
      // Quadratic scaling makes the bass punchy and the noise clean
      const normalizedValue = dataValue / 255;
      const targetScale = 0.1 + Math.pow(normalizedValue, 2) * 8;
      
      // SMOOTHING: We lerp the scale instead of snapping it instantly.
      // This stops the visualizer from looking jagged, jittery, and chaotic.
      mesh.scale.y += (targetScale - mesh.scale.y) * 0.2;
      
      // Glow brightly when tall
      mesh.material.emissiveIntensity = 0.5 + normalizedValue * 2;
    }
    
    // Slowly rotate the entire halo ring
    groupRef.current.rotation.z += 0.002;
  });

  const bars = useMemo(() => {
    const tempBars = [];
    for (let i = 0; i < NUM_BARS; i++) {
      const angle = (i / NUM_BARS) * Math.PI * 2;
      
      // Calculate position on the circle
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      
      // Rotate the bar to point perfectly outward from the center
      const rotationZ = angle - Math.PI / 2;

      // Create a seamless rainbow gradient wheel
      const hue = i / NUM_BARS;
      const color = new THREE.Color().setHSL(hue, 1, 0.6);

      tempBars.push(
        <mesh 
          key={i} 
          position={[x, y, 0]} 
          rotation={[0, 0, rotationZ]}
          ref={(el) => (barRefs.current[i] = el)}
          geometry={barGeometry}
        >
          <meshStandardMaterial 
            color={color} 
            emissive={color}
            emissiveIntensity={1}
            roughness={0.2}
            metalness={0.8}
          />
        </mesh>
      );
    }
    return tempBars;
  }, [NUM_BARS, radius, barGeometry]);

  return (
    <group position={[0, 0, -10]}>
      <DynamicBackground analyzer={analyzer} dataArray={dataArray} />
      <mesh ref={groupRef}>
        {bars}
      </mesh>
    </group>
  );
}

// Dynamically changes the scene's background color based on the exact Song Type using Spectral Centroid
function DynamicBackground({ analyzer, dataArray }) {
  const { scene } = useThree();
  const bgColor = useMemo(() => new THREE.Color('#000000'), []);
  const targetColor = useMemo(() => new THREE.Color('#000000'), []);
  
  useFrame(() => {
    if (!analyzer || dataArray.length === 0) return;
    
    let sumFreqs = 0;
    let sumWeights = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const val = dataArray[i];
      sumFreqs += val;
      sumWeights += val * i;
    }
    
    if (sumFreqs === 0) {
      targetColor.setHSL(0, 0, 0);
    } else {
      // Spectral Centroid gives a unique value for different songs
      // Bass heavy = low value. Acoustic = mid. Electronic = high.
      const centroid = sumWeights / sumFreqs;
      const normalizedCentroid = Math.min(centroid / 40, 1);
      
      const targetHue = normalizedCentroid; // Different hue for different songs
      const saturation = 0.8;
      
      const loudness = sumFreqs / (dataArray.length * 255);
      const lightness = Math.min(loudness * 0.8, 0.15); // Keep it dark and atmospheric
      
      targetColor.setHSL(targetHue, saturation, lightness);
    }
    
    // Smoothly fade the background color
    bgColor.lerp(targetColor, 0.05);
    scene.background = bgColor;
  });
  
  return null;
}
