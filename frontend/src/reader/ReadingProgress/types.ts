export interface ReadingProgressAdapter {
  getProgress(): number;
  restoreProgress(percent: number): void;
  isReady(): boolean;
  onProgressChange?(callback: () => void): () => void;
}

export interface ReadingProgressController {
  getProgress(): number;
  restoreProgress(percent: number): boolean;
  isReady(): boolean;
  markUserScrolled(): void;
  reset(): void;
  hasRestored(): boolean;
  onProgressChange(callback: () => void): () => void;
}
