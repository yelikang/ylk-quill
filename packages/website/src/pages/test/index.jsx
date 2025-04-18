import { useLayoutEffect, useRef } from 'react';

function Render() {
  const editorRef = useRef(null);

  useLayoutEffect(() => {
    const quill = new window.Quill(editorRef.current, {
      theme: 'snow',
    });
  }, []);

  return <div ref={editorRef}></div>;
}

export default Render;
