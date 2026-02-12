import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

let poseLandmarker: PoseLandmarker | null = null;
let initPromise: Promise<PoseLandmarker> | null = null;

// Local model paths
const MODEL_URL_LOCAL = "/models/pose_landmarker_lite.task";
const WASM_URL_LOCAL = "/models/wasm";

export const createPoseLandmarker = async (): Promise<PoseLandmarker> => {
  if (poseLandmarker) return poseLandmarker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log("Initializing Vision Model...");
    
    try {
      // 1. Initialize WASM from local files
      const vision = await FilesetResolver.forVisionTasks(WASM_URL_LOCAL);
      
      console.log("WASM Initialized, loading model...");

      // 2. Try initializing with GPU first
      try {
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL_LOCAL,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
        console.log("Vision Model Initialized (GPU)");
        return landmarker;
      } catch (gpuError) {
        console.warn("GPU Initialization failed, falling back to CPU:", gpuError);
        
        // 3. Fallback to CPU
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL_LOCAL,
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
        console.log("Vision Model Initialized (CPU)");
        return landmarker;
      }
    } catch (error) {
      console.error("Fatal Vision Service Error:", error);
      
      if (error instanceof TypeError && error.message.includes("fetch")) {
        console.error("Network Error: Could not load the model file or WASM binary.");
      }
      
      throw error;
    }
  })();

  try {
    poseLandmarker = await initPromise;
    return poseLandmarker;
  } catch (error) {
    initPromise = null; // Reset promise to allow retries
    throw error;
  }
};

export const getPoseLandmarker = () => poseLandmarker;