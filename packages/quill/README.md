# Quill

This is the main package of Quill.

parchment单词的原意是“羊皮纸”，他是Quill的文档模型，抽象出了一套文本编辑器中操作DOM的数据结构，一个parchment tree由Blots(字迹、墨水，就像是羊皮纸上要用墨水写上字)组成，blot提供了构建DOM、格式化、增添内容等基础功能。

简单来说，Blot就是一个封装了DOM操作的抽象对象。（为羊皮纸上的墨渍）

# 架构分层

```mermaid
graph TD
   A[Delta：数据层,负责数据描述]
   B[Parchment/blots：控制层，负责操控dom，将数据变化转换为dom,delta 到 domnode]
   C[Formats：格式层]
   D[Modules：模块化层，负责解耦各项功能，管控各个模块]
```

# 目录结构

## blots > 文档结构元素，文档模型基础构建块

分类：块元素、内联元素、内嵌元素...
blot对象：
{
domNode: HTMLElement, 每个blot都有domNode，对应实际的dom元素
children: LinkedList<Blot>
parent: Blot | null 父blot
previous: Blot | null 前一个blot
next: Blot | null 后一个blot
scroll: 根blot
}

## core > 核心代码

scroll(理解为卷轴, scrollBlot为根blot) -> 维护blot的层级关系 children： LinkedList<Blot>、进行dom的更新
editor -> 维护delta数据

## formats > 格式?

粗体、斜体...

## modules > 各种功能模块

工具栏、历史记录、键盘、上传...

## themes > 主题

## ui > 各种UI组件

颜色选择器...

## 源码

### 初始化

1. 构建options，根据注册的模块、用户传入的options进行配置合并
2. 构建this.scroll对象，核心是会对this.domNode 进行MutationObserver，监听dom变化，并进行更新
3. 构建this.editor对象，核心是quill中监听各种变化后，调用this.editor相关方法进行update/format...，从而进行delta的数据更新(最终会调用this.scroll进行dom的更新)
4. 构建this.selection对象，处理selection/range
5. 构建this.composition对象，处理composition 输入法编辑状态
6. 构建this.theme对象，初始化主题
7. theme添加keyboard，处理键盘事件
8. theme添加clipboard，处理剪贴板事件
9. theme添加history，处理历史记录
10. theme添加uploader，处理上传事件
11. theme添加input，处理输入事件
12. theme添加uiNode，处理ui节点

### 运行阶段

1. scroll通过MutationObserver监听dom变化，触发update(SCROLL_UPDATE), quill中监听SCROLL_UPDATE，然后调用this.editor.update进行delta的更新
   (Parchment是Delta到DOM的映射)
2. 然后调用scroll，更新blot

### 参照:
[quill 源码](https://juejin.cn/post/6957219459421437966)

![架构图](https://pic3.zhimg.com/v2-cfd3bc00c99849907153f2b1c5bf5b8e_r.jpg)
![运行流程图](https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/496066678d3c481abcd676ab805786ab~tplv-k3u1fbpfcp-zoom-in-crop-mark:1512:0:0:0.awebp)

### 模块

> keyboard

1. 通过addBinding绑定各种事件到this.bindings对象<key, [handler]>；addBinding会进行normalize处理，将一些shortKey转换成不同平台的快捷键
2. 监听根元素的keydown事件，进行事件处理；根据event.key获取到对应的bindings，然后根据event携带的参数、与各个binging的参数进行对比，复合条件的进行调用handler

> clipboard

1. 通过 addEventListener('copy' | 'cut' | 'paste')
2. 通过this.quill进行内容的删除、插入、格式化等操作

> history

1. 监听this.quill的EDITOR_CHANGE事件，记录undo/redo的stack
2. 通过this.quill.keyboard.addBinding绑定ctrl+z/y事件，进行undo/redo处理

### 抽象DOM：Parchment、blot关系维护

### 数据模型delta，维护、对比逻辑

demo:
查看数据更新流程，研究delta维护、blot层级关系及dom更新流程

1. api驱动 quill1.formatText(0, 4, { bold: true }) -> formatText逻辑

不要关注实际dom元素的渲染，例如 <strong>123</strong>，这些都是通过delta数据进行转换的，实际数据都是文本数据；通过quill1.getText()可以看到

2. 使用quill构建at blot、quick-insert-blot