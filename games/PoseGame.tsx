import React, { useRef, useEffect, useState } from 'react';
import { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { sfx } from '../services/audioService';

interface PoseGameProps {
  landmarker: PoseLandmarker | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onGameOver: (score: number) => void;
  isActive: boolean;
}

type PoseType = 'VICTORY' | 'WIDE' | 'PRAY';

const POSES: { type: PoseType; label: string; icon: string }[] = [
  { type: 'VICTORY', label: '胜利姿态', icon: '🙌' },
  { type: 'WIDE', label: 'T型平衡', icon: '🧍' },
  { type: 'PRAY', label: '双手合十', icon: '🙏' }
];

const POSE_CONNECTIONS = [
  [11, 13], [13, 15], // Left Arm
  [12, 14], [14, 16], // Right Arm
  [11, 12], // Shoulders
  [11, 23], [12, 24], // Torso
  [23, 24]  // Hips
];

export const PoseGame: React.FC<PoseGameProps> = ({ landmarker, videoRef, onGameOver, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const scoreRef = useRef(0);
  const timeLeftRef = useRef(60); 
  const currentPoseRef = useRef<PoseType>('VICTORY');
  const holdStartTimeRef = useRef<number | null>(null);
  const [hudScore, setHudScore] = useState(0);
  const [hudTime, setHudTime] = useState(60);
  const [targetPose, setTargetPose] = useState<PoseType>('VICTORY');
  const [progress, setProgress] = useState(0);
  
  // Responsive Canvas Size
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  const lastPoseChangeTime = useRef(0);

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

  const pickNewPose = () => {
    const availablePoses = POSES.filter(p => p.type !== currentPoseRef.current);
    const next = availablePoses[Math.floor(Math.random() * availablePoses.length)];
    
    currentPoseRef.current = next.type;
    setTargetPose(next.type);
    holdStartTimeRef.current = null;
    setProgress(0);
  };

  const checkPose = (landmarks: any[]): boolean => {
    const VISIBILITY_THRESHOLD = 0.5;

    const getL = (index: number) => {
      const l = landmarks[index];
      return (l && l.visibility > VISIBILITY_THRESHOLD) ? l : null;
    };

    const leftWrist = getL(15);
    const rightWrist = getL(16);
    const leftElbow = getL(13);
    const rightElbow = getL(14);
    const leftShoulder = getL(11);
    const rightShoulder = getL(12);

    if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder || !leftElbow || !rightElbow) return false;

    switch (currentPoseRef.current) {
      case 'VICTORY':
        const wristsHigh = leftWrist.y < leftShoulder.y - 0.2 && rightWrist.y < rightShoulder.y - 0.2;
        const armsOpen = Math.abs(leftWrist.x - rightWrist.x) > 0.3;
        return wristsHigh && armsOpen;
      
      case 'WIDE':
        const leftArmLevel = Math.abs(leftWrist.y - leftShoulder.y) < 0.15 && Math.abs(leftElbow.y - leftShoulder.y) < 0.15;
        const rightArmLevel = Math.abs(rightWrist.y - rightShoulder.y) < 0.15 && Math.abs(rightElbow.y - rightShoulder.y) < 0.15;
        const armsFar = Math.abs(leftWrist.x - rightWrist.x) > 0.6; 
        return leftArmLevel && rightArmLevel && armsFar;

      case 'PRAY':
        const handsClose = Math.sqrt(Math.pow(leftWrist.x - rightWrist.x, 2) + Math.pow(leftWrist.y - rightWrist.y, 2)) < 0.1;
        const handsUp = leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
        return handsClose && handsUp;
      
      default:
        return false;
    }
  };

  const updateGame = (timestamp: number) => {
    if (!canvasRef.current || !videoRef.current || !landmarker) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let startTimeMs = performance.now();
    let isPoseMatched = false;

    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (videoRef.current.currentTime > 0) {
      const result: PoseLandmarkerResult = landmarker.detectForVideo(videoRef.current, startTimeMs);
      
      if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0];
        isPoseMatched = checkPose(landmarks);
        
        // Draw Skeleton
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowBlur = 15;
        ctx.shadowColor = isPoseMatched ? '#4ade80' : '#22d3ee';

        POSE_CONNECTIONS.forEach(([start, end]) => {
          const p1 = landmarks[start];
          const p2 = landmarks[end];
          
          if (p1 && p2 && p1.visibility > 0.5 && p2.visibility > 0.5) {
            ctx.beginPath();
            // Mirror X
            ctx.moveTo((1 - p1.x) * canvas.width, p1.y * canvas.height);
            ctx.lineTo((1 - p2.x) * canvas.width, p2.y * canvas.height);
            ctx.strokeStyle = isPoseMatched ? '#4ade80' : 'rgba(34, 211, 238, 0.6)';
            ctx.lineWidth = 8;
            ctx.stroke();
          }
        });

        // Draw Joints
        [11,12,13,14,15,16,0].forEach(idx => {
           const p = landmarks[idx];
           if (p && p.visibility > 0.5) {
             ctx.beginPath();
             ctx.arc((1 - p.x) * canvas.width, p.y * canvas.height, 8, 0, 2 * Math.PI);
             ctx.fillStyle = isPoseMatched ? '#22c55e' : '#22d3ee';
             ctx.fill();
           }
        });
        
        ctx.shadowBlur = 0;
      }
    }

    // Logic: Hold pose
    if (isPoseMatched) {
      if (!holdStartTimeRef.current) {
        holdStartTimeRef.current = timestamp;
      }
      
      const holdDuration = timestamp - holdStartTimeRef.current;
      const requiredDuration = 1000; 
      
      const prog = Math.min((holdDuration / requiredDuration) * 100, 100);
      setProgress(prog);

      // Play charge sound randomly to indicate progress
      sfx.playCharge(prog);

      if (holdDuration > requiredDuration) {
        scoreRef.current += 150;
        setHudScore(scoreRef.current);
        
        sfx.playSuccess(); // Success sound

        // Visual flash
        ctx.fillStyle = 'rgba(74, 222, 128, 0.3)';
        ctx.fillRect(0,0, canvas.width, canvas.height);
        
        pickNewPose();
      }
    } else {
      if (progress > 0) {
        setProgress(p => Math.max(0, p - 5));
        if (progress < 10) holdStartTimeRef.current = null;
      }
    }

    if (timestamp - lastPoseChangeTime.current > 1000) {
      timeLeftRef.current -= 1;
      setHudTime(timeLeftRef.current);
      lastPoseChangeTime.current = timestamp;

      if (timeLeftRef.current <= 0) {
        cancelAnimationFrame(requestRef.current!);
        onGameOver(scoreRef.current);
        return;
      }
    }

    if (isActive) {
      requestRef.current = requestAnimationFrame(updateGame);
    }
  };

  useEffect(() => {
    if (isActive) {
      scoreRef.current = 0;
      timeLeftRef.current = 60;
      setHudScore(0);
      setHudTime(60);
      lastPoseChangeTime.current = performance.now();
      pickNewPose();
      requestRef.current = requestAnimationFrame(updateGame);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isActive]);

  const currentPoseData = POSES.find(p => p.type === targetPose);

  return (
    <>
      <canvas 
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="absolute top-0 left-0 w-full h-full object-cover z-20 pointer-events-none"
      />
      
      {/* HUD */}
      <div className="absolute top-4 left-4 z-30 arcade-font text-3xl text-yellow-400 drop-shadow-md flex justify-between w-[90%] pointer-events-none">
        <span className="bg-black/60 px-4 py-2 rounded-xl backdrop-blur-sm border border-yellow-500/30">得分: {hudScore}</span>
        <span className={`${hudTime < 10 ? "text-red-500 animate-ping" : "text-white"} bg-black/60 px-4 py-2 rounded-xl backdrop-blur-sm border border-slate-500/30`}>
          时间: {hudTime}
        </span>
      </div>

      {/* Target Pose Indicator (Center Overlay) */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center pointer-events-none">
        <div className={`text-9xl mb-4 transition-transform duration-200 drop-shadow-[0_0_25px_rgba(0,0,0,0.8)] ${progress > 80 ? 'scale-125 animate-pulse' : 'scale-100'}`}>
          {currentPoseData?.icon}
        </div>
        <div className="text-5xl font-black text-white uppercase tracking-widest drop-shadow-[0_4px_0_#000] stroke-black">
          {currentPoseData?.label}
        </div>
        
        {/* Progress Bar */}
        <div className="w-64 h-8 bg-slate-900/80 rounded-full mt-6 overflow-hidden border-2 border-slate-500/50 backdrop-blur-md">
          <div 
            className="h-full bg-gradient-to-r from-yellow-400 to-red-500 transition-all duration-75 shadow-[0_0_10px_rgba(250,204,21,0.8)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </>
  );
};