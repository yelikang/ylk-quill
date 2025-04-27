import { useLayoutEffect, useRef } from 'react';

function Render() {
  const editorRef = useRef(null);

  useLayoutEffect(() => {
    const quill = new window.Quill(editorRef.current, {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ header: ['1', '2', '3', false] }],
          ['bold', 'italic', 'underline', 'link'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['clean'],
          ['image', 'code-block'],
        ],
      },
    });
    window.quill1 = quill;

    quill.on('text-change', (delta, oldDelta, source) => {
      console.log(delta, oldDelta, source);
    });
  }, []);

  return <div ref={editorRef}></div>;
}

export default Render;
