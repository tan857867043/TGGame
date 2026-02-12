import React, { useRef, useEffect, useState } from 'react';
import { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { sfx } from '../services/audioService';

interface CatchGameProps {
  landmarker: PoseLandmarker | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onGameOver: (score: number) => void;
  isActive: boolean;
}

// --- TYPES ---
type FruitType = 'APPLE' | 'ORANGE' | 'LEMON' | 'WATERMELON' | 'BOMB' | 'CHERRY' | 'STAR';

interface FruitObject {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  type: FruitType;
  size: number;
  color: string;
  hit: boolean;
  split?: boolean; // For fruit splitting
  splitParts?: { x: number; y: number; vx: number; vy: number }[];
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

interface BladePoint {
  x: number;
  y: number;
  time: number;
}

interface ScorePopup {
  x: number;
  y: number;
  score: number;
  time: number;
  color: string;
}

interface WaveInfo {
  current: number;
  next: number;
  showNotification: boolean;
  notificationTime: number;
}

// --- CONFIG ---
const GRAVITY = 0.0005;
const FRUIT_CONFIG: Record<FruitType, { color: string; size: number; score: number; special?: string }> = {
  APPLE: { color: '#ef4444', size: 80, score: 10 },
  ORANGE: { color: '#f97316', size: 85, score: 15 },
  LEMON: { color: '#eab308', size: 75, score: 20 },
  WATERMELON: { color: '#22c55e', size: 105, score: 25 },
  BOMB: { color: '#1e293b', size: 95, score: 0 },
  CHERRY: { color: '#db2777', size: 55, score: 30, special: 'heal' },
  STAR: { color: '#a855f7', size: 70, score: 50, special: 'multiply' }
};

// --- DIFFICULTY CONFIG ---
const DIFFICULTY_CONFIG = {
  EASY: { fruitSpeed: 1.0, bombChance: 0.15, minSpawnTime: 1000 },
  NORMAL: { fruitSpeed: 1.2, bombChance: 0.20, minSpawnTime: 800 },
  HARD: { fruitSpeed: 1.5, bombChance: 0.25, minSpawnTime: 600 },
  INSANE: { fruitSpeed: 2.0, bombChance: 0.30, minSpawnTime: 400 }
};

// --- SKILLS ---
const SKILLS = {
  SHIELD: { cost: 50, cooldown: 30000, active: false, time: 0 },
  TIME_FREEZE: { cost: 100, cooldown: 45000, active: false, time: 0 },
  BOMB_CLEAR: { cost: 150, cooldown: 60000, active: false, time: 0 }
};

export const CatchGame: React.FC<CatchGameProps> = ({ landmarker, videoRef, onGameOver, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  
  // Game Entities
  const fruitsRef = useRef<FruitObject[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const scorePopupsRef = useRef<ScorePopup[]>([]);
  
  // Blade Trails
  const leftBladeRef = useRef<BladePoint[]>([]);
  const rightBladeRef = useRef<BladePoint[]>([]);
  
  // Game State
  const lastSpawnTime = useRef(0);
  const difficultyRef = useRef<'EASY' | 'NORMAL' | 'HARD' | 'INSANE'>('EASY');
  const multiplierRef = useRef(1);
  const multiplierTimeRef = useRef(0);
  const waveInfoRef = useRef<WaveInfo>({ current: 1, next: 100, showNotification: false, notificationTime: 0 });
  const skillsRef = useRef({ ...SKILLS });
  const [hudScore, setHudScore] = useState(0);
  const [hudLives, setHudLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [hudMultiplier, setHudMultiplier] = useState(1);
  const [hudWave, setHudWave] = useState(1);
  const [waveNotification, setWaveNotification] = useState('');
  const comboTimerRef = useRef<number | null>(null);
  const waveNotificationTimerRef = useRef<number | null>(null);

  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
        setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isActive) sfx.resume();
  }, [isActive]);

  // --- HELPERS ---
  const createExplosion = (x: number, y: number, color: string, count: number = 15) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 8 + 2;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color,
        size: Math.random() * 5 + 3
      });
    }
  };

  const spawnFruit = () => {
    const currentDifficulty = DIFFICULTY_CONFIG[difficultyRef.current];
    const isBomb = Math.random() > (1 - currentDifficulty.bombChance);
    
    let type: FruitType;
    if (isBomb) {
      type = 'BOMB';
    } else {
      // Weighted spawn chance
      const rand = Math.random();
      if (rand < 0.05) {
        type = 'STAR'; // 5% chance
      } else if (rand < 0.15) {
        type = 'CHERRY'; // 10% chance
      } else {
        const types: FruitType[] = ['APPLE', 'ORANGE', 'LEMON', 'WATERMELON'];
        type = types[Math.floor(Math.random() * types.length)];
      }
    }
    
    const config = FRUIT_CONFIG[type];

    // Spawn from bottom with upward velocity
    const startX = 0.1 + Math.random() * 0.8; // 10% to 90% width
    const startY = 1.1; // Below screen

    // Aim towards center-ish
    const targetX = 0.5 + (Math.random() - 0.5) * 0.4;
    const speedMultiplier = currentDifficulty.fruitSpeed;
    const vx = (targetX - startX) * 0.015 * speedMultiplier;
    const vy = (-0.025 - Math.random() * 0.01) * speedMultiplier; // Upward force

    fruitsRef.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x: startX,
      y: startY,
      vx,
      vy,
      rot: 0,
      vRot: (Math.random() - 0.5) * 0.2 * speedMultiplier,
      type,
      size: config.size,
      color: config.color,
      hit: false
    });
  };

  const drawFruit = (ctx: CanvasRenderingContext2D, fruit: FruitObject, pxX: number, pxY: number) => {
     ctx.save();
     ctx.translate(pxX, pxY);
     ctx.rotate(fruit.rot);
     
     const r = fruit.size / 2;

     if (fruit.type === 'BOMB') {
         // Bomb Body
         ctx.beginPath();
         ctx.arc(0, 0, r, 0, Math.PI * 2);
         ctx.fillStyle = '#1e293b';
         ctx.fill();
         
         // Red Glow
         ctx.shadowBlur = 20;
         ctx.shadowColor = '#ef4444';
         ctx.strokeStyle = '#ef4444';
         ctx.lineWidth = 3;
         ctx.stroke();
         
         // Icon
         ctx.fillStyle = '#ef4444';
         ctx.font = '30px Arial';
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         ctx.fillText('☠️', 0, 2);
         ctx.shadowBlur = 0;
         
         // Spark
         const fuseX = r * 0.7;
         const fuseY = -r * 0.7;
         ctx.beginPath();
         ctx.moveTo(0, -r);
         ctx.quadraticCurveTo(0, -r-10, fuseX, fuseY);
         ctx.strokeStyle = '#94a3b8';
         ctx.lineWidth = 4;
         ctx.stroke();
         
         if (Math.random() > 0.5) {
             ctx.fillStyle = '#fbbf24';
             ctx.beginPath();
             ctx.arc(fuseX, fuseY, 6, 0, Math.PI*2);
             ctx.fill();
         }

     } else if (fruit.type === 'STAR') {
         // Star Fruit
         ctx.shadowBlur = 25;
         ctx.shadowColor = fruit.color;
         ctx.fillStyle = fruit.color;
         ctx.font = '40px Arial';
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         ctx.fillText('⭐', 0, 0);
         ctx.shadowBlur = 0;
         
         // Rotating glow
         ctx.strokeStyle = fruit.color;
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
         ctx.stroke();

     } else if (fruit.type === 'CHERRY') {
         // Cherry
         ctx.fillStyle = fruit.color;
         
         // Two cherry halves
         ctx.beginPath();
         ctx.arc(-r*0.3, 0, r*0.6, 0, Math.PI * 2);
         ctx.fill();
         ctx.beginPath();
         ctx.arc(r*0.3, 0, r*0.6, 0, Math.PI * 2);
         ctx.fill();
         
         // Stem
         ctx.strokeStyle = '#22c55e';
         ctx.lineWidth = r*0.2;
         ctx.beginPath();
         ctx.moveTo(0, -r*0.8);
         ctx.lineTo(0, -r*0.3);
         ctx.stroke();

     } else {
         // Regular Fruit
         ctx.beginPath();
         ctx.arc(0, 0, r, 0, Math.PI * 2);
         ctx.fillStyle = fruit.color;
         ctx.fill();
         
         // Inner Detail (Highlight)
         ctx.beginPath();
         ctx.arc(-r*0.3, -r*0.3, r*0.2, 0, Math.PI * 2);
         ctx.fillStyle = 'rgba(255,255,255,0.3)';
         ctx.fill();

         // Outline
         ctx.strokeStyle = 'rgba(0,0,0,0.1)';
         ctx.lineWidth = 2;
         ctx.stroke();
     }
     
     ctx.restore();
  };

  const drawBlade = (ctx: CanvasRenderingContext2D, path: BladePoint[], color: string) => {
      if (path.length < 2) return;
      
      // 1. Draw smooth bezier curve for blade trail
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      
      // Use quadratic curves for smoothness
      for (let i = 1; i < path.length - 1; i++) {
          const next = path[i + 1];
          const midX = (path[i].x + next.x) / 2;
          const midY = (path[i].y + next.y) / 2;
          ctx.quadraticCurveTo(path[i].x, path[i].y, midX, midY);
      }
      
      // Line to last point
      const last = path[path.length - 1];
      const secondLast = path[path.length - 2];
      ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
      
      // 2. Outer glow effect
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 30;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 12;
      ctx.stroke();
      
      // 3. Middle gradient
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.stroke();
      
      // 4. Inner core
      ctx.shadowBlur = 5;
      ctx.shadowColor = '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 5. Reset shadow
      ctx.shadowBlur = 0;
      
      // 6. Add sparkles along the blade path
      for (let i = 0; i < path.length; i += 3) {
          const point = path[i];
          const size = Math.random() * 3 + 2;
          ctx.beginPath();
          ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, ' + (Math.random() * 0.8 + 0.2) + ')';
          ctx.fill();
      }
  };

  const updateGame = (timestamp: number) => {
    if (!canvasRef.current || !videoRef.current || !landmarker) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- 1. DETECTION ---
    let startTimeMs = performance.now();
    let leftHandPos: {x:number, y:number} | null = null;
    let rightHandPos: {x:number, y:number} | null = null;

    if (videoRef.current.currentTime > 0) {
      const result: PoseLandmarkerResult = landmarker.detectForVideo(videoRef.current, startTimeMs);
      if (result.landmarks && result.landmarks.length > 0) {
        // 19 = Left Index, 20 = Right Index
        const lm = result.landmarks[0];
        if (lm[19] && lm[19].visibility > 0.5) {
            leftHandPos = { x: (1 - lm[19].x) * canvas.width, y: lm[19].y * canvas.height };
        }
        if (lm[20] && lm[20].visibility > 0.5) {
            rightHandPos = { x: (1 - lm[20].x) * canvas.width, y: lm[20].y * canvas.height };
        }
      }
    }

    // --- 2. BLADE TRAILS UPDATE ---
    const updateBlade = (ref: React.MutableRefObject<BladePoint[]>, pos: {x:number, y:number} | null) => {
        const now = performance.now();
        if (pos) {
            ref.current.push({ x: pos.x, y: pos.y, time: now });
        }
        // Remove old points (0.2s trail)
        ref.current = ref.current.filter(p => now - p.time < 200);
    };
    updateBlade(leftBladeRef, leftHandPos);
    updateBlade(rightBladeRef, rightHandPos);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- 3. PHYSICS & LOGIC ---
    
    // Update Difficulty based on score
    if (scoreRef.current >= 500 && difficultyRef.current === 'EASY') {
        difficultyRef.current = 'NORMAL';
    } else if (scoreRef.current >= 1500 && difficultyRef.current === 'NORMAL') {
        difficultyRef.current = 'HARD';
    } else if (scoreRef.current >= 3000 && difficultyRef.current === 'HARD') {
        difficultyRef.current = 'INSANE';
    }
    
    // Update Wave System
    if (scoreRef.current >= waveInfoRef.current.next) {
        waveInfoRef.current.current++;
        waveInfoRef.current.next = waveInfoRef.current.current * 100;
        waveInfoRef.current.showNotification = true;
        waveInfoRef.current.notificationTime = timestamp;
        setHudWave(waveInfoRef.current.current);
        setWaveNotification(`第 ${waveInfoRef.current.current} 波`);
        
        if (waveNotificationTimerRef.current) {
            clearTimeout(waveNotificationTimerRef.current);
        }
        waveNotificationTimerRef.current = window.setTimeout(() => {
            setWaveNotification('');
        }, 2000);
        
        // Wave effects
        if (waveInfoRef.current.current % 5 === 0) {
            // Fruit Rain
            for (let i = 0; i < 5; i++) {
                setTimeout(() => spawnFruit(), i * 100);
            }
        }
    }
    
    // Update Multiplier
    if (multiplierRef.current > 1) {
        if (timestamp - multiplierTimeRef.current > 5000) {
            multiplierRef.current = 1;
            setHudMultiplier(1);
        }
    }
    
    // Update Skills
    Object.keys(skillsRef.current).forEach(skillKey => {
        const skill = skillsRef.current[skillKey as keyof typeof skillsRef.current];
        if (skill.active && timestamp - skill.time > 5000) {
            skill.active = false;
        }
        if (!skill.active && scoreRef.current >= skill.cost && timestamp - skill.time > skill.cooldown) {
            // Auto activate skill
            skill.active = true;
            skill.time = timestamp;
            
            if (skillKey === 'SHIELD') {
                // Shield activated
                sfx.playExplosion();
            } else if (skillKey === 'TIME_FREEZE') {
                // Freeze fruits
                fruitsRef.current.forEach(fruit => {
                    fruit.vx *= 0.1;
                    fruit.vy *= 0.1;
                });
            } else if (skillKey === 'BOMB_CLEAR') {
                // Clear bombs
                fruitsRef.current = fruitsRef.current.filter(fruit => fruit.type !== 'BOMB');
            }
        }
    });
    
    // Spawn
    const currentDifficulty = DIFFICULTY_CONFIG[difficultyRef.current];
    const spawnInterval = Math.max(currentDifficulty.minSpawnTime, 2000 - scoreRef.current * 2);
    if (timestamp - lastSpawnTime.current > spawnInterval) {
        spawnFruit();
        lastSpawnTime.current = timestamp;
    }

    // Update Fruits
    fruitsRef.current.forEach((fruit, idx) => {
        // Physics
        fruit.x += fruit.vx;
        fruit.y += fruit.vy;
        fruit.vy += GRAVITY; // Gravity
        fruit.rot += fruit.vRot;

        const pxX = fruit.x * canvas.width;
        const pxY = fruit.y * canvas.height;

        // Draw
        if (!fruit.hit) {
            drawFruit(ctx, fruit, pxX, pxY);
            
            // Check Collision with Blades
            const checkCut = (blade: BladePoint[]) => {
                if (blade.length < 2) return false;
                const tip = blade[blade.length - 1];
                const prev = blade[blade.length - 2];
                
                // Speed check: distance between last two frames
                const speed = Math.sqrt((tip.x - prev.x)**2 + (tip.y - prev.y)**2);
                if (speed < 15) return false; // Too slow, not a slice

                // Distance check
                const dx = pxX - tip.x;
                const dy = pxY - tip.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                return dist < (fruit.size * 0.8 + 20);
            };

            if (checkCut(leftBladeRef.current) || checkCut(rightBladeRef.current)) {
                fruit.hit = true;
                
                if (fruit.type === 'BOMB') {
                    const shieldActive = skillsRef.current.SHIELD.active;
                    if (shieldActive) {
                        // Shield blocks bomb damage
                        skillsRef.current.SHIELD.active = false;
                        sfx.playExplosion();
                        createExplosion(pxX, pxY, '#3b82f6', 20); // Blue shield explosion
                    } else {
                        sfx.playExplosion();
                        createExplosion(pxX, pxY, '#000000', 30);
                        createExplosion(pxX, pxY, '#ef4444', 20);
                        livesRef.current--;
                        setHudLives(livesRef.current);
                        setCombo(0);
                        if (livesRef.current <= 0) {
                            onGameOver(scoreRef.current);
                            cancelAnimationFrame(requestRef.current!);
                            return;
                        }
                    }
                } else {
                    const cfg = FRUIT_CONFIG[fruit.type];
                    sfx.playSlice();
                    createExplosion(pxX, pxY, cfg.color, 10);
                    createExplosion(pxX, pxY, '#ffffff', 5); // Juice
                    
                    // Fruit splitting effect
                    fruit.split = true;
                    fruit.splitParts = [
                        { x: pxX, y: pxY, vx: -2, vy: -3 },
                        { x: pxX, y: pxY, vx: 2, vy: -3 }
                    ];
                    
                    // Calculate points with multiplier
                    let basePoints = cfg.score;
                    if (combo >= 5 && combo < 10) {
                        basePoints = Math.floor(basePoints * 1.5);
                    } else if (combo >= 10 && combo < 20) {
                        basePoints = Math.floor(basePoints * 2);
                    } else if (combo >= 20) {
                        basePoints = Math.floor(basePoints * 3);
                    }
                    
                    const finalPoints = basePoints * multiplierRef.current;
                    scoreRef.current += finalPoints;
                    setHudScore(scoreRef.current);
                    
                    // Add score popup
                    scorePopupsRef.current.push({
                        x: pxX,
                        y: pxY,
                        score: finalPoints,
                        time: timestamp,
                        color: cfg.color
                    });
                    
                    // Special fruit effects
                    if (fruit.type === 'CHERRY') {
                        // Heal 1 life
                        if (livesRef.current < 3) {
                            livesRef.current++;
                            setHudLives(livesRef.current);
                            createExplosion(pxX, pxY, '#4ade80', 15); // Green healing effect
                        }
                    } else if (fruit.type === 'STAR') {
                        // Activate multiplier
                        multiplierRef.current = 2;
                        multiplierTimeRef.current = timestamp;
                        setHudMultiplier(2);
                        createExplosion(pxX, pxY, '#a855f7', 20); // Purple star effect
                    }
                    
                    // Combo Logic
                    setCombo(c => c + 1);
                    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
                    comboTimerRef.current = window.setTimeout(() => setCombo(0), 1500);
                }
            }
        }
    });

    // Remove off-screen or hit fruits
    fruitsRef.current = fruitsRef.current.filter(f => {
        if (f.hit) return false;
        if (f.y > 1.2 && f.vy > 0) {
            // Missed a non-bomb fruit
            if (f.type !== 'BOMB') {
                setCombo(0);
                // Optional: Penalize missing? For now, no life loss on miss, only on bomb
            }
            return false;
        }
        return true;
    });

    // --- 4. RENDER PARTICLES & TRAILS ---
    particlesRef.current.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.5; // Gravity
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

    // Render score popups
    scorePopupsRef.current.forEach((popup, idx) => {
        const age = timestamp - popup.time;
        if (age > 1000) {
            scorePopupsRef.current.splice(idx, 1);
        } else {
            ctx.globalAlpha = 1 - (age / 1000);
            ctx.fillStyle = popup.color;
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const yOffset = -age * 0.2;
            ctx.fillText(`+${popup.score}`, popup.x, popup.y + yOffset);
        }
    });
    ctx.globalAlpha = 1;

    // Render fruit splitting
    fruitsRef.current.forEach(fruit => {
        if (fruit.split && fruit.splitParts) {
            fruit.splitParts.forEach(part => {
                part.x += part.vx;
                part.y += part.vy;
                part.vy += 0.3; // Gravity
                
                ctx.save();
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = fruit.color;
                ctx.beginPath();
                ctx.arc(part.x, part.y, fruit.size * 0.3, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
        }
    });

    drawBlade(ctx, leftBladeRef.current, '#a855f7'); // Purple
    drawBlade(ctx, rightBladeRef.current, '#22d3ee'); // Cyan

    if (isActive) {
      requestRef.current = requestAnimationFrame(updateGame);
    }
  };

  useEffect(() => {
    if (isActive) {
      scoreRef.current = 0;
      livesRef.current = 3;
      setHudScore(0);
      setHudLives(3);
      setCombo(0);
      fruitsRef.current = [];
      particlesRef.current = [];
      requestRef.current = requestAnimationFrame(updateGame);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
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
      
      {/* HUD */}
      <div className="absolute top-4 left-4 z-30 flex items-start gap-4 pointer-events-none">
        <div className="bg-slate-900/80 border-2 border-green-500/50 rounded-2xl p-4 backdrop-blur-md">
            <div className="text-green-400 text-xs font-bold uppercase tracking-wider mb-1">SCORE</div>
            <div className="text-4xl font-black text-white arcade-font">{hudScore}</div>
        </div>
        
        <div className="bg-slate-900/80 border-2 border-red-500/50 rounded-2xl p-4 backdrop-blur-md">
           <div className="text-red-400 text-xs font-bold uppercase tracking-wider mb-1">LIVES</div>
           <div className="flex gap-2 text-2xl">
              {Array(3).fill(0).map((_, i) => (
                  <span key={i} className={i < hudLives ? 'opacity-100' : 'opacity-20 grayscale'}>❤️</span>
              ))}
           </div>
        </div>
        
        <div className="bg-slate-900/80 border-2 border-yellow-500/50 rounded-2xl p-4 backdrop-blur-md">
           <div className="text-yellow-400 text-xs font-bold uppercase tracking-wider mb-1">WAVE</div>
           <div className="text-2xl font-black text-white arcade-font">{hudWave}</div>
        </div>
        
        {hudMultiplier > 1 && (
          <div className="bg-slate-900/80 border-2 border-purple-500/50 rounded-2xl p-4 backdrop-blur-md">
             <div className="text-purple-400 text-xs font-bold uppercase tracking-wider mb-1">MULTI</div>
             <div className="text-2xl font-black text-purple-400 arcade-font">{hudMultiplier}x</div>
          </div>
        )}
      </div>
      
      {/* Wave Notification */}
      {waveNotification && (
        <div className="absolute top-1/4 left-0 w-full text-center z-40 pointer-events-none">
          <div className="inline-block bg-black/80 backdrop-blur-md px-8 py-4 rounded-full border-2 border-cyan-500/50 text-cyan-400 font-bold text-4xl arcade-font animate-bounce">
            {waveNotification}
          </div>
        </div>
      )}

      {combo > 1 && (
         <div className="absolute top-20 left-4 z-30 pointer-events-none">
             <div className="text-5xl font-black italic text-yellow-400 arcade-font drop-shadow-[0_4px_0_rgba(0,0,0,0.5)] animate-bounce">
                 {combo} COMBO!
             </div>
         </div>
      )}

      <div className="absolute bottom-10 left-0 w-full text-center z-30 pointer-events-none">
        <div className="inline-block bg-black/60 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 text-white/80 font-bold animate-pulse">
           像忍者一样快速挥手切开水果！不要切炸弹！
        </div>
      </div>
    </>
  );
};