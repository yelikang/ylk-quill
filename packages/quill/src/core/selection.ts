import { LeafBlot, Scope } from 'parchment';
import { cloneDeep, isEqual } from 'lodash-es';
import Emitter from './emitter.js';
import type { EmitterSource } from './emitter.js';
import logger from './logger.js';
import type Cursor from '../blots/cursor.js';
import type Scroll from '../blots/scroll.js';

const debug = logger('quill:selection');

type NativeRange = AbstractRange;

interface NormalizedRange {
  start: {
    node: NativeRange['startContainer'];
    offset: NativeRange['startOffset'];
  };
  end: { node: NativeRange['endContainer']; offset: NativeRange['endOffset'] };
  native: NativeRange;
}

export interface Bounds {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export class Range {
  constructor(
    public index: number,
    public length = 0,
  ) {}
}

/**
 * 选择器，主要负责处理selection、Range
 */
class Selection {
  scroll: Scroll;
  emitter: Emitter;
  composing: boolean;
  mouseDown: boolean;

  root: HTMLElement;
  cursor: Cursor;
  savedRange: Range;
  lastRange: Range | null;
  lastNative: NormalizedRange | null;

  constructor(scroll: Scroll, emitter: Emitter) {
    this.emitter = emitter;
    this.scroll = scroll;
    this.composing = false;
    this.mouseDown = false;
    this.root = this.scroll.domNode;
    // @ts-expect-error
    this.cursor = this.scroll.create('cursor', this);
    // savedRange is last non-null range
    this.savedRange = new Range(0, 0);
    this.lastRange = this.savedRange;
    this.lastNative = null;
    // 处理输入法编辑状态
    this.handleComposition();
    // 处理拖拽状态
    this.handleDragging();
    this.emitter.listenDOM('selectionchange', document, () => {
      if (!this.mouseDown && !this.composing) {
        setTimeout(this.update.bind(this, Emitter.sources.USER), 1);
      }
    });
    this.emitter.on(Emitter.events.SCROLL_BEFORE_UPDATE, () => {
      if (!this.hasFocus()) return;
      const native = this.getNativeRange();
      if (native == null) return;
      if (native.start.node === this.cursor.textNode) return; // cursor.restore() will handle
      this.emitter.once(
        Emitter.events.SCROLL_UPDATE,
        (source, mutations: MutationRecord[]) => {
          try {
            if (
              this.root.contains(native.start.node) &&
              this.root.contains(native.end.node)
            ) {
              this.setNativeRange(
                native.start.node,
                native.start.offset,
                native.end.node,
                native.end.offset,
              );
            }
            const triggeredByTyping = mutations.some(
              (mutation) =>
                mutation.type === 'characterData' ||
                mutation.type === 'childList' ||
                (mutation.type === 'attributes' &&
                  mutation.target === this.root),
            );
            this.update(triggeredByTyping ? Emitter.sources.SILENT : source);
          } catch (ignored) {
            // ignore
          }
        },
      );
    });
    this.emitter.on(Emitter.events.SCROLL_OPTIMIZE, (mutations, context) => {
      if (context.range) {
        const { startNode, startOffset, endNode, endOffset } = context.range;
        this.setNativeRange(startNode, startOffset, endNode, endOffset);
        this.update(Emitter.sources.SILENT);
      }
    });
    this.update(Emitter.sources.SILENT);
  }

  handleComposition() {
    this.emitter.on(Emitter.events.COMPOSITION_BEFORE_START, () => {
      this.composing = true;
    });
    this.emitter.on(Emitter.events.COMPOSITION_END, () => {
      this.composing = false;
      if (this.cursor.parent) {
        const range = this.cursor.restore();
        if (!range) return;
        setTimeout(() => {
          this.setNativeRange(
            range.startNode,
            range.startOffset,
            range.endNode,
            range.endOffset,
          );
        }, 1);
      }
    });
  }

  handleDragging() {
    this.emitter.listenDOM('mousedown', document.body, () => {
      this.mouseDown = true;
    });
    this.emitter.listenDOM('mouseup', document.body, () => {
      this.mouseDown = false;
      this.update(Emitter.sources.USER);
    });
  }

  focus() {
    if (this.hasFocus()) return;
    this.root.focus({ preventScroll: true });
    this.setRange(this.savedRange);
  }

  format(format: string, value: unknown) {
    this.scroll.update();
    const nativeRange = this.getNativeRange();
    if (
      nativeRange == null ||
      !nativeRange.native.collapsed ||
      this.scroll.query(format, Scope.BLOCK)
    )
      return;
    if (nativeRange.start.node !== this.cursor.textNode) {
      const blot = this.scroll.find(nativeRange.start.node, false);
      if (blot == null) return;
      // TODO Give blot ability to not split
      if (blot instanceof LeafBlot) {
        const after = blot.split(nativeRange.start.offset);
        blot.parent.insertBefore(this.cursor, after);
      } else {
        // @ts-expect-error TODO: nativeRange.start.node doesn't seem to match function signature
        blot.insertBefore(this.cursor, nativeRange.start.node); // Should never happen
      }
      this.cursor.attach();
    }
    this.cursor.format(format, value);
    this.scroll.optimize();
    this.setNativeRange(this.cursor.textNode, this.cursor.textNode.data.length);
    this.update();
  }

  getBounds(index: number, length = 0) {
    const scrollLength = this.scroll.length();
    index = Math.min(index, scrollLength - 1);
    length = Math.min(index + length, scrollLength - 1) - index;
    let node: Node;
    let [leaf, offset] = this.scroll.leaf(index);
    if (leaf == null) return null;
    if (length > 0 && offset === leaf.length()) {
      const [next] = this.scroll.leaf(index + 1);
      if (next) {
        const [line] = this.scroll.line(index);
        const [nextLine] = this.scroll.line(index + 1);
        if (line === nextLine) {
          leaf = next;
          offset = 0;
        }
      }
    }
    [node, offset] = leaf.position(offset, true);
    const range = document.createRange();
    if (length > 0) {
      range.setStart(node, offset);
      [leaf, offset] = this.scroll.leaf(index + length);
      if (leaf == null) return null;
      [node, offset] = leaf.position(offset, true);
      range.setEnd(node, offset);
      return range.getBoundingClientRect();
    }
    let side: 'left' | 'right' = 'left';
    let rect: DOMRect;
    if (node instanceof Text) {
      // Return null if the text node is empty because it is
      // not able to get a useful client rect:
      // https://github.com/w3c/csswg-drafts/issues/2514.
      // Empty text nodes are most likely caused by TextBlot#optimize()
      // not getting called when editor content changes.
      if (!node.data.length) {
        return null;
      }
      if (offset < node.data.length) {
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
      } else {
        range.setStart(node, offset - 1);
        range.setEnd(node, offset);
        side = 'right';
      }
      rect = range.getBoundingClientRect();
    } else {
      if (!(leaf.domNode instanceof Element)) return null;
      rect = leaf.domNode.getBoundingClientRect();
      if (offset > 0) side = 'right';
    }
    return {
      bottom: rect.top + rect.height,
      height: rect.height,
      left: rect[side],
      right: rect[side],
      top: rect.top,
      width: 0,
    };
  }

  getNativeRange(): NormalizedRange | null {
    const selection = document.getSelection();
    if (selection == null || selection.rangeCount <= 0) return null;
    const nativeRange = selection.getRangeAt(0);
    if (nativeRange == null) return null;
    const range = this.normalizeNative(nativeRange);
    debug.info('getNativeRange', range);
    return range;
  }

  getRange(): [Range, NormalizedRange] | [null, null] {
    const root = this.scroll.domNode;
    if ('isConnected' in root && !root.isConnected) {
      // document.getSelection() forces layout on Blink, so we trend to
      // not calling it.
      return [null, null];
    }
    const normalized = this.getNativeRange();
    if (normalized == null) return [null, null];
    const range = this.normalizedToRange(normalized);
    return [range, normalized];
  }

  /**
   * 判断是否已经聚焦
   */
  hasFocus(): boolean {
    return (
      document.activeElement === this.root ||
      (document.activeElement != null &&
        contains(this.root, document.activeElement))
    );
  }

  /**
   * 计算Range区域（重点）
   * @param range 
   * @returns 
   */
  normalizedToRange(range: NormalizedRange) {
    const positions: [Node, number][] = [
      [range.start.node, range.start.offset],
    ];
    if (!range.native.collapsed) {
      // 如果选区不是collapsed(没有折叠,框选区域)，则将选区结束位置添加到positions中
      positions.push([range.end.node, range.end.offset]);
    }
    const indexes = positions.map((position) => {
      const [node, offset] = position;
      const blot = this.scroll.find(node, true);
      // @ts-expect-error Fix me later
      // 当前blot相对于scroll的偏移量(字符偏移个数，不是元素偏移个数)
      const index = blot.offset(this.scroll);
      if (offset === 0) {
        // 元素内没有偏移，直接返回scroll的偏移
        return index;
      }
      if (blot instanceof LeafBlot) {
        // 在scroll的偏移量 + 当前光标在当前node中的偏移量 = 起始位置
        return index + blot.index(node, offset);
      }
      // @ts-expect-error Fix me later
      return index + blot.length();
    });
    // 结束位置(最小值)
    const end = Math.min(Math.max(...indexes), this.scroll.length() - 1);
    // 开始位置(最小值)
    const start = Math.min(end, ...indexes);
    // 返回start、length
    return new Range(start, end - start);
  }

  /**
   * 标准化原生range
   * @param nativeRange 
   * @returns 
   */
  normalizeNative(nativeRange: NativeRange) {
    // 检查边界，选区是否在编辑器范围内
    if (
      !contains(this.root, nativeRange.startContainer) ||
      (!nativeRange.collapsed && !contains(this.root, nativeRange.endContainer))
    ) {
      return null;
    }
    const range = {
      start: {
        node: nativeRange.startContainer,
        offset: nativeRange.startOffset,
      },
      end: { node: nativeRange.endContainer, offset: nativeRange.endOffset },
      native: nativeRange,
    };
    // 将选区位置转换为最底层的文本节点
    [range.start, range.end].forEach((position) => {
      let { node, offset } = position;
      // 如果node不是text，并且有子节点
      // 当node不是text时，基本上就是P或者span这种内联元素，这种元素作为node就是全量选择，那就一直向下取第一个text元素，并且将offset设置为0
      // 始终都转换为最后的一个叶子节点
      while (!(node instanceof Text) && node.childNodes.length > 0) {
        if (node.childNodes.length > offset) {
          // 1. offset小于节点数，选择offst位置的子节点
          node = node.childNodes[offset];
          offset = 0;
        } else if (node.childNodes.length === offset) {
          // 2. offset等于节点数，取最后一个子节点
          // @ts-expect-error Fix me later
          node = node.lastChild;
          if (node instanceof Text) {
            offset = node.data.length;
          } else if (node.childNodes.length > 0) {
            // Container case
            offset = node.childNodes.length;
          } else {
            // Embed case
            offset = node.childNodes.length + 1;
          }
        } else {
          // 3. offset大于节点数，保持原样
          break;
        }
      }
      position.node = node;
      position.offset = offset;
    });
    return range;
  }

  rangeToNative(range: Range): [Node | null, number, Node | null, number] {
    const scrollLength = this.scroll.length();

    const getPosition = (
      index: number,
      inclusive: boolean,
    ): [Node | null, number] => {
      index = Math.min(scrollLength - 1, index);
      const [leaf, leafOffset] = this.scroll.leaf(index);
      return leaf ? leaf.position(leafOffset, inclusive) : [null, -1];
    };
    return [
      ...getPosition(range.index, false),
      ...getPosition(range.index + range.length, true),
    ];
  }

  setNativeRange(
    startNode: Node | null,
    startOffset?: number,
    endNode = startNode,
    endOffset = startOffset,
    force = false,
  ) {
    debug.info('setNativeRange', startNode, startOffset, endNode, endOffset);
    if (
      startNode != null &&
      (this.root.parentNode == null ||
        startNode.parentNode == null ||
        // @ts-expect-error Fix me later
        endNode.parentNode == null)
    ) {
      return;
    }
    const selection = document.getSelection();
    if (selection == null) return;
    if (startNode != null) {
      if (!this.hasFocus()) this.root.focus({ preventScroll: true });
      const { native } = this.getNativeRange() || {};
      if (
        native == null ||
        force ||
        startNode !== native.startContainer ||
        startOffset !== native.startOffset ||
        endNode !== native.endContainer ||
        endOffset !== native.endOffset
      ) {
        if (startNode instanceof Element && startNode.tagName === 'BR') {
          // @ts-expect-error Fix me later
          startOffset = Array.from(startNode.parentNode.childNodes).indexOf(
            startNode,
          );
          startNode = startNode.parentNode;
        }
        if (endNode instanceof Element && endNode.tagName === 'BR') {
          // @ts-expect-error Fix me later
          endOffset = Array.from(endNode.parentNode.childNodes).indexOf(
            endNode,
          );
          endNode = endNode.parentNode;
        }
        const range = document.createRange();
        // @ts-expect-error Fix me later
        range.setStart(startNode, startOffset);
        // @ts-expect-error Fix me later
        range.setEnd(endNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      selection.removeAllRanges();
      this.root.blur();
    }
  }

  setRange(range: Range | null, force: boolean, source?: EmitterSource): void;
  setRange(range: Range | null, source?: EmitterSource): void;
  setRange(
    range: Range | null,
    force: boolean | EmitterSource = false,
    source: EmitterSource = Emitter.sources.API,
  ): void {
    if (typeof force === 'string') {
      source = force;
      force = false;
    }
    debug.info('setRange', range);
    if (range != null) {
      const args = this.rangeToNative(range);
      this.setNativeRange(...args, force);
    } else {
      this.setNativeRange(null);
    }
    this.update(source);
  }

  update(source: EmitterSource = Emitter.sources.USER) {
    const oldRange = this.lastRange;
    const [lastRange, nativeRange] = this.getRange();
    this.lastRange = lastRange;
    this.lastNative = nativeRange;
    if (this.lastRange != null) {
      this.savedRange = this.lastRange;
    }
    if (!isEqual(oldRange, this.lastRange)) {
      if (
        !this.composing &&
        nativeRange != null &&
        nativeRange.native.collapsed &&
        nativeRange.start.node !== this.cursor.textNode
      ) {
        const range = this.cursor.restore();
        if (range) {
          this.setNativeRange(
            range.startNode,
            range.startOffset,
            range.endNode,
            range.endOffset,
          );
        }
      }
      const args = [
        Emitter.events.SELECTION_CHANGE,
        cloneDeep(this.lastRange),
        cloneDeep(oldRange),
        source,
      ];
      this.emitter.emit(Emitter.events.EDITOR_CHANGE, ...args);
      if (source !== Emitter.sources.SILENT) {
        this.emitter.emit(...args);
      }
    }
  }
}

/**
 * 子孙节点是否在父节点中
 * @param parent 父节点
 * @param descendant 子孙节点
 * @returns 
 */
function contains(parent: Node, descendant: Node) {
  try {
    // Firefox inserts inaccessible nodes around video elements
    // 这里访问一下parendNode，处理firefox特殊情况，在包含视频元素时；会像其周围插入特殊的不可访问节点
    descendant.parentNode; // eslint-disable-line @typescript-eslint/no-unused-expressions
  } catch (e) {
    return false;
  }
  return parent.contains(descendant);
}

export default Selection;
