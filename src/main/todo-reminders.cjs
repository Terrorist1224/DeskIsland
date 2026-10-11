const { performance } = require('node:perf_hooks');

// Main-process one-shot deadlines; delivery state is persisted before displaying the overlay.
class TodoReminders {
  constructor({ store, onDue, onChange, onError, now = Date.now, monotonic = () => performance.now() }) {
    Object.assign(this, { store, onDue, onChange, onError, now, monotonic });
    this.blockers = new Set();
    this.lastWall = now();
    this.lastMono = monotonic();
  }

  start() {
    this.reconcile();
    this.timer = setInterval(() => this.tick(), 250);
  }

  // Reopening/startup never delivers a past reminder, even between timer ticks.
  reconcile(widgetId) {
    const now = this.now();
    for (const widget of this.store.list().filter(item => item.typeId === 'todo' && (!widgetId || item.id === widgetId))) {
      const states = new Map(widget.settings.items.filter(item => item.reminderState === 'pending' && item.remindAt <= now).map(item => [item.id, 'missed']));
      if (states.size) this.#save(widget.id, states);
    }
  }

  setBlocked(reason, blocked) {
    if (blocked) this.blockers.add(reason);
    // Skip past deadlines before removing the last lock/suspend blocker.
    this.reconcile();
    if (!blocked) this.blockers.delete(reason);
    this.lastWall = this.now();
    this.lastMono = this.monotonic();
  }

  tick() {
    const now = this.now(), mono = this.monotonic();
    const elapsed = now - this.lastWall;
    // A gap >2s or a wall-clock jump is a missed deadline, not a catch-up alarm.
    const continuous = elapsed >= 0 && elapsed <= 2000 && Math.abs(elapsed - (mono - this.lastMono)) < 1000;
    const from = this.lastWall;
    this.lastWall = now;
    this.lastMono = mono;
    for (const widget of this.store.list().filter(item => item.typeId === 'todo')) {
      const due = widget.settings.items.filter(item => item.reminderState === 'pending' && item.remindAt <= now);
      if (!due.length) continue;
      const notified = due.filter(item => widget.enabled && !this.blockers.size && continuous && item.remindAt > from);
      const ids = new Set(notified.map(item => item.id));
      if (!this.#save(widget.id, new Map(due.map(item => [item.id, ids.has(item.id) ? 'notified' : 'missed'])))) continue;
      if (notified.length) {
        try { this.onDue(notified); }
        catch (error) {
          this.#save(widget.id, new Map(notified.map(item => [item.id, 'missed'])));
          this.onError(error);
        }
      }
    }
  }

  #save(id, states) {
    try { this.store.setTodoReminderStates(id, states); }
    catch (error) { this.onError(error);return false; }
    try { this.onChange(id); } catch(error) { this.onError(error); }
    return true;
  }

  close() { clearInterval(this.timer);this.timer = undefined; }
}

module.exports = { TodoReminders };
