import React, { useState, useEffect, useRef } from 'react';
import { GameState, GameType } from './types';
import { createPoseLandmarker, getPoseLandmarker } from './services/visionService';
import { DodgeGame } from './games/DodgeGame';
import { CatchGame } from './games/CatchGame';
import { SaberGame } from './games/SaberGame';
import { AlertCircle, Loader2, RefreshCw, Hand, Sword, RotateCcw, Home, AlertTriangle, Trophy, Zap } from 'lucide-react';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [activeGame, setActiveGame] = useState<GameType | null>(null);
  const [score, setScore] = useState(0);
  const [gameGrade, setGameGrade] = useState<string>(''); // For Saber Grade
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState(false);
  
  // Cursor State
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0, visible: false });
  const [hoverProgress, setHoverProgress] = useState(0);
  
  // Interaction State
  const [hoveredGame, setHoveredGame] = useState<GameType | null>(null); // For Menu
  const [hoveredAction, setHoveredAction] = useState<'RETRY' | 'MENU' | null>(null); // For Game Over
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number>(0);
  const cursorSmoothRef = useRef({ x: 0.5, y: 0.5 }); // For smoothing
  const hoverStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Load MediaPipe Model on Mount
    const loadModel = async () => {
      try {
        await createPoseLandmarker();
        setModelLoaded(true);
        setModelError(false);
      } catch (err) {
        console.error("Failed to load MediaPipe model", err);
        setModelError(true);
      }
    };
    loadModel();
  }, []);

  // Camera is active in ALL states now to ensure smooth transitions and control
  const shouldCameraBeOn = true;

  // Setup Webcam
  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      if (shouldCameraBeOn && videoRef.current && !videoRef.current.srcObject) {
        try {
          console.log("Requesting camera access...");
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720, frameRate: 30 } // Request higher res for fullscreen
          });
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(e => console.error("Video play error:", e));
            videoRef.current.onloadeddata = () => {
              console.log("Camera data loaded");
            };
          }
        } catch (e) {
          console.error("Camera error:", e);
          alert("无法访问摄像头，请检查权限设置。");
        }
      }
    };

    if (shouldCameraBeOn) {
      startCamera();
    }

    return () => {};
  }, [shouldCameraBeOn]);

  // Handle Loading Transition
  useEffect(() => {
    if (gameState === GameState.LOADING_MODEL) {
      const timer = setTimeout(() => {
        setGameState(GameState.PLAYING);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gameState]);

  // Motion Control Loop (Menu & Game Over)
  useEffect(() => {
    // We run motion control in MENU and GAME_OVER states
    const isInteractiveState = gameState === GameState.MENU || gameState === GameState.GAME_OVER;
    
    if (!isInteractiveState || !modelLoaded) return;

    const landmarker = getPoseLandmarker();
    
    const updateMotionControl = () => {
      if (!videoRef.current || !landmarker) return;

      if (videoRef.current.currentTime > 0) {
        const result = landmarker.detectForVideo(videoRef.current, performance.now());
        
        if (result.landmarks && result.landmarks.length > 0) {
          const landmarks = result.landmarks[0];
          
          // Detect hand (Index finger tip)
          let activeHand = null;
          if (landmarks[20].visibility && landmarks[20].visibility > 0.5) {
             activeHand = landmarks[20]; // Right index
          } else if (landmarks[19].visibility && landmarks[19].visibility > 0.5) {
             activeHand = landmarks[19]; // Left index
          }

          if (activeHand) {
            const targetX = (1 - activeHand.x) * window.innerWidth;
            const targetY = activeHand.y * window.innerHeight;

            // Smooth cursor
            cursorSmoothRef.current.x += (targetX - cursorSmoothRef.current.x) * 0.2;
            cursorSmoothRef.current.y += (targetY - cursorSmoothRef.current.y) * 0.2;

            const cx = cursorSmoothRef.current.x;
            const cy = cursorSmoothRef.current.y;

            setCursorPos({ x: cx, y: cy, visible: true });

            const element = document.elementFromPoint(cx, cy);

            // --- STATE SPECIFIC INTERACTION LOGIC ---
            
            if (gameState === GameState.MENU) {
                // Check for Game Cards
                const gameCard = element?.closest('[data-game-type]');
                if (gameCard) {
                  const gameType = gameCard.getAttribute('data-game-type') as GameType;
                  handleHoverLogic(gameType, hoveredGame, setHoveredGame, (t) => startGame(t));
                } else {
                  resetHoverLogic(hoveredGame, setHoveredGame);
                }
            } 
            else if (gameState === GameState.GAME_OVER) {
                // Check for Action Buttons
                const actionBtn = element?.closest('[data-action-type]');
                if (actionBtn) {
                    const actionType = actionBtn.getAttribute('data-action-type') as 'RETRY' | 'MENU';
                    handleHoverLogic(actionType, hoveredAction, setHoveredAction, (t) => {
                        if (t === 'RETRY') startGame(activeGame!);
                        else returnToMenu();
                    });
                } else {
                    resetHoverLogic(hoveredAction, setHoveredAction);
                }
            }

          } else {
            setCursorPos(prev => ({ ...prev, visible: false }));
            // Reset hovers if hand lost
            if (hoveredGame) resetHoverLogic(hoveredGame, setHoveredGame);
            if (hoveredAction) resetHoverLogic(hoveredAction, setHoveredAction);
          }
        }
      }
      requestRef.current = requestAnimationFrame(updateMotionControl);
    };

    // Helper for generic hover progress logic
    const handleHoverLogic = <T,>(
        newItem: T, 
        currentItem: T | null, 
        setItem: React.Dispatch<React.SetStateAction<T | null>>,
        onComplete: (item: T) => void
    ) => {
        if (newItem === currentItem) {
            if (hoverStartTimeRef.current) {
              const elapsed = performance.now() - hoverStartTimeRef.current;
              const progress = Math.min((elapsed / 1500) * 100, 100); 
              setHoverProgress(progress);

              if (progress >= 100) {
                onComplete(newItem);
                setHoverProgress(0);
                setItem(null);
                hoverStartTimeRef.current = null;
              }
            }
        } else {
            setItem(newItem);
            hoverStartTimeRef.current = performance.now();
            setHoverProgress(0);
        }
    };

    const resetHoverLogic = <T,>(currentItem: T | null, setItem: React.Dispatch<React.SetStateAction<T | null>>) => {
        if (currentItem) {
            setItem(null);
            setHoverProgress(0);
            hoverStartTimeRef.current = null;
        }
    };

    requestRef.current = requestAnimationFrame(updateMotionControl);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, modelLoaded, hoveredGame, hoveredAction, activeGame]);

  const startGame = (type: GameType) => {
    if (!modelLoaded) return;
    setActiveGame(type);
    setScore(0);
    setGameGrade('');
    setGameState(GameState.LOADING_MODEL);
    // Reset hover states
    setHoveredGame(null);
    setHoveredAction(null);
    setHoverProgress(0);
  };

  const handleGameOver = (finalScore: number, grade?: string) => {
    setScore(finalScore);
    if (grade) setGameGrade(grade);
    setGameState(GameState.GAME_OVER);
  };

  const returnToMenu = () => {
    setGameState(GameState.MENU);
    setActiveGame(null);
    setHoveredGame(null);
    setHoveredAction(null);
    setHoverProgress(0);
    setGameGrade('');
  };

  // Determine background style
  const isMenuOrOver = gameState === GameState.MENU || gameState === GameState.GAME_OVER;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center relative overflow-hidden">
      
      {/* GLOBAL VIDEO BACKGROUND (FULL SCREEN) */}
      <div className={`fixed inset-0 z-0 overflow-hidden`}>
         <video 
              ref={videoRef}
              autoPlay 
              playsInline
              muted
              className={`absolute top-0 left-0 w-full h-full object-cover scale-x-[-1] transition-all duration-500
                ${isMenuOrOver ? 'opacity-40 blur-sm' : 'opacity-100'}
              `}
          />
         {isMenuOrOver && <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]"></div>}
      </div>

      {/* CURSOR (Visible in Menu AND Game Over) */}
      {isMenuOrOver && cursorPos.visible && (
        <div 
          className="fixed pointer-events-none z-50 flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
          style={{ left: cursorPos.x, top: cursorPos.y }}
        >
          <svg className="w-16 h-16 rotate-[-90deg]">
            <circle cx="32" cy="32" r="28" stroke="rgba(255,255,255,0.2)" strokeWidth="4" fill="none" />
            <circle 
              cx="32" cy="32" r="28" 
              stroke={gameState === GameState.GAME_OVER ? "#fbbf24" : "#22d3ee"}
              strokeWidth="4" 
              fill="none" 
              strokeDasharray={175} 
              strokeDashoffset={175 - (175 * hoverProgress) / 100}
              className="transition-all duration-100"
            />
          </svg>
          <Hand className={`w-8 h-8 absolute drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] ${gameState === GameState.GAME_OVER ? "text-yellow-400" : "text-white"}`} />
        </div>
      )}

      {/* Header (Menu Only) */}
      {gameState === GameState.MENU && (
        <header className="absolute top-6 left-0 w-full text-center z-10 pointer-events-none">
          <h1 className="text-4xl md:text-6xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 font-black tracking-widest uppercase drop-shadow-[0_2px_10px_rgba(34,211,238,0.5)]">
            体感游戏厅
          </h1>
          <p className="text-slate-300 mt-2 text-sm md:text-base font-bold drop-shadow-md">
            {modelLoaded ? "举起你的手来控制光标！" : "正在初始化 AI 视觉核心..."}
          </p>
        </header>
      )}

      {/* Main Content Area */}
      <main className="relative z-10 w-full flex flex-col items-center justify-center h-full min-h-screen">
        
        {/* MENU STATE */}
        {gameState === GameState.MENU && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl px-4 mt-20">
            {/* Dodge Game Card */}
            <div 
              data-game-type={GameType.DODGE}
              className={`
                relative p-6 rounded-3xl border-2 backdrop-blur-md flex flex-col items-center transition-all duration-300 transform min-h-[300px] cursor-none
                ${hoveredGame === GameType.DODGE ? 'bg-slate-800/90 border-cyan-400 scale-105 shadow-[0_0_50px_rgba(34,211,238,0.4)]' : 'bg-slate-800/60 border-slate-600/50 hover:bg-slate-800/80'}
              `}
            >
              <div className="w-20 h-20 bg-cyan-900/50 rounded-full flex items-center justify-center mb-6">
                <AlertCircle className={`w-10 h-10 transition-colors ${hoveredGame === GameType.DODGE ? 'text-white' : 'text-cyan-400'}`} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 arcade-font">超光速战机</h2>
              <p className="text-slate-300 text-center mb-4 text-sm flex-grow">
                移动<span className="text-cyan-300 font-bold">身体</span>驾驶飞船。
              </p>
            </div>

            {/* Catch Game Card (UPDATED TO FRUIT NINJA) */}
            <div 
              data-game-type={GameType.CATCH}
              className={`
                relative p-6 rounded-3xl border-2 backdrop-blur-md flex flex-col items-center transition-all duration-300 transform min-h-[300px] cursor-none
                ${hoveredGame === GameType.CATCH ? 'bg-slate-800/90 border-green-400 scale-105 shadow-[0_0_50px_rgba(74,222,128,0.4)]' : 'bg-slate-800/60 border-slate-600/50 hover:bg-slate-800/80'}
              `}
            >
              <div className="w-20 h-20 bg-green-900/50 rounded-full flex items-center justify-center mb-6">
                <Zap className={`w-10 h-10 transition-colors ${hoveredGame === GameType.CATCH ? 'text-white' : 'text-green-400'}`} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 arcade-font">疾风切水果</h2>
              <p className="text-slate-300 text-center mb-4 text-sm flex-grow">
                快速挥动<span className="text-green-300 font-bold">手指</span>切开水果，小心炸弹！
              </p>
            </div>

             {/* Saber Game Card */}
             <div 
              data-game-type={GameType.SABER}
              className={`
                relative p-6 rounded-3xl border-2 backdrop-blur-md flex flex-col items-center transition-all duration-300 transform min-h-[300px] cursor-none
                ${hoveredGame === GameType.SABER ? 'bg-slate-800/90 border-rose-400 scale-105 shadow-[0_0_50px_rgba(251,113,133,0.4)]' : 'bg-slate-800/60 border-slate-600/50 hover:bg-slate-800/80'}
              `}
            >
              <div className="w-20 h-20 bg-rose-900/50 rounded-full flex items-center justify-center mb-6">
                <Sword className={`w-10 h-10 transition-colors ${hoveredGame === GameType.SABER ? 'text-white' : 'text-rose-400'}`} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 arcade-font">节奏闪避</h2>
              <p className="text-slate-300 text-center mb-4 text-sm flex-grow">
                <span className="text-rose-300 font-bold">双剑</span>挥砍，<span className="text-blue-300 font-bold">下蹲侧身</span>躲避。
                <br/>
                <span className="text-yellow-400 font-bold text-xs mt-2 block">SSS级评分挑战！</span>
              </p>
            </div>
          </div>
        )}

        {/* Global Error Message */}
        {modelError && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-900/90 border border-red-500 p-8 rounded-xl flex flex-col items-center gap-4 z-50">
             <AlertCircle className="w-12 h-12 text-red-400" />
             <span className="text-white text-xl font-bold">AI 视觉模型加载失败</span>
             <button onClick={() => window.location.reload()} className="px-6 py-2 bg-red-600 rounded-lg hover:bg-red-500 flex items-center gap-2 text-white font-bold">
                <RefreshCw className="w-4 h-4" />
                重试
             </button>
          </div>
        )}

        {/* FULL SCREEN GAME CONTAINER */}
        {(gameState === GameState.LOADING_MODEL || gameState === GameState.PLAYING) && (
          <div className="fixed inset-0 z-20 overflow-hidden">
            
            {/* Loading Overlay */}
            {gameState === GameState.LOADING_MODEL && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm">
                <Loader2 className="w-24 h-24 text-cyan-500 animate-spin mb-6" />
                <h3 className="text-4xl text-white arcade-font animate-pulse">游戏即将开始...</h3>
              </div>
            )}
            
            {/* Active Game Layer */}
            {gameState === GameState.PLAYING && (
              <>
                {activeGame === GameType.DODGE && (
                  <DodgeGame 
                    landmarker={getPoseLandmarker()} 
                    videoRef={videoRef} 
                    onGameOver={handleGameOver}
                    isActive={gameState === GameState.PLAYING}
                  />
                )}
                {activeGame === GameType.CATCH && (
                  <CatchGame 
                    landmarker={getPoseLandmarker()} 
                    videoRef={videoRef} 
                    onGameOver={handleGameOver}
                    isActive={gameState === GameState.PLAYING}
                  />
                )}
                {activeGame === GameType.SABER && (
                  <SaberGame
                    landmarker={getPoseLandmarker()} 
                    videoRef={videoRef} 
                    onGameOver={(s, g) => handleGameOver(s, g)}
                    isActive={gameState === GameState.PLAYING}
                  />
                )}

                <button 
                  onClick={returnToMenu}
                  className="absolute top-8 right-8 z-50 bg-red-600/80 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-600 arcade-font border border-red-400/50 backdrop-blur-md"
                >
                  退出游戏 / EXIT
                </button>
              </>
            )}
          </div>
        )}

        {/* GAME OVER STATE (OVERLAY) */}
        {gameState === GameState.GAME_OVER && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-slate-800/90 p-8 md:p-12 rounded-2xl border-2 border-cyan-500/50 flex flex-col items-center text-center max-w-2xl w-full mx-4 shadow-[0_0_100px_rgba(34,211,238,0.2)]">
              <h2 className="text-6xl font-black text-white mb-2 arcade-font drop-shadow-md tracking-wider">GAME OVER</h2>
              {gameGrade && <div className="text-9xl font-black text-yellow-400 mb-2 arcade-font drop-shadow-[0_0_30px_rgba(250,204,21,0.8)]">{gameGrade}</div>}
              <div className="text-5xl font-bold text-cyan-400 mb-10 arcade-font drop-shadow-[0_0_20px_rgba(34,211,238,0.6)]">SCORE: {score}</div>

              <div className="flex gap-8 w-full justify-center mt-4">
                {/* Retry Button */}
                <div 
                  data-action-type="RETRY"
                  className={`
                    group relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-300 min-w-[160px] cursor-none
                    ${hoveredAction === 'RETRY' ? 'bg-cyan-900/80 border-cyan-400 scale-110 shadow-[0_0_30px_rgba(34,211,238,0.5)]' : 'bg-slate-700/50 border-slate-600 hover:bg-slate-700'}
                  `}
                >
                    <RotateCcw className={`w-12 h-12 mb-2 ${hoveredAction === 'RETRY' ? 'text-white animate-spin-slow' : 'text-cyan-400'}`} />
                    <span className="text-xl font-bold text-white uppercase tracking-wider">重试</span>
                    {hoveredAction === 'RETRY' && (
                        <div className="absolute -bottom-4 w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-400" style={{ width: `${hoverProgress}%` }}></div>
                        </div>
                    )}
                </div>

                {/* Menu Button */}
                <div 
                  data-action-type="MENU"
                  className={`
                    group relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-300 min-w-[160px] cursor-none
                    ${hoveredAction === 'MENU' ? 'bg-purple-900/80 border-purple-400 scale-110 shadow-[0_0_30px_rgba(168,85,247,0.5)]' : 'bg-slate-700/50 border-slate-600 hover:bg-slate-700'}
                  `}
                >
                    <Home className={`w-12 h-12 mb-2 ${hoveredAction === 'MENU' ? 'text-white' : 'text-purple-400'}`} />
                    <span className="text-xl font-bold text-white uppercase tracking-wider">菜单</span>
                    {hoveredAction === 'MENU' && (
                        <div className="absolute -bottom-4 w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-400" style={{ width: `${hoverProgress}%` }}></div>
                        </div>
                    )}
                </div>
              </div>
              
              <div className="mt-8 text-slate-400 text-sm font-bold animate-pulse">
                使用手势悬停来选择按钮
              </div>
            </div>
          </div>
        )}

      </main>

      <footer className="absolute bottom-4 text-xs text-slate-500 z-10 pointer-events-none">
        由 MediaPipe 强力驱动
      </footer>
    </div>
  );
};

export default App;