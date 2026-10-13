const { validateDuration } = require('../shared/countdown.cjs');
const colors = require('../shared/todo-colors.json');
const { randomInt } = require('node:crypto');

// Runtime deadlines belong to this app session; wall time includes Windows suspend.
class Countdown {
  constructor({ onDue, onChange, onError, now = Date.now }) {
    Object.assign(this, { onDue, onChange, onError, now });
    this.states = new Map();this.blockers = new Set();
  }
  get(id) { return structuredClone(this.states.get(id) ?? { status: 'idle', seconds: 0, name: '', remainingMs: 0, deadline: null, color: colors[2].value }); }
  start(id, seconds, name = '') {
    validateDuration(seconds);
    if (this.get(id).status !== 'idle') throw new Error('请先取消当前倒计时');
    this.states.set(id, { status: 'running', seconds, name, remainingMs: seconds * 1000, deadline: this.now() + seconds * 1000, color: colors[randomInt(colors.length)].value });
    this.syncTimer();this.onChange(id);return this.get(id);
  }
  pause(id) {
    this.tick();
    const state = this.states.get(id);
    if (state?.status === 'running') { state.remainingMs = Math.max(0, state.deadline - this.now());state.deadline = null;state.status = 'paused';this.onChange(id); }
    this.syncTimer();return this.get(id);
  }
  resume(id) {
    const state = this.states.get(id);
    if (state?.status === 'paused') { state.deadline = this.now() + state.remainingMs;state.status = 'running';this.onChange(id); }
    this.syncTimer();return this.get(id);
  }
  cancel(id) { this.states.delete(id);this.syncTimer();this.onChange(id);return this.get(id); }
  setBlocked(reason, blocked) { if (blocked) this.blockers.add(reason);else this.blockers.delete(reason);this.tick();this.syncTimer(); }
  tick() {
    if (this.blockers.size) return;
    for (const [id, state] of this.states) {
      if (state.status !== 'running' || state.deadline > this.now()) continue;
      state.status = 'finished';state.remainingMs = 0;state.deadline = null;
      try {
        this.onDue(id);
      } catch (error) { this.onError(error); }
      try { this.onChange(id, true); } catch (error) { this.onError(error); }
    }
    this.syncTimer();
  }
  syncTimer() {
    const active=this.opened&&!this.blockers.size&&[...this.states.values()].some(state=>state.status==='running');
    if(active&&!this.timer) this.timer=setInterval(()=>this.tick(),250);
    else if(!active) {clearInterval(this.timer);this.timer=undefined;}
  }
  open() { this.opened=true;this.syncTimer(); }
  close() { this.opened=false;clearInterval(this.timer);this.timer=undefined;this.states.clear(); }
}
module.exports = { Countdown };
