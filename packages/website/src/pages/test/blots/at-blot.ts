import { Scroll, LeafBlot } from 'quill';

class AtBlot extends LeafBlot {
  public static tagName = 'span';
  public static className = 'ql-at';

  public value: string = '';

  public static register() {
    // Quill.register(AtBlot);
    console.log('AtBlot register');
  }

  public static create(value: string) {
    const node = super.create();
    node.setAttribute('contenteditable', 'false');
    return node;
  }

  constructor(scroll: Scroll, value: string) {
    super(scroll);
    this.value = value;

    // 监听 keyboard.addBinding({})
  }

  public update(value: string) {
    this.value = value;
  }
}
