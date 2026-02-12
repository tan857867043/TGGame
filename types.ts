export enum GameState {
  MENU = 'MENU',
  LOADING_MODEL = 'LOADING_MODEL',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER'
}

export enum GameType {
  DODGE = 'DODGE',
  CATCH = 'CATCH',
  SABER = 'SABER'
}

export interface Point {
  x: number;
  y: number;
}

export interface GameObject {
  id: string;
  x: number;
  y: number;
  type: 'good' | 'bad' | 'gold' | 'freeze';
  width: number;
  height: number;
  speed: number;
}