import React, { useRef, useEffect, useState } from 'react';
import { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { sfx } from '../services/audioService';

interface SaberGameProps {
  landmarker: PoseLandmarker | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onGameOver: (score: number, grade?: string) => void;
  isActive: boolean;
}

// --- TYPES ---
type BlockDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'DOT';

interface SaberBlock {
  id: string;
  gridX: number; // 0-3
  gridY: number; // 0-2
  z: number; // Depth
  color: 'red' | 'blue'; 
  type: 'normal' | 'bomb';
  direction: BlockDirection;
  hit: boolean;
  cutAngle?: number; 
  remove?: boolean; // For cleanup
}

interface Obstacle {
    id: string;
    type: 'WALL_TOP' | 'WALL_LEFT' | 'WALL_RIGHT';
    z: number;
    duration: number;
    hit: boolean;
    remove?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  size: number;
}

interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  vRot: number;
  color: string;
  type: 'left_half' | 'right_half';
  life: number;
}

interface SaberState {
  x: number;
  y: number;
  history: {x: number, y: number}[];
  velocityVector: {x: number, y: number};
  velocityMagnitude: number;
}

interface Track {
  id: string;
  name: string;
  bpm: number;
  type: 'GENERATED' | 'UPLOAD';
  difficulty: '简单' | '普通' | '困难';
}

// --- CONFIG & PHYSICS ---
// Perspective Settings
const FOCAL_LENGTH = 350; // Balanced for wide spacing
const BLOCK_SIZE = 200; // Increased block size
const GAME_SPEED = 22.0; 
const SPAWN_Z = 3500; // Start further back
const HIT_WINDOW_Z_NEAR = -150;
const HIT_WINDOW_Z_FAR = 350; 

// Grid Spacing (Significantly Increased)
const GRID_X_SPACING = 1000; // Increased left/right distance
const GRID_Y_SPACING = 240; // Taller vertical spread

// Track List
const TRACK_LIST: Track[] = [
  { id: 'track_1', name: 'Neon Pulse (教程)', bpm: 105, type: 'GENERATED', difficulty: '简单' },
  { id: 'track_2', name: 'Cyber Storm', bpm: 130, type: 'GENERATED', difficulty: '普通' },
  { id: 'track_3', name: 'Void Walker', bpm: 150, type: 'GENERATED', difficulty: '困难' },
  { id: 'upload', name: '导入本地 MP3...', bpm: 120, type: 'UPLOAD', difficulty: '普通' }
];

export const SaberGame: React.FC<SaberGameProps> = ({ landmarker, videoRef, onGameOver, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Game State
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const energyRef = useRef(50);
  const hitNotesRef = useRef(0);
  const totalNotesRef = useRef(0);
  
  // Entities
  const blocksRef = useRef<SaberBlock[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const debrisRef = useRef<Debris[]>([]);
  
  // Tracking
  const leftHandRef = useRef<SaberState>({ x: 0, y: 0, history: [], velocityVector: {x:0, y:0}, velocityMagnitude: 0 });
  const rightHandRef = useRef<SaberState>({ x: 0, y: 0, history: [], velocityVector: {x:0, y:0}, velocityMagnitude: 0 });
  const headRef = useRef({ x: 0.5, y: 0.5 });
  const bodyRef = useRef({ x: 0.5 });

  // Audio & Logic
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextNoteTimeRef = useRef(0.0);
  const current16thNoteRef = useRef(0); 
  const timerIDRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const userSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const userAudioBufferRef = useRef<AudioBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const lastSpawnTimeRef = useRef(0);
  const bassHistoryRef = useRef<number[]>([]);
  
  // Menu State (Internal)
  const isPlayingRef = useRef(false);
  const hoverStartTimeRef = useRef<number>(0);
  const hoveredTrackIdRef = useRef<string | null>(null);
  
  // React State for HUD
  const [hudScore, setHudScore] = useState(0);
  const [hudCombo, setHudCombo] = useState(0);
  const [hudEnergy, setHudEnergy] = useState(50);
  const [warning, setWarning] = useState<string | null>(null);
  const [currentTrackName, setCurrentTrackName] = useState("");

  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- AUDIO ENGINE (SYNTHESIZER) ---
  const initAudioContext = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;
      return ctx;
    } catch (e) {
      console.error("AudioContext not supported");
      return null;
    }
  };

  const synthKick = (ctx: AudioContext, time: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
    
    gain.gain.setValueAtTime(0.8, time); // Loud kick
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
    
    osc.start(time);
    osc.stop(time + 0.5);
  };

  const synthSnare = (ctx: AudioContext, time: number) => {
    const bufferSize = ctx.sampleRate * 0.2; 
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 800;
    
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(250, time);
    oscGain.gain.setValueAtTime(0.2, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    
    noise.start(time);
    osc.start(time);
    osc.stop(time + 0.2);
  };

  const synthHiHat = (ctx: AudioContext, time: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.value = 8000;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    gain.gain.setValueAtTime(0.08, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    osc.start(time);
    osc.stop(time + 0.05);
  };

  const synthBass = (ctx: AudioContext, time: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, time);
      filter.frequency.exponentialRampToValueAtTime(200, time + 0.3);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      gain.gain.setValueAtTime(0.2, time);
      gain.gain.linearRampToValueAtTime(0, time + 0.4);
      
      osc.start(time);
      osc.stop(time + 0.4);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ctx = initAudioContext();
    if (!ctx) return;
    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        userAudioBufferRef.current = audioBuffer;
        startLevel(120, file.name.substring(0, 15)); 
    } catch (e) {
        console.error(e);
        alert("无法读取音频文件");
    }
  };

  const startLevel = (bpm: number, trackName: string) => {
    setCurrentTrackName(trackName);
    const ctx = initAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256; 
    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    masterGain.connect(analyser);

    scoreRef.current = 0;
    comboRef.current = 0;
    energyRef.current = 50;
    blocksRef.current = [];
    obstaclesRef.current = [];
    hitNotesRef.current = 0;
    totalNotesRef.current = 0;
    setHudScore(0);
    setHudCombo(0);
    setHudEnergy(50);
    
    if (timerIDRef.current) clearInterval(timerIDRef.current);
    if (userSourceRef.current) { try { userSourceRef.current.stop(); } catch(e){} }

    if (userAudioBufferRef.current) {
        const source = ctx.createBufferSource();
        source.buffer = userAudioBufferRef.current;
        source.connect(masterGain);
        source.start(0);
        userSourceRef.current = source;
        source.onended = () => finishGame();
    } else {
        nextNoteTimeRef.current = ctx.currentTime + 0.5;
        current16thNoteRef.current = 0;
        timerIDRef.current = window.setInterval(() => scheduler(ctx, bpm), 25);
    }

    isPlayingRef.current = true;
  };

  const finishGame = () => {
      let grade = 'D';
      if (totalNotesRef.current > 0) {
          const accuracy = hitNotesRef.current / totalNotesRef.current;
          if (accuracy >= 0.90) grade = 'SSS';
          else if (accuracy >= 0.85) grade = 'SS';
          else if (accuracy >= 0.75) grade = 'S';
          else if (accuracy >= 0.60) grade = 'A';
          else if (accuracy >= 0.45) grade = 'B';
          else grade = 'C';
      }
      isPlayingRef.current = false;
      userAudioBufferRef.current = null;
      onGameOver(scoreRef.current, grade);
  };

  const spawnBlock = (gridX: number, gridY: number, color: 'red' | 'blue', type: 'normal' | 'bomb' = 'normal') => {
    const dirs: BlockDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'DOT']; 
    blocksRef.current.push({
        id: Math.random().toString(36).substr(2, 9),
        gridX, gridY,
        z: SPAWN_Z,
        color,
        type,
        direction: type === 'bomb' ? 'DOT' : dirs[Math.floor(Math.random() * dirs.length)],
        hit: false
    });
    if (type === 'normal') totalNotesRef.current++;
  };

  const spawnWall = (type: 'WALL_TOP' | 'WALL_LEFT' | 'WALL_RIGHT') => {
      obstaclesRef.current.push({
          id: Math.random().toString(36).substr(2, 9),
          type,
          z: SPAWN_Z,
          duration: 400,
          hit: false
      });
  };

  const scheduler = (ctx: AudioContext, bpm: number) => {
    const secondsPerBeat = 60.0 / bpm;
    const scheduleAhead = 0.1;

    while (nextNoteTimeRef.current < ctx.currentTime + scheduleAhead) {
        const beat = current16thNoteRef.current;
        const time = nextNoteTimeRef.current;
        
        synthHiHat(ctx, time);

        if (beat === 0 || beat === 8) synthKick(ctx, time);
        if (beat === 4 || beat === 12) synthSnare(ctx, time);
        if (beat === 0 || beat === 3 || beat === 8 || beat === 10) {
            const freq = beat < 8 ? 55 : 65; 
            synthBass(ctx, time, freq);
        }

        if (beat === 0) spawnBlock(2, 0, 'blue', 'normal');
        if (beat === 8) spawnBlock(2, 1, 'blue', 'normal'); 
        if (beat === 4) spawnBlock(1, 0, 'red', 'normal');
        if (beat === 12) spawnBlock(1, 1, 'red', 'normal');

        if (beat === 14 && Math.random() > 0.5) spawnBlock(2, 2, 'blue', 'normal');
        if (beat === 2 && Math.random() > 0.6) spawnBlock(1, 2, 'red', 'normal');

        if (Math.random() < 0.02 && beat === 0) {
             spawnWall(Math.random() > 0.5 ? 'WALL_LEFT' : 'WALL_RIGHT');
        }

        nextNoteTimeRef.current += 0.25 * secondsPerBeat;
        current16thNoteRef.current = (current16thNoteRef.current + 1) % 16;
    }
  };

  const analyzeAndSpawn = (timestamp: number) => {
    if (!analyserRef.current || !dataArrayRef.current) return;
    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    
    let bass = 0;
    for(let i=0; i<10; i++) bass += dataArrayRef.current[i];
    bass /= 10;
    
    bassHistoryRef.current.push(bass);
    if(bassHistoryRef.current.length > 30) bassHistoryRef.current.shift();
    const avg = bassHistoryRef.current.reduce((a,b)=>a+b,0) / bassHistoryRef.current.length;

    if (performance.now() - lastSpawnTimeRef.current > 600) {
        if (bass > avg * 1.3 && bass > 120) {
            spawnBlock(2, 0, 'blue');
            if (Math.random() > 0.6) spawnBlock(1, 0, 'red');
            lastSpawnTimeRef.current = performance.now();
        }
    }
  };

  const project = (x: number, y: number, z: number, cx: number, cy: number) => {
    const scale = FOCAL_LENGTH / (FOCAL_LENGTH + z);
    return {
        x: cx + x * scale,
        y: cy + y * scale,
        scale: scale
    };
  };

  const createExplosion = (x: number, y: number, color: string) => {
      for(let i=0; i<12; i++) {
          particlesRef.current.push({
              x, y,
              vx: (Math.random()-0.5)*25,
              vy: (Math.random()-0.5)*25,
              color,
              life: 1.0,
              size: Math.random() * 10 + 5
          });
      }
  };

  const createDebris = (block: SaberBlock, cx: number, cy: number) => {
      const xOffset = (block.gridX - 1.5) * GRID_X_SPACING; 
      const yOffset = (1 - block.gridY) * GRID_Y_SPACING;
      
      const c = block.color === 'red' ? '#ff0033' : '#00ccff';
      const angle = block.cutAngle || 0;
      
      const v = 20;
      const dx = Math.cos(angle) * v;
      const dy = Math.sin(angle) * v;

      const baseProp = {
          x: xOffset, y: yOffset, z: block.z,
          rot: angle,
          color: c,
          life: 1.0
      };

      debrisRef.current.push({ ...baseProp, vx: dx, vy: dy, vz: -15, vRot: 0.2, type: 'right_half' });
      debrisRef.current.push({ ...baseProp, vx: -dx, vy: -dy, vz: -15, vRot: -0.2, type: 'left_half' });
  };

  const updateGame = (timestamp: number) => {
    if (!canvasRef.current || !videoRef.current || !landmarker) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (videoRef.current.currentTime > 0) {
      const result: PoseLandmarkerResult = landmarker.detectForVideo(videoRef.current, performance.now());
      if (result.landmarks && result.landmarks.length > 0) {
          const lm = result.landmarks[0];
          const updateHand = (ref: React.MutableRefObject<SaberState>, idx: number) => {
              if (lm[idx] && lm[idx].visibility > 0.5) {
                  const x = (1 - lm[idx].x) * canvas.width;
                  const y = lm[idx].y * canvas.height;
                  ref.current.velocityVector = { x: x - ref.current.x, y: y - ref.current.y };
                  ref.current.velocityMagnitude = Math.sqrt(ref.current.velocityVector.x**2 + ref.current.velocityVector.y**2);
                  ref.current.x = x; ref.current.y = y;
                  ref.current.history.push({x, y});
                  if(ref.current.history.length > 6) ref.current.history.shift();
              }
          };
          updateHand(leftHandRef, 19);
          updateHand(rightHandRef, 20);
          if (lm[0]) headRef.current = { x: 1-lm[0].x, y: lm[0].y };
          if (lm[11] && lm[12]) bodyRef.current = { x: 1 - (lm[11].x + lm[12].x)/2 };
      }
    }

    ctx.clearRect(0,0, canvas.width, canvas.height);

    if (isPlayingRef.current) {
        updateLevel(ctx, canvas, timestamp);
    } else {
        updateMenu(ctx, canvas, timestamp);
    }

    if (isActive) requestRef.current = requestAnimationFrame(updateGame);
  };

  const updateMenu = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, timestamp: number) => {
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      ctx.save();
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 20;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = '900 50px "Orbitron"';
      ctx.fillText("🎵 选择曲目", cx, 120);
      ctx.shadowBlur = 0;
      ctx.font = 'bold 20px "Inter"';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText("移动双手 · 悬停确认", cx, 160);
      ctx.restore();

      const cardW = 600;
      const cardH = 90;
      const startY = 220;
      const gap = 25;

      let hoveredItem: string | null = null;

      TRACK_LIST.forEach((track, idx) => {
          const y = startY + idx * (cardH + gap);
          const x = cx - cardW / 2;
          
          const checkHover = (hand: SaberState) => hand.x > x && hand.x < x + cardW && hand.y > y && hand.y < y + cardH;
          const isHovered = checkHover(leftHandRef.current) || checkHover(rightHandRef.current);
          
          if (isHovered) hoveredItem = track.id;

          ctx.beginPath();
          ctx.roundRect(x, y, cardW, cardH, 15);
          ctx.fillStyle = isHovered ? 'rgba(34, 211, 238, 0.2)' : 'rgba(15, 23, 42, 0.8)';
          ctx.fill();
          ctx.lineWidth = isHovered ? 3 : 1;
          ctx.strokeStyle = isHovered ? '#22d3ee' : '#334155';
          ctx.stroke();

          ctx.textAlign = 'left';
          ctx.font = 'bold 26px "Orbitron"';
          ctx.fillStyle = isHovered ? '#fff' : '#cbd5e1';
          ctx.fillText(track.name, x + 30, y + 45);
          
          ctx.textAlign = 'right';
          ctx.font = '16px "Inter"';
          ctx.fillStyle = '#94a3b8';
          const info = track.type === 'UPLOAD' ? 'MP3' : `${track.bpm} BPM`;
          ctx.fillText(info, x + cardW - 30, y + 35);
          
          ctx.fillStyle = track.difficulty === '困难' ? '#f87171' : (track.difficulty === '普通' ? '#fbbf24' : '#4ade80');
          ctx.font = 'bold 16px "Inter"';
          ctx.fillText(track.difficulty, x + cardW - 30, y + 65);

          if (isHovered && hoveredTrackIdRef.current === track.id) {
               const elapsed = timestamp - hoverStartTimeRef.current;
               const duration = 1500;
               const progress = Math.min(elapsed / duration, 1.0);
               
               ctx.fillStyle = 'rgba(34, 211, 238, 0.3)';
               ctx.fillRect(x, y, cardW * progress, cardH);
               
               ctx.fillStyle = '#22d3ee';
               ctx.fillRect(x, y + cardH - 4, cardW * progress, 4);

               if (progress >= 1.0) {
                   const aCtx = initAudioContext();
                   if (aCtx && aCtx.state === 'suspended') aCtx.resume();

                   if (elapsed > 1600) return;

                   if (track.type === 'UPLOAD') {
                       fileInputRef.current?.click();
                       hoverStartTimeRef.current = timestamp - 20000; // Reset
                   } else {
                       startLevel(track.bpm, track.name);
                   }
               }
          }
      });

      if (hoveredItem) {
          if (hoveredTrackIdRef.current !== hoveredItem) {
              hoveredTrackIdRef.current = hoveredItem;
              hoverStartTimeRef.current = timestamp;
              sfx.playCharge(0.1); 
          }
      } else {
          hoveredTrackIdRef.current = null;
          hoverStartTimeRef.current = 0;
      }

      const drawCursor = (hand: SaberState, color: string) => {
          if (hand.history.length > 0) {
              ctx.shadowBlur = 10;
              ctx.shadowColor = color;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(hand.x, hand.y, 10, 0, Math.PI*2);
              ctx.fill();
          }
      };
      drawCursor(leftHandRef.current, '#f87171');
      drawCursor(rightHandRef.current, '#60a5fa');
  };

  const updateLevel = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, timestamp: number) => {
    if (userAudioBufferRef.current) analyzeAndSpawn(timestamp);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    // --- 1. EXTREME PERSPECTIVE GRID (Background) ---
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Vertical lines fan out
    for (let i = -6; i <= 6; i++) {
        const x = i * GRID_X_SPACING; 
        const p1 = project(x, 400, 0, cx, cy);
        const p2 = project(x, 400, SPAWN_Z, cx, cy);
        
        ctx.strokeStyle = Math.abs(i) < 2 ? 'rgba(56, 189, 248, 0.4)' : 'rgba(56, 189, 248, 0.1)';
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
    }
    // Horizontal moving lines
    const flow = (timestamp * 0.8) % 400; // Faster flow
    for (let i = 0; i < 15; i++) {
        const z = SPAWN_Z - ((i * 400 + flow) % SPAWN_Z);
        const p1 = project(-2000, 400, z, cx, cy);
        const p2 = project(2000, 400, z, cx, cy);
        const alpha = (1 - z/SPAWN_Z) * 0.5;
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // --- PREPARE RENDER QUEUE ---
    type RenderItem = { z: number; draw: () => void };
    const renderQueue: RenderItem[] = [];

    // --- 2. UPDATE & COLLECT BLOCKS ---
    blocksRef.current.forEach((block, idx) => {
        if (block.remove) return; 
        block.z -= GAME_SPEED;

        const xOffset = (block.gridX - 1.5) * GRID_X_SPACING; 
        const yOffset = (1 - block.gridY) * GRID_Y_SPACING;
        const proj = project(xOffset, yOffset, block.z, cx, cy);
        const size = BLOCK_SIZE * proj.scale;

        // Render Logic with Depth Fog
        if (block.z > 50 && block.z < SPAWN_Z + 200 && !block.hit) {
             renderQueue.push({
                 z: block.z,
                 draw: () => {
                    ctx.save();
                    // Depth Fog Alpha
                    const depthAlpha = Math.max(0, Math.min(1, 1 - (block.z / (SPAWN_Z + 500))));
                    ctx.globalAlpha = depthAlpha;
                    
                    ctx.translate(proj.x, proj.y);
                    const colorMain = block.color === 'red' ? '#ff0033' : '#00ccff';
                    
                    if (block.type === 'bomb') {
                        ctx.beginPath();
                        ctx.arc(0,0, size/1.8, 0, Math.PI*2);
                        ctx.fillStyle = '#1e293b';
                        ctx.fill();
                        ctx.strokeStyle = '#ef4444';
                        ctx.lineWidth = 3 * proj.scale;
                        for(let i=0; i<8; i++) {
                            ctx.beginPath();
                            ctx.moveTo(0,0);
                            const ang = (i/8)*Math.PI*2 + (timestamp/200);
                            ctx.lineTo(Math.cos(ang)*size/1.3, Math.sin(ang)*size/1.3);
                            ctx.stroke();
                        }
                        const grad = ctx.createRadialGradient(0,0, size/10, 0,0, size/2);
                        grad.addColorStop(0, '#f59e0b');
                        grad.addColorStop(1, '#78350f');
                        ctx.fillStyle = grad;
                        ctx.fill();
                    } else {
                        ctx.fillStyle = colorMain;
                        const r = size * 0.15;
                        ctx.beginPath();
                        ctx.roundRect(-size/2, -size/2, size, size, r);
                        ctx.fill();
                        
                        ctx.fillStyle = 'rgba(0,0,0,0.3)';
                        ctx.beginPath();
                        ctx.roundRect(-size/2 + 5*proj.scale, -size/2 + 5*proj.scale, size - 10*proj.scale, size - 10*proj.scale, r);
                        ctx.fill();

                        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                        ctx.lineWidth = 4 * proj.scale;
                        ctx.strokeRect(-size/2, -size/2, size, size);

                        ctx.fillStyle = 'white';
                        if (block.direction === 'DOT') {
                            ctx.beginPath();
                            ctx.arc(0,0, size/4, 0, Math.PI*2);
                            ctx.fill();
                        } else {
                            ctx.save();
                            let rot = 0;
                            if (block.direction === 'DOWN') rot = 180;
                            else if (block.direction === 'LEFT') rot = -90;
                            else if (block.direction === 'RIGHT') rot = 90;
                            ctx.rotate(rot * Math.PI/180);
                            
                            ctx.beginPath();
                            ctx.moveTo(0, -size/3);
                            ctx.lineTo(size/3, size/4);
                            ctx.lineTo(-size/3, size/4);
                            ctx.closePath();
                            ctx.fill();
                            ctx.restore();
                        }
                    }
                    ctx.restore();
                    ctx.globalAlpha = 1.0;
                 }
             });
        }

        if (!block.hit && block.z < HIT_WINDOW_Z_FAR && block.z > HIT_WINDOW_Z_NEAR) {
            const hitCheck = (hand: SaberState) => {
                const dist = Math.sqrt((hand.x - proj.x)**2 + (hand.y - proj.y)**2);
                return dist < size * 1.5; // Larger hit window for visual offset
            };

            const leftHit = hitCheck(leftHandRef.current);
            const rightHit = hitCheck(rightHandRef.current);

            if (block.type === 'bomb') {
                if (leftHit || rightHit) {
                    block.hit = true;
                    sfx.playExplosion();
                    energyRef.current = Math.max(0, energyRef.current - 15);
                    comboRef.current = 0;
                    createExplosion(proj.x, proj.y, '#f59e0b');
                    if (energyRef.current <= 0) finishGame();
                }
            } else {
                let success = false;
                let usedHand = null;
                if (block.color === 'red' && leftHit) { success = true; usedHand = leftHandRef.current; }
                if (block.color === 'blue' && rightHit) { success = true; usedHand = rightHandRef.current; }

                if (success && usedHand) {
                    block.hit = true;
                    const angle = Math.atan2(usedHand.velocityVector.y, usedHand.velocityVector.x);
                    block.cutAngle = angle;
                    
                    sfx.playSlice();
                    hitNotesRef.current++;
                    scoreRef.current += (100 + (comboRef.current > 10 ? 10 : 0));
                    comboRef.current++;
                    energyRef.current = Math.min(100, energyRef.current + 4);
                    
                    createExplosion(proj.x, proj.y, block.color === 'red' ? '#ff0033' : '#00ccff');
                    createDebris(block, cx, cy);
                    
                    setHudScore(scoreRef.current);
                    setHudCombo(comboRef.current);
                    setHudEnergy(energyRef.current);
                }
            }
        }

        if (block.z < -250) {
            block.remove = true;
            if (!block.hit && block.type !== 'bomb') {
                comboRef.current = 0;
                setHudCombo(0);
                energyRef.current = Math.max(0, energyRef.current - 8);
                setHudEnergy(energyRef.current);
                if (energyRef.current <= 0) finishGame();
            }
        }
    });

    blocksRef.current = blocksRef.current.filter(b => !b.remove);

    // --- 3. UPDATE & COLLECT OBSTACLES ---
    obstaclesRef.current.forEach((obs, idx) => {
        obs.z -= GAME_SPEED;
        const pFront = project(0, 0, obs.z, cx, cy);
        
        if (obs.z > 50 && obs.z < SPAWN_Z + 200) {
             renderQueue.push({
                 z: obs.z,
                 draw: () => {
                     // Depth Fog
                     const depthAlpha = Math.max(0, Math.min(1, 1 - (obs.z / (SPAWN_Z + 500))));
                     ctx.globalAlpha = depthAlpha * 0.8; // Obstacles are slightly see-through

                     const w = (obs.type === 'WALL_TOP' ? 1200 : 500) * pFront.scale;
                     const h = (obs.type === 'WALL_TOP' ? 400 : 1200) * pFront.scale;
                     let sx = cx; let sy = cy;
                     if (obs.type === 'WALL_TOP') sy = cy - 300 * pFront.scale;
                     else if (obs.type === 'WALL_LEFT') sx = cx - 500 * pFront.scale;
                     else sx = cx + 500 * pFront.scale;

                     ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                     ctx.strokeStyle = 'rgba(255, 50, 50, 0.9)';
                     ctx.lineWidth = 4 * pFront.scale;
                     ctx.fillRect(sx - w/2, sy - h/2, w, h);
                     ctx.strokeRect(sx - w/2, sy - h/2, w, h);
                     ctx.globalAlpha = 1.0;
                 }
             });
        }

        if (!obs.hit && obs.z < 250 && obs.z > -100) {
             let hit = false;
             if (obs.type === 'WALL_TOP' && headRef.current.y < 0.45) hit = true;
             if (obs.type === 'WALL_LEFT' && bodyRef.current.x < 0.4) hit = true;
             if (obs.type === 'WALL_RIGHT' && bodyRef.current.x > 0.6) hit = true;

             if (hit) {
                 obs.hit = true;
                 sfx.playDamage();
                 energyRef.current -= 10;
                 comboRef.current = 0;
                 setHudEnergy(energyRef.current);
                 setWarning("躲避障碍!");
                 setTimeout(() => setWarning(null), 800);
             }
        }
        if (obs.z < -500) obs.remove = true;
    });
    obstaclesRef.current = obstaclesRef.current.filter(o => !o.remove);

    // --- 4. UPDATE & COLLECT DEBRIS ---
    debrisRef.current.forEach((d, idx) => {
        d.x += d.vx; d.y += d.vy; d.z += d.vz;
        d.rot += d.vRot;
        d.life -= 0.03;
        
        if (d.life > 0) {
            renderQueue.push({
                z: d.z,
                draw: () => {
                    const p = project(d.x, d.y, d.z, cx, cy);
                    const size = BLOCK_SIZE * p.scale;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(d.rot);
                    ctx.fillStyle = d.color;
                    ctx.globalAlpha = d.life;
                    ctx.fillRect(d.type==='left_half' ? -size/2 : 0, -size/2, size/2, size);
                    ctx.restore();
                }
            });
        }
    });
    debrisRef.current = debrisRef.current.filter(d => d.life > 0);

    // --- 5. EXECUTE RENDER QUEUE ---
    renderQueue.sort((a, b) => b.z - a.z);
    renderQueue.forEach(item => item.draw());
    ctx.globalAlpha = 1;

    // --- 6. PARTICLES ---
    particlesRef.current.forEach((p, idx) => {
        p.x += p.vx; p.y += p.vy; p.life -= 0.05;
        if (p.life > 0) {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI*2);
            ctx.fill();
        } 
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);
    ctx.globalAlpha = 1;

    // --- 7. SABER TRAILS ---
    const drawTrail = (hand: SaberState, color: string) => {
        if (hand.history.length < 2) return;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 25;
        ctx.shadowColor = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 15; 
        ctx.beginPath();
        ctx.moveTo(hand.history[0].x, hand.history[0].y);
        for(let i=1; i<hand.history.length; i++) ctx.lineTo(hand.history[i].x, hand.history[i].y);
        ctx.stroke();
        
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.shadowBlur = 0;
    };
    drawTrail(leftHandRef.current, '#ff0033');
    drawTrail(rightHandRef.current, '#00ccff');

    // --- 8. HUD ---
    const barW = 600; const barH = 15;
    const barX = cx - barW/2; const barY = canvas.height - 40;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barW, barH);
    const ePct = Math.max(0, Math.min(1, energyRef.current / 100));
    ctx.fillStyle = ePct > 0.5 ? '#4ade80' : (ePct > 0.2 ? '#facc15' : '#ef4444');
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
    ctx.fillRect(barX, barY, barW * ePct, barH);
    ctx.shadowBlur = 0;

    ctx.textAlign = 'left';
    ctx.fillStyle = 'white';
    ctx.font = '900 30px "Orbitron"';
    ctx.fillText(`${hudScore}`, 50, canvas.height - 50);
    ctx.font = '16px "Inter"';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText("SCORE", 50, canvas.height - 85);

    ctx.textAlign = 'right';
    if (hudCombo > 0) {
        ctx.font = '900 40px "Orbitron"';
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(`x${hudCombo}`, canvas.width - 50, canvas.height - 50);
    }
    
    if (warning) {
        ctx.textAlign = 'center';
        ctx.font = '900 60px "Orbitron"';
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.fillText(warning, cx, cy - 100);
        ctx.strokeText(warning, cx, cy - 100);
    }
  };

  useEffect(() => {
    if (isActive) {
      scoreRef.current = 0;
      setHudScore(0);
      setHudCombo(0);
      setHudEnergy(50);
      isPlayingRef.current = false;
      requestRef.current = requestAnimationFrame(updateGame);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (timerIDRef.current) clearInterval(timerIDRef.current);
      if (userSourceRef.current) { try{ userSourceRef.current.stop() }catch(e){} }
      if (audioCtxRef.current) audioCtxRef.current.close();
      audioCtxRef.current = null;
    };
  }, [isActive]);

  return (
    <>
      <canvas ref={canvasRef} width={dimensions.width} height={dimensions.height} className="absolute top-0 left-0 w-full h-full object-cover z-20 pointer-events-none" />
      <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
    </>
  );
};