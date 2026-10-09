const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const catalog = require('../shared/widget-catalog.json');
const { GRID_SIZE, sizeAtScale } = require('../shared/grid.cjs');

const schemaVersion = 2;
const definitions = new Map(catalog.map((item) => [item.typeId, item]));

class WidgetStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'deskisland.json');
    this.state = this.#read();
  }

  list() {
    return this.state.widgets.map((widget) => structuredClone(widget));
  }

  getWeatherEnabled() { return this.state.weatherEnabled; }

  isVisible(widget) { return widget.enabled && (widget.typeId !== 'weather' || this.state.weatherEnabled); }

  setWeatherEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid weather enabled state');
    const previous = this.state.weatherEnabled;
    this.state.weatherEnabled = enabled;
    try { this.#write(); } catch (error) { this.state.weatherEnabled = previous; throw error; }
    return enabled;
  }

  create(typeId, origin = { x: 32, y: 32, width: 1280, monitorId: 'primary' }, variantId, enabled = true) {
    const definition = definitions.get(typeId);
    if (!definition) throw new TypeError(`Unsupported widget type: ${typeId}`);
    if (typeId !== 'weather' && this.state.widgets.some((item) => item.typeId === typeId)) throw new Error('音乐最多创建一个磁贴，请切换现有磁贴的款式');
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid widget enabled state');
    const variant = definition.variants.find((item) => item.id === (variantId ?? definition.variants[0].id));
    if (!variant) throw new TypeError('Invalid widget variant');
    const size = variant.size;

    // Place each tile in a catalog-sized slot so different default sizes never overlap.
    const maxWidth = Math.max(...[...definitions.values()].flatMap((item) => item.variants.map((variant) => variant.size.width)));
    const maxHeight = Math.max(...[...definitions.values()].flatMap((item) => item.variants.map((variant) => variant.size.height)));
    const columns = Math.max(1, Math.floor((origin.width + GRID_SIZE) / (maxWidth + GRID_SIZE)));
    let x = origin.x;
    let y = origin.y;
    let placed = false;
    for (let row = 0; row <= this.state.widgets.length && !placed; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const candidateX = origin.x + column * (maxWidth + GRID_SIZE);
        const candidateY = origin.y + row * (maxHeight + GRID_SIZE);
        const occupied = this.state.widgets.some((item) =>
          candidateX < item.x + item.width && candidateX + size.width > item.x &&
          candidateY < item.y + item.height && candidateY + size.height > item.y);
        if (!occupied) {
          x = candidateX;
          y = candidateY;
          placed = true;
          break;
        }
      }
    }
    const widget = {
      id: randomUUID(),
      enabled,
      typeId,
      variantId: variant.id,
      monitorId: origin.monitorId ?? 'primary',
      x,
      y,
      width: size.width,
      height: size.height,
      groupId: null,
      settings: structuredClone(definition.defaultSettings),
    };
    this.state.widgets.push(widget);
    try { this.#write(); } catch (error) { this.state.widgets.pop(); throw error; }
    return structuredClone(widget);
  }

  setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid widget enabled state');
    const widget = this.state.widgets.find((item) => item.id === id);
    if (!widget) throw new Error('找不到这个磁贴');
    const previous = widget.enabled;
    widget.enabled = enabled;
    try { this.#write(); } catch (error) { widget.enabled = previous; throw error; }
    return structuredClone(widget);
  }

  setVariant(id, variantId, fit = (widget) => widget) {
    const widget = this.state.widgets.find((item) => item.id === id);
    if (!widget) throw new Error('找不到这个磁贴');
    const variant = definitions.get(widget.typeId).variants.find((item) => item.id === variantId);
    if (!variant) throw new TypeError('Invalid widget variant');
    const previous = structuredClone(widget);
    const previousBase=definitions.get(widget.typeId).variants.find(item=>item.id===widget.variantId).size;
    const size=sizeAtScale(variant.size,widget.width/previousBase.width);
    Object.assign(widget, fit({ ...widget,variantId,...size }));
    try { this.#write(); } catch (error) { Object.assign(widget, previous); throw error; }
    return structuredClone(widget);
  }

  updatePosition(id, { x, y, monitorId }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Widget position must be finite');
    const widget = this.state.widgets.find((item) => item.id === id);
    if (!widget) return false;
    const previous = { x: widget.x, y: widget.y, monitorId: widget.monitorId };
    widget.x = Math.round(x);
    widget.y = Math.round(y);
    if (typeof monitorId === 'string') widget.monitorId = monitorId;
    try { this.#write(); } catch (error) { Object.assign(widget, previous); throw error; }
    return true;
  }

  updateBounds(id, bounds, persist = true) {
    const widget=this.state.widgets.find(item=>item.id===id);
    if(!widget) throw new Error('找不到这个磁贴');
    const base=definitions.get(widget.typeId).variants.find(item=>item.id===widget.variantId).size;
    if(!['x','y','width','height'].every(key=>Number.isSafeInteger(bounds[key])) ||
      bounds.width*base.height!==bounds.height*base.width || bounds.width<base.minimumWidth || bounds.width>base.width*2 ||
      bounds.width%GRID_SIZE || bounds.height%GRID_SIZE || typeof bounds.monitorId!=='string') throw new TypeError('Invalid widget bounds');
    const previous=structuredClone(widget);
    Object.assign(widget,{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,monitorId:bounds.monitorId});
    try { if(persist) this.#write(); } catch(error) { Object.assign(widget,previous);throw error; }
    return structuredClone(widget);
  }

  updateSettings(id, patch) {
    const widget = this.state.widgets.find((item) => item.id === id);
    if (!widget) return false;
    const definition = definitions.get(widget.typeId);
    const updates = Object.entries(patch).map(([key, value]) => {
      if (!Object.hasOwn(definition.defaultSettings, key)) throw new TypeError(`Unsupported widget setting: ${key}`);
      return [key, structuredClone(value)];
    });
    const previous=structuredClone(widget.settings);
    for (const [key, value] of updates) widget.settings[key] = value;
    try { this.#write(); } catch(error) {widget.settings=previous;throw error;}
    return true;
  }

  remove(id) {
    const next = this.state.widgets.filter((widget) => widget.id !== id);
    if (next.length === this.state.widgets.length) return false;
    const previous = this.state.widgets;
    this.state.widgets = next;
    try { this.#write(); } catch (error) { this.state.widgets = previous; throw error; }
    return true;
  }

  #read() {
    if (!fs.existsSync(this.filePath)) return { schemaVersion, weatherEnabled: true, widgets: [] };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (![1,schemaVersion].includes(parsed.schemaVersion) || !Array.isArray(parsed.widgets)) {
      throw new Error(`Unsupported or invalid DeskIsland state at ${this.filePath}`);
    }
    if (parsed.weatherEnabled === undefined) parsed.weatherEnabled = true;
    if (typeof parsed.weatherEnabled !== 'boolean') throw new Error('Invalid persisted weather enabled state');
    // Old music tiles used the horizontal layout. Preserve IDs, settings and positions.
    for (const widget of parsed.widgets) {
      if (widget.enabled === undefined) widget.enabled = true;
      if (typeof widget.enabled !== 'boolean') throw new Error('Invalid persisted widget enabled state');
      const definition = definitions.get(widget.typeId);
      if (!definition) throw new Error('Invalid persisted widget type');
      if (!widget.variantId) widget.variantId = widget.typeId === 'music' ? 'wide' : 'standard';
      const variant = definition.variants.find((item) => item.id === widget.variantId);
      if (!variant) throw new Error('Invalid persisted widget variant');
      const valid=Number.isSafeInteger(widget.width) && Number.isSafeInteger(widget.height) &&
        widget.width*variant.size.height===widget.height*variant.size.width &&
        widget.width>=variant.size.minimumWidth && widget.width<=variant.size.width*2 &&
        widget.width%GRID_SIZE===0 && widget.height%GRID_SIZE===0;
      if(!valid && parsed.schemaVersion===schemaVersion) throw new Error('Invalid persisted widget size');
      if(!valid) Object.assign(widget,variant.size);
      if(!Number.isSafeInteger(widget.x) || !Number.isSafeInteger(widget.y)) throw new Error('Invalid persisted widget position');
    }
    parsed.schemaVersion=schemaVersion;
    return parsed;
  }

  #write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }
}

module.exports = { WidgetStore };
