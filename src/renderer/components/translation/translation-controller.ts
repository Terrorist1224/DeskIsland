import type { DesktopIslandBridge, TranslationDraft, TranslationSnapshot } from '../../../shared/contracts';

type Bridge = Pick<DesktopIslandBridge, 'getTranslation' | 'updateTranslation' | 'translate' | 'cancelTranslation'>;
export class TranslationController {
  state: TranslationSnapshot = { provider: 'ai', target: 'auto', text: '', result: '', error: '', revision: 0, status: 'idle' };
  private sequence = 0;
  private disposed = false;
  private bridge: Bridge;
  private changed: (state: TranslationSnapshot) => void;
  constructor(bridge: Bridge, changed: (state: TranslationSnapshot) => void) { this.bridge = bridge; this.changed = changed; }
  private publish(state: TranslationSnapshot) { this.state = state; this.changed({ ...state }); }
  private stop() { return ++this.sequence; }
  async load() {
    const sequence = this.stop();
    try {
      const state = await this.bridge.getTranslation();
      if (!this.disposed && sequence === this.sequence) this.publish(state);
    } catch { if (!this.disposed && sequence === this.sequence) this.publish({ ...this.state, status: 'error', error: '读取翻译内容失败，请重新开启磁贴' }); }
  }
  async change(input: TranslationDraft) {
    if (this.disposed) return null;
    const sequence = this.stop();
    this.publish({ ...this.state, ...input, result: '', error: '', status: 'idle' });
    try {
      const state = await this.bridge.updateTranslation(input);
      if (!this.disposed && sequence === this.sequence) this.publish(state);
      return state;
    } catch {
      if (!this.disposed && sequence === this.sequence) this.publish({ ...this.state, status: 'error', error: '保存翻译会话失败，请重试' });
      return null;
    }
  }
  async submit(input: TranslationDraft) {
    if (this.disposed || this.state.status === 'loading' || !input.text.trim()) return;
    const update = this.change(input), sequence = this.sequence;
    const state = await update;
    if (!state || this.disposed || sequence !== this.sequence || state.status === 'error') return;
    this.publish({ ...this.state, status: 'loading', error: '' });
    try {
      const result = await this.bridge.translate(state.revision);
      if (!this.disposed && sequence === this.sequence) this.publish(result);
    } catch { if (!this.disposed && sequence === this.sequence) this.publish({ ...this.state, status: 'error', error: '翻译请求失败，请重试' }); }
  }
  pause() {
    this.stop();
    void this.bridge.cancelTranslation().catch(() => {});
    if (!this.disposed && this.state.status === 'loading') this.publish({ ...this.state, status: 'idle' });
  }
  dispose() { this.disposed = true; this.pause(); }
}
