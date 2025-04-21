import { EventEmitter } from 'eventemitter3';
import instances from './instances.js';
import logger from './logger.js';

const debug = logger('quill:events');
const EVENTS = ['selectionchange', 'mousedown', 'mouseup', 'click'];

EVENTS.forEach((eventName) => {
  // 事件委托给document
  document.addEventListener(eventName, (...args) => {
    // 获取所有的ql-container元素
    Array.from(document.querySelectorAll('.ql-container')).forEach((node) => {
      // 获取元素对应的quill实例
      const quill = instances.get(node);
      if (quill && quill.emitter) {
        // 处理事件
        quill.emitter.handleDOM(...args);
      }
    });
  });
});

class Emitter extends EventEmitter<string> {
  static events = {
    EDITOR_CHANGE: 'editor-change',
    SCROLL_BEFORE_UPDATE: 'scroll-before-update',
    SCROLL_BLOT_MOUNT: 'scroll-blot-mount',
    SCROLL_BLOT_UNMOUNT: 'scroll-blot-unmount',
    SCROLL_OPTIMIZE: 'scroll-optimize',
    SCROLL_UPDATE: 'scroll-update',
    SCROLL_EMBED_UPDATE: 'scroll-embed-update',
    SELECTION_CHANGE: 'selection-change',
    TEXT_CHANGE: 'text-change',
    COMPOSITION_BEFORE_START: 'composition-before-start',
    COMPOSITION_START: 'composition-start',
    COMPOSITION_BEFORE_END: 'composition-before-end',
    COMPOSITION_END: 'composition-end',
  } as const;

  static sources = {
    API: 'api',
    SILENT: 'silent',
    USER: 'user',
  } as const;

  protected domListeners: Record<string, { node: Node; handler: Function }[]>;

  constructor() {
    super();
    this.domListeners = {};
    this.on('error', debug.error);
  }

  emit(...args: unknown[]): boolean {
    debug.log.call(debug, ...args);
    // @ts-expect-error
    return super.emit(...args);
  }

  handleDOM(event: Event, ...args: unknown[]) {
    (this.domListeners[event.type] || []).forEach(({ node, handler }) => {
      // 遍历dom元素的事件，如果与listenDOM中监听的dom相同，则执行handler
      if (event.target === node || node.contains(event.target as Node)) {
        handler(event, ...args);
      }
    });
  }

  listenDOM(eventName: string, node: Node, handler: EventListener) {
    if (!this.domListeners[eventName]) {
      this.domListeners[eventName] = [];
    }
    this.domListeners[eventName].push({ node, handler });
  }
}

export type EmitterSource =
  (typeof Emitter.sources)[keyof typeof Emitter.sources];

export default Emitter;
