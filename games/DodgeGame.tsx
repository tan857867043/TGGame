import React, { useRef, useEffect, useState } from 'react';
import { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { GameObject } from '../types';
import { sfx } from '../services/audioService';

interface DodgeGameProps {
  landmarker: PoseLandmarker | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onGameOver: (score: number) => void;
  isActive: boolean;
}

// Extended types for visual flair
interface VisualObject extends GameObject {
  rotation: number;
  rotationSpeed: number;
  visualType: 'enemy_ship' | 'asteroid' | 'energy_core';
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export const DodgeGame: React.FC<DodgeGameProps> = ({ landmarker, videoRef, onGameOver, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const scoreRef = useRef(0);
  
  // Entities
  const objectsRef = useRef<VisualObject[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastSpawnTime = useRef(0);
  
  // Player Physics
  const targetPlayerXRef = useRef(0.5);
  const currentPlayerXRef = useRef(0.5);
  const playerBankAngleRef = useRef(0); // For tilting visuals
  
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [hudScore, setHudScore] = useState(0);

  // Background stars
  const starsRef = useRef<{x: number, y: number, size: number, speed: number, tail: number}[]>([]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
        setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize Warp Stars
  useEffect(() => {
    const stars = [];
    for (let i = 0; i < 100; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.015 + 0.005,
        tail: Math.random() * 20 + 5
      });
    }
    starsRef.current = stars;
  }, []);

  useEffect(() => {
    if (isActive) sfx.resume();
  }, [isActive]);

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      particlesRef.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 1.0,
        color,
        size: Math.random() * 4 + 2
      });
    }
  };

  const createExhaust = (x: number, y: number, color: string) => {
     particlesRef.current.push({
        x: x + (Math.random() - 0.5) * 10, 
        y: y,
        vx: (Math.random() - 0.5) * 2,
        vy: 5 + Math.random() * 5, // Move down quickly
        life: 0.6,
        color,
        size: Math.random() * 3 + 2
     });
  };

  const spawnObject = () => {
    const isBad = Math.random() > 0.25; 
    let type: 'good' | 'bad' = isBad ? 'bad' : 'good';
    
    // Determine visual style
    let vType: 'enemy_ship' | 'asteroid' | 'energy_core' = 'energy_core';
    if (isBad) {
        vType = Math.random() > 0.7 ? 'asteroid' : 'enemy_ship';
    }

    const size = vType === 'asteroid' ? 0.08 : 0.06;

    objectsRef.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x: Math.random() * 0.9 + 0.05, 
      y: -0.1,
      type: type,
      visualType: vType,
      width: size,
      height: size,
      speed: 0.008 + (scoreRef.current * 0.0002), // Speed increases
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.1
    });
  };

  // --- DRAWING HELPERS ---
  
  const drawPlayerShip = (ctx: CanvasRenderingContext2D, x: number, y: number, bankAngle: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(bankAngle); // Tilt ship

      // Engine Glow
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#06b6d4';

      // Main Body
      ctx.beginPath();
      ctx.moveTo(0, -40); // Nose
      ctx.lineTo(25, 30); // Right Wing
      ctx.lineTo(10, 25); // Engine Notch R
      ctx.lineTo(0, 35);  // Tail
      ctx.lineTo(-10, 25); // Engine Notch L
      ctx.lineTo(-25, 30); // Left Wing
      ctx.closePath();
      
      const grad = ctx.createLinearGradient(0, -40, 0, 30);
      grad.addColorStop(0, '#cffafe');
      grad.addColorStop(0.5, '#22d3ee');
      grad.addColorStop(1, '#0891b2');
      ctx.fillStyle = grad;
      ctx.fill();

      // Cockpit
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.ellipse(0, -10, 5, 12, 0, 0, Math.PI * 2);
      ctx.fill();

      // Wing details
      ctx.strokeStyle = '#a5f3fc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -40);
      ctx.lineTo(25, 30);
      ctx.moveTo(0, -40);
      ctx.lineTo(-25, 30);
      ctx.stroke();

      ctx.restore();
  };

  const drawEnemyShip = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI); // Face down

      ctx.shadowBlur = 15;
      ctx.shadowColor = '#ef4444';

      ctx.beginPath();
      ctx.moveTo(0, -size/2 - 10);
      ctx.lineTo(size/2, size/2);
      ctx.lineTo(0, size/2 - 5);
      ctx.lineTo(-size/2, size/2);
      ctx.closePath();

      ctx.fillStyle = '#991b1b';
      ctx.fill();

      // Red cockpit
      ctx.fillStyle = '#fca5a5';
      ctx.beginPath();
      ctx.moveTo(0, -size/4);
      ctx.lineTo(5, 5);
      ctx.lineTo(-5, 5);
      ctx.fill();
      
      // Engine lights
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(-size/3, size/2, 3, 0, Math.PI*2);
      ctx.arc(size/3, size/2, 3, 0, Math.PI*2);
      ctx.fill();

      ctx.restore();
  };

  const drawAsteroid = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#475569';
      ctx.fillStyle = '#334155';
      
      ctx.beginPath();
      const radius = size / 2;
      for (let i = 0; i < 7; i++) {
          const angle = (i / 7) * Math.PI * 2;
          const r = radius * (0.8 + Math.random() * 0.4); // Irregular
          ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.fill();
      
      // Crater
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(radius*0.3, radius*0.3, radius*0.2, 0, Math.PI*2);
      ctx.fill();

      ctx.restore();
  };

  const updateGame = (timestamp: number) => {
    if (!canvasRef.current || !videoRef.current || !landmarker) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- 1. TRACKING & PHYSICS ---
    let startTimeMs = performance.now();
    if (videoRef.current.currentTime > 0) {
      const result: PoseLandmarkerResult = landmarker.detectForVideo(videoRef.current, startTimeMs);
      if (result.landmarks && result.landmarks.length > 0) {
        const nose = result.landmarks[0][0]; 
        targetPlayerXRef.current = 1 - nose.x; // Mirror
      }
    }

    // Smooth movement with inertia
    const dx = targetPlayerXRef.current - currentPlayerXRef.current;
    currentPlayerXRef.current += dx * 0.12;
    
    // Banking Physics: Tilt ship based on velocity (dx)
    // Positive dx (moving right) should result in Positive rotation (Clockwise / Banking Right)
    const targetBank = dx * 25; 
    playerBankAngleRef.current += (targetBank - playerBankAngleRef.current) * 0.1;

    // --- 2. RENDER BACKGROUND ---
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Warp Speed Stars
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    starsRef.current.forEach(star => {
      star.y += star.speed + (scoreRef.current * 0.00005);
      if (star.y > 1) {
        star.y = 0;
        star.x = Math.random();
      }
      
      const x = star.x * canvas.width;
      const y = star.y * canvas.height;
      const tailLen = star.tail * (1 + scoreRef.current * 0.01);

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - tailLen); // Trail
      ctx.strokeStyle = `rgba(200, 230, 255, ${0.3 * star.speed * 100})`;
      ctx.stroke();
    });

    // Speed Lines (Sides)
    const speedLineOpacity = Math.min(0.3, scoreRef.current * 0.001);
    ctx.fillStyle = `rgba(255, 255, 255, ${speedLineOpacity})`;
    for(let i=0; i<4; i++) {
        const x = i % 2 === 0 ? Math.random() * 50 : canvas.width - Math.random() * 50;
        const h = Math.random() * 200 + 100;
        const y = Math.random() * canvas.height;
        ctx.fillRect(x, y, 2, h);
    }

    // --- 3. RENDER PLAYER ---
    const playerXPx = currentPlayerXRef.current * canvas.width;
    const playerYPx = canvas.height - 120;
    
    // Engine Exhaust Particles
    createExhaust(playerXPx, playerYPx + 35, '#22d3ee');
    createExhaust(playerXPx - 15, playerYPx + 30, '#a5f3fc');
    createExhaust(playerXPx + 15, playerYPx + 30, '#a5f3fc');

    drawPlayerShip(ctx, playerXPx, playerYPx, playerBankAngleRef.current);

    // --- 4. GAME LOGIC ---
    const spawnRate = Math.max(300, 1000 - (scoreRef.current * 15)); 
    if (timestamp - lastSpawnTime.current > spawnRate) { 
      spawnObject();
      lastSpawnTime.current = timestamp;
    }

    // --- 5. RENDER PARTICLES ---
    particlesRef.current.forEach((p, idx) => {
        p.x += p.vx; p.y += p.vy;
        p.life -= 0.02;
        if (p.life > 0) {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
            ctx.fill();
        } else {
            particlesRef.current.splice(idx, 1);
        }
    });
    ctx.globalAlpha = 1;

    // --- 6. RENDER OBJECTS ---
    objectsRef.current.forEach((obj, index) => {
      obj.y += obj.speed;
      obj.rotation += obj.rotationSpeed;

      const objXPx = obj.x * canvas.width;
      const objYPx = obj.y * canvas.height;
      const objSizePx = obj.width * canvas.width;

      if (obj.visualType === 'enemy_ship') {
          drawEnemyShip(ctx, objXPx, objYPx, objSizePx);
          // Enemy engine trail
          if (Math.random() > 0.5) {
               particlesRef.current.push({
                   x: objXPx, y: objYPx - objSizePx/2,
                   vx: (Math.random()-0.5), vy: -5,
                   life: 0.5, color: '#f87171', size: 2
               });
          }
      } else if (obj.visualType === 'asteroid') {
          drawAsteroid(ctx, objXPx, objYPx, objSizePx, obj.rotation);
      } else {
          // Energy Core
          ctx.shadowBlur = 20;
          ctx.shadowColor = '#fbbf24';
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(objXPx, objYPx, objSizePx/2.5, 0, Math.PI*2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(objXPx, objYPx, objSizePx/5, 0, Math.PI*2);
          ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Collision
      const dx = playerXPx - objXPx;
      const dy = playerYPx - objYPx;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const hitRadius = objSizePx * 0.6; // Slightly forgiving hitbox

      if (dist < (30 + hitRadius)) {
         if (obj.type === 'bad') {
           sfx.playExplosion();
           createExplosion(playerXPx, playerYPx, '#ef4444');
           cancelAnimationFrame(requestRef.current!);
           onGameOver(scoreRef.current);
           return; 
         } else {
           sfx.playCollect();
           scoreRef.current += 10;
           setHudScore(scoreRef.current);
           createExplosion(objXPx, objYPx, '#facc15'); // Gold particles
           objectsRef.current.splice(index, 1);
         }
      }

      if (obj.y > 1.1) {
        if (obj.type === 'bad') {
          scoreRef.current += 1; 
          setHudScore(scoreRef.current);
        }
        objectsRef.current.splice(index, 1);
      }
    });

    if (isActive) {
      requestRef.current = requestAnimationFrame(updateGame);
    }
  };

  useEffect(() => {
    if (isActive) {
      scoreRef.current = 0;
      setHudScore(0);
      objectsRef.current = [];
      particlesRef.current = [];
      targetPlayerXRef.current = 0.5;
      currentPlayerXRef.current = 0.5;
      requestRef.current = requestAnimationFrame(updateGame);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isActive]);

  return (
    <>
      <canvas 
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="absolute top-0 left-0 w-full h-full object-cover z-20 pointer-events-none"
      />
      
      {/* HUD Overlay */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-4">
        <div className="bg-slate-900/80 border-2 border-cyan-500/50 rounded-2xl p-4 backdrop-blur-md shadow-[0_0_20px_rgba(6,182,212,0.3)]">
            <div className="text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">SCORE</div>
            <div className="text-4xl font-black text-white arcade-font">{hudScore}</div>
        </div>
      </div>

      <div className="absolute bottom-10 left-0 w-full text-center z-30 pointer-events-none">
        <div className="inline-block bg-black/60 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 text-white/80 font-bold animate-pulse">
           左右倾斜头部控制飞船闪避
        </div>
      </div>
    </>
  );
};