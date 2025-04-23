import { useLayoutEffect, useRef } from 'react';

function Render() {
  const editorRef = useRef(null);

  useLayoutEffect(() => {
    const quill = new window.Quill(editorRef.current, {
      theme: 'snow',
    });

    quill.on('text-change', (delta, oldDelta, source) => {
      console.log(delta, oldDelta, source);
    });
  }, []);

  return <div ref={editorRef}></div>;
}

export default Render;
