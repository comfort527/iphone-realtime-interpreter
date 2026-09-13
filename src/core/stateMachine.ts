export type AppState = 'IDLE' | 'REQUESTING_PERMISSION' | 'LISTENING' | 'PROCESSING' | 'AIRPODS_PLAYING' | 'SPEAKER_PLAYING' | 'COOLDOWN' | 'NETWORK_LOST' | 'ROUTE_LOST' | 'INTERRUPTED' | 'ERROR';
const edges: Partial<Record<AppState, AppState[]>> = {
  IDLE: ['REQUESTING_PERMISSION'], REQUESTING_PERMISSION: ['LISTENING'],
  LISTENING: ['PROCESSING'], PROCESSING: ['AIRPODS_PLAYING', 'SPEAKER_PLAYING', 'LISTENING'],
  AIRPODS_PLAYING: ['LISTENING'], SPEAKER_PLAYING: ['COOLDOWN'], COOLDOWN: ['LISTENING'],
  NETWORK_LOST: ['REQUESTING_PERMISSION'], ROUTE_LOST: ['REQUESTING_PERMISSION'],
  INTERRUPTED: ['REQUESTING_PERMISSION'], ERROR: ['REQUESTING_PERMISSION'],
};
const failures: AppState[] = ['NETWORK_LOST', 'ROUTE_LOST', 'INTERRUPTED', 'ERROR'];
export class InterpreterStateMachine extends EventTarget {
  private current: AppState = 'IDLE';
  get state() { return this.current; }
  transition(next: AppState) {
    if (next === this.current) return;
    if (next !== 'IDLE' && !(this.current !== 'IDLE' && failures.includes(next)) && !edges[this.current]?.includes(next))
      throw new Error(`Invalid state transition: ${this.current} → ${next}`);
    const previous = this.current; this.current = next;
    this.dispatchEvent(new CustomEvent('change', { detail: { previous, next } }));
  }
  canUploadMicAudio() { return this.current === 'LISTENING'; }
}
