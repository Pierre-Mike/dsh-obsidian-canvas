/**
 * Client half of the Obsidian canvas bundle: a JSON Canvas 1.0 editor that
 * opens `.canvas` files in the right Sidebar document preview. It renders text,
 * file, link, and group nodes and their edges the way Obsidian Canvas does, and
 * saves edits through the Host half's authenticated save route.
 *
 * Spec: https://jsoncanvas.org/spec/1.0/
 */
window.__ModuleLoader__.load({
  id: '@local/obsidian-canvas',
  factory(require) {
    const React = require('react')
    const { createElement: h, Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React

    const BODY_ID = '@local/obsidian-canvas/canvas'
    const NS = 'obsidianCanvas'
    const SAVE_ROUTE = 'obsidian-canvas/save'
    const VAULT_ROUTE = 'obsidian-canvas/vault'
    const FILE_ROUTE = 'obsidian-canvas/file'

    const GRID = 20
    const MIN_ZOOM = 0.05
    const MAX_ZOOM = 4
    const MIN_NODE = 40
    const ARROW = 12
    const DRAG_THRESHOLD = 4
    const SAVE_DELAY_MS = 400
    const HISTORY_LIMIT = 200
    const SIDES = ['top', 'right', 'bottom', 'left']
    const DIRECTION = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }

    /** Obsidian's six preset colors, light and dark theme values. */
    const PRESET_COLORS = {
      1: 'light-dark(#e93147, #fb464c)',
      2: 'light-dark(#ec7500, #e9973f)',
      3: 'light-dark(#e0ac00, #e0de71)',
      4: 'light-dark(#08b94e, #44cf6e)',
      5: 'light-dark(#00bfbc, #53dfdd)',
      6: 'light-dark(#7852ee, #a882ff)',
    }
    const COLOR_KEYS = ['1', '2', '3', '4', '5', '6']
    const COLOR_NAMES = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green', 5: 'cyan', 6: 'purple' }

    const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])
    const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv'])
    const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac'])
    const TEXT_EXTENSIONS = new Set(['md', 'txt'])

    /** Pan and zoom per open file, kept across remounts of the same tab. */
    const savedViews = new Map()
    /** Copied nodes and edges, shared by every open canvas. */
    let clipboard = null

    // ---------------------------------------------------------------- locale

    const EN = {
      title: 'Obsidian canvas',
      loading: 'Loading canvas...',
      invalid: 'This file is not a valid JSON Canvas document: {message}',
      invalidHint: 'Choose Plain text in the viewer menu to see the raw file.',
      readOnly: 'Read-only: this host cannot save the file',
      saving: 'Saving...',
      saveFailed: 'Could not save: {message}',
      retry: 'Retry',
      conflict: 'This canvas changed on disk while you had unsaved edits.',
      loadDisk: 'Load disk version',
      keepMine: 'Keep my version',
      emptyHint: 'Double-click to add a card, or drag one from the toolbar below.',
      addCard: 'Add card',
      addNote: 'Add note from vault',
      addMedia: 'Add media from vault',
      addLink: 'Add web page',
      addGroup: 'Add group',
      dragHint: '{action} (click, or drag onto the canvas)',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      zoomReset: 'Reset zoom',
      zoomFit: 'Zoom to fit',
      zoomSelection: 'Zoom to selection',
      undo: 'Undo',
      redo: 'Redo',
      settings: 'Canvas settings',
      snap: 'Snap to grid',
      help: 'Keyboard shortcuts',
      remove: 'Remove',
      color: 'Set color',
      noColor: 'No color',
      customColor: 'Custom color',
      edit: 'Edit',
      editLabel: 'Edit label',
      createGroup: 'Create group',
      direction: 'Line direction',
      directionNone: 'No arrows',
      directionEnd: 'Arrow at end',
      directionBoth: 'Arrows at both ends',
      bringFront: 'Bring to front',
      sendBack: 'Send to back',
      selectAll: 'Select all',
      duplicate: 'Duplicate',
      copy: 'Copy',
      paste: 'Paste',
      openLink: 'Open in browser',
      searchVault: 'Search files in the vault',
      searchMedia: 'Search media in the vault',
      vaultLoading: 'Listing vault files...',
      noMatches: 'No matching files',
      vaultFailed: 'Could not list vault files: {message}',
      vaultTruncated: 'Showing the first {count} files of the vault',
      linkPrompt: 'Web page URL',
      groupPrompt: 'Group name',
      add: 'Add',
      cancel: 'Cancel',
      invalidUrl: 'Enter an http or https URL',
      fileMissing: 'File not found: {file}',
      fileFailed: 'Could not load {file}: {message}',
      unsupportedFile: 'No preview for this file type',
      interact: 'Double-click to interact',
      edgeLabel: 'Label',
      red: 'Red',
      orange: 'Orange',
      yellow: 'Yellow',
      green: 'Green',
      cyan: 'Cyan',
      purple: 'Purple',
      keyPan: 'Pan: scroll, Space + drag, or middle-drag',
      keyZoom: 'Zoom: Ctrl/Cmd + scroll, or pinch',
      keyCard: 'New card: double-click the canvas',
      keyEdit: 'Edit card: double-click, or Enter',
      keySelect: 'Select: click, Shift + click, or drag a box',
      keyConnect: 'Connect: drag from a dot on a card side',
      keyDuplicate: 'Duplicate: Alt + drag, or Cmd/Ctrl + D',
      keyDelete: 'Remove: Delete or Backspace',
      keyUndo: 'Undo / redo: Cmd/Ctrl + Z, Cmd/Ctrl + Shift + Z',
      keyFit: 'Zoom to fit: Shift + 1. Zoom to selection: Shift + 2',
    }

    const ZH = {
      title: 'Obsidian 白板',
      loading: '正在加载白板...',
      invalid: '此文件不是有效的 JSON Canvas 文档：{message}',
      invalidHint: '在查看器菜单中选择纯文本可查看原始文件。',
      readOnly: '只读：此主机无法保存该文件',
      saving: '正在保存...',
      saveFailed: '无法保存：{message}',
      retry: '重试',
      conflict: '在你有未保存的修改时，此白板已在磁盘上被修改。',
      loadDisk: '加载磁盘版本',
      keepMine: '保留我的版本',
      emptyHint: '双击添加卡片，或从下方工具栏拖入。',
      addCard: '添加卡片',
      addNote: '从库中添加笔记',
      addMedia: '从库中添加媒体',
      addLink: '添加网页',
      addGroup: '添加分组',
      dragHint: '{action}（点击，或拖到白板上）',
      zoomIn: '放大',
      zoomOut: '缩小',
      zoomReset: '重置缩放',
      zoomFit: '缩放以适应',
      zoomSelection: '缩放到所选内容',
      undo: '撤销',
      redo: '重做',
      settings: '白板设置',
      snap: '对齐网格',
      help: '键盘快捷键',
      remove: '移除',
      color: '设置颜色',
      noColor: '无颜色',
      customColor: '自定义颜色',
      edit: '编辑',
      editLabel: '编辑标签',
      createGroup: '创建分组',
      direction: '连线方向',
      directionNone: '无箭头',
      directionEnd: '终点箭头',
      directionBoth: '双向箭头',
      bringFront: '置于顶层',
      sendBack: '置于底层',
      selectAll: '全选',
      duplicate: '创建副本',
      copy: '复制',
      paste: '粘贴',
      openLink: '在浏览器中打开',
      searchVault: '搜索库中的文件',
      searchMedia: '搜索库中的媒体',
      vaultLoading: '正在列出库文件...',
      noMatches: '没有匹配的文件',
      vaultFailed: '无法列出库文件：{message}',
      vaultTruncated: '仅显示库中前 {count} 个文件',
      linkPrompt: '网页地址',
      groupPrompt: '分组名称',
      add: '添加',
      cancel: '取消',
      invalidUrl: '请输入 http 或 https 地址',
      fileMissing: '找不到文件：{file}',
      fileFailed: '无法加载 {file}：{message}',
      unsupportedFile: '此文件类型无法预览',
      interact: '双击以交互',
      edgeLabel: '标签',
      red: '红色',
      orange: '橙色',
      yellow: '黄色',
      green: '绿色',
      cyan: '青色',
      purple: '紫色',
      keyPan: '平移：滚动、空格 + 拖动，或中键拖动',
      keyZoom: '缩放：Ctrl/Cmd + 滚动，或双指捏合',
      keyCard: '新卡片：双击白板',
      keyEdit: '编辑卡片：双击，或按 Enter',
      keySelect: '选择：点击、Shift + 点击，或拖出选框',
      keyConnect: '连线：从卡片边上的圆点拖出',
      keyDuplicate: '创建副本：Alt + 拖动，或 Cmd/Ctrl + D',
      keyDelete: '移除：Delete 或 Backspace',
      keyUndo: '撤销 / 重做：Cmd/Ctrl + Z，Cmd/Ctrl + Shift + Z',
      keyFit: '缩放以适应：Shift + 1；缩放到所选内容：Shift + 2',
    }

    // ---------------------------------------------------------------- model

    function randomId() {
      const bytes = new Uint8Array(8)
      crypto.getRandomValues(bytes)
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    }

    function finite(value) {
      return typeof value === 'number' && Number.isFinite(value)
    }

    function validNode(node) {
      return typeof node === 'object' && node !== null && typeof node.id === 'string' && typeof node.type === 'string'
        && finite(node.x) && finite(node.y) && finite(node.width) && finite(node.height)
    }

    /**
     * Parse JSON Canvas text. Entries this editor cannot place are kept aside
     * and written back unchanged.
     */
    function parseCanvas(text) {
      if (text.trim() === '') return { nodes: [], edges: [], extra: {}, kept: { nodes: [], edges: [] } }
      const data = JSON.parse(text)
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('the top level is not an object')
      const { nodes: rawNodes, edges: rawEdges, ...extra } = data
      if (rawNodes !== undefined && !Array.isArray(rawNodes)) throw new Error('"nodes" is not an array')
      if (rawEdges !== undefined && !Array.isArray(rawEdges)) throw new Error('"edges" is not an array')
      const nodes = []
      const kept = { nodes: [], edges: [] }
      for (const node of rawNodes ?? []) (validNode(node) ? nodes : kept.nodes).push(node)
      const ids = new Set(nodes.map(node => node.id))
      const edges = []
      for (const edge of rawEdges ?? []) {
        const valid = typeof edge === 'object' && edge !== null && typeof edge.id === 'string' && ids.has(edge.fromNode) && ids.has(edge.toNode)
        ;(valid ? edges : kept.edges).push(edge)
      }
      return { nodes, edges, extra, kept }
    }

    /** Serialize with Obsidian's tab indentation. */
    function serializeCanvas(doc) {
      return JSON.stringify({
        nodes: [...doc.nodes, ...doc.kept.nodes],
        edges: [...doc.edges, ...doc.kept.edges],
        ...doc.extra,
      }, null, '\t')
    }

    function decodeText(bytes) {
      return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
    }

    function nodeById(doc, id) {
      return doc.nodes.find(node => node.id === id)
    }

    function extensionOf(file) {
      const name = String(file).split('/').pop() ?? ''
      const dot = name.lastIndexOf('.')
      return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
    }

    function baseName(file, dropMarkdown) {
      const name = String(file).split('/').pop() ?? String(file)
      return dropMarkdown && name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
    }

    function colorValue(color) {
      if (typeof color !== 'string') return undefined
      if (PRESET_COLORS[color] !== undefined) return PRESET_COLORS[color]
      return /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined
    }

    function safeUrl(url) {
      try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' ? parsed.href : undefined
      } catch (_error) {
        // An unparsable URL renders as plain text instead of a link.
        return undefined
      }
    }

    // ---------------------------------------------------------------- geometry

    function rectOf(node) {
      return { x: node.x, y: node.y, width: node.width, height: node.height }
    }

    function centerOf(rect) {
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }

    function sidePoint(rect, side) {
      switch (side) {
        case 'top': return { x: rect.x + rect.width / 2, y: rect.y }
        case 'bottom': return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
        case 'left': return { x: rect.x, y: rect.y + rect.height / 2 }
        default: return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
      }
    }

    function contains(outer, inner) {
      return inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
    }

    function intersects(a, b) {
      return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    }

    function boundsOf(rects) {
      if (rects.length === 0) return undefined
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const rect of rects) {
        minX = Math.min(minX, rect.x)
        minY = Math.min(minY, rect.y)
        maxX = Math.max(maxX, rect.x + rect.width)
        maxY = Math.max(maxY, rect.y + rect.height)
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    function nearestSide(rect, point) {
      let best = 'top'
      let distance = Infinity
      for (const side of SIDES) {
        const anchor = sidePoint(rect, side)
        const candidate = Math.hypot(anchor.x - point.x, anchor.y - point.y)
        if (candidate < distance) {
          distance = candidate
          best = side
        }
      }
      return best
    }

    function automaticSides(from, to) {
      const a = centerOf(from)
      const b = centerOf(to)
      const dx = b.x - a.x
      const dy = b.y - a.y
      if (Math.abs(dx) * (from.height + to.height) >= Math.abs(dy) * (from.width + to.width)) {
        return dx >= 0 ? ['right', 'left'] : ['left', 'right']
      }
      return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
    }

    function snap(value, enabled) {
      return enabled ? Math.round(value / GRID) * GRID : Math.round(value)
    }

    function cubicAt(p0, p1, p2, p3, t) {
      const u = 1 - t
      return {
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      }
    }

    /**
     * Build an Obsidian-style cubic edge between two anchor points.
     * A side of `undefined` means a free end (the pointer while dragging).
     */
    function edgeCurve(start, startSide, end, endSide, arrowStart, arrowEnd) {
      const distance = Math.hypot(end.x - start.x, end.y - start.y)
      const reach = Math.min(Math.max(distance / 2, 40), 200)
      const d0 = startSide ? DIRECTION[startSide] : [0, 0]
      const d1 = endSide ? DIRECTION[endSide] : [0, 0]
      const s = arrowStart && startSide ? { x: start.x + d0[0] * ARROW, y: start.y + d0[1] * ARROW } : start
      const e = arrowEnd && endSide ? { x: end.x + d1[0] * ARROW, y: end.y + d1[1] * ARROW } : end
      const c0 = { x: s.x + d0[0] * reach, y: s.y + d0[1] * reach }
      const c1 = { x: e.x + d1[0] * reach, y: e.y + d1[1] * reach }
      let tail = e
      if (arrowEnd && !endSide) {
        const dx = e.x - c0.x
        const dy = e.y - c0.y
        const length = Math.hypot(dx, dy) || 1
        tail = { x: e.x - (dx / length) * ARROW, y: e.y - (dy / length) * ARROW }
      }
      const arrows = []
      if (arrowEnd) arrows.push(arrowHead(end, endSide ? { x: end.x + d1[0] * ARROW, y: end.y + d1[1] * ARROW } : tail))
      if (arrowStart && startSide) arrows.push(arrowHead(start, s))
      return {
        path: `M${s.x},${s.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${tail.x},${tail.y}`,
        middle: cubicAt(s, c0, c1, tail, 0.5),
        arrows,
      }
    }

    function arrowHead(tip, base) {
      const dx = tip.x - base.x
      const dy = tip.y - base.y
      const length = Math.hypot(dx, dy) || 1
      const nx = -dy / length * ARROW * 0.6
      const ny = dx / length * ARROW * 0.6
      return `${tip.x},${tip.y} ${base.x + nx},${base.y + ny} ${base.x - nx},${base.y - ny}`
    }

    function edgeGeometry(edge, from, to) {
      const [autoFrom, autoTo] = automaticSides(from, to)
      const fromSide = SIDES.includes(edge.fromSide) ? edge.fromSide : autoFrom
      const toSide = SIDES.includes(edge.toSide) ? edge.toSide : autoTo
      return {
        fromSide, toSide,
        start: sidePoint(from, fromSide),
        end: sidePoint(to, toSide),
        ...edgeCurve(sidePoint(from, fromSide), fromSide, sidePoint(to, toSide), toSide, edge.fromEnd === 'arrow', (edge.toEnd ?? 'arrow') === 'arrow'),
      }
    }

    // ---------------------------------------------------------------- markdown

    const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

    function stripFrontmatter(text) {
      const match = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(text)
      return match ? text.slice(match[0].length) : text
    }

    /** Select the section a `#Heading` or `#^block` subpath names. */
    function selectSubpath(text, subpath) {
      if (typeof subpath !== 'string' || !subpath.startsWith('#')) return text
      const lines = text.split(/\r?\n/)
      if (subpath.startsWith('#^')) {
        const id = subpath.slice(2)
        const line = lines.find(candidate => candidate.trimEnd().endsWith(`^${id}`))
        return line === undefined ? text : line.replace(new RegExp(`\\s*\\^${id}\\s*$`), '')
      }
      const target = subpath.slice(1).split('#').pop().trim().toLowerCase()
      const start = lines.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === target)
      if (start === -1) return text
      const level = /^(#+)/.exec(lines[start])[1].length
      let end = start + 1
      while (end < lines.length && !(new RegExp(`^#{1,${level}}\\s`).test(lines[end]))) end++
      return lines.slice(start, end).join('\n')
    }

    function isBlockStart(line) {
      return /^\s*(```|~~~)/.test(line) || /^#{1,6}\s/.test(line) || /^\s{0,3}>/.test(line) || LIST_ITEM.test(line)
        || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)
    }

    function splitRow(line) {
      return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
    }

    function parseBlocks(lines) {
      const blocks = []
      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        if (/^\s*$/.test(line)) { i++; continue }
        let match
        if ((match = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line))) {
          const fence = match[1]
          const body = []
          i++
          while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++])
          i++
          blocks.push({ type: 'code', lang: match[2], text: body.join('\n') })
          continue
        }
        if ((match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
          blocks.push({ type: 'heading', level: match[1].length, text: match[2] })
          i++
          continue
        }
        if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
          blocks.push({ type: 'hr' })
          i++
          continue
        }
        if (/^\s{0,3}>/.test(line)) {
          const inner = []
          while (i < lines.length && /^\s{0,3}>/.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
          const callout = /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(inner[0] ?? '')
          if (callout) blocks.push({ type: 'callout', kind: callout[1].toLowerCase(), title: callout[2], children: parseBlocks(inner.slice(1)) })
          else blocks.push({ type: 'quote', children: parseBlocks(inner) })
          continue
        }
        if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
          const head = splitRow(line)
          const align = splitRow(lines[i + 1]).map(cell => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : undefined))
          i += 2
          const rows = []
          while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(splitRow(lines[i++]))
          blocks.push({ type: 'table', head, align, rows })
          continue
        }
        if (LIST_ITEM.test(line)) {
          const items = []
          while (i < lines.length) {
            const item = LIST_ITEM.exec(lines[i])
            if (item) {
              items.push({ indent: item[1].replace(/\t/g, '    ').length, ordered: /\d/.test(item[2]), start: parseInt(item[2], 10), text: item[3] })
              i++
            } else if (items.length > 0 && /^\s+\S/.test(lines[i])) {
              items[items.length - 1].text += `\n${lines[i++].trim()}`
            } else break
          }
          blocks.push({ type: 'list', list: listTree(items) })
          continue
        }
        const paragraph = []
        while (i < lines.length && !/^\s*$/.test(lines[i]) && (paragraph.length === 0 || !isBlockStart(lines[i]))) paragraph.push(lines[i++])
        blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
      }
      return blocks
    }

    function listTree(items) {
      const root = { ordered: items[0].ordered, start: items[0].start, items: [] }
      const stack = [{ indent: items[0].indent, list: root }]
      for (const item of items) {
        while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) stack.pop()
        let top = stack[stack.length - 1]
        if (item.indent > top.indent && top.list.items.length > 0) {
          const parent = top.list.items[top.list.items.length - 1]
          parent.children ??= { ordered: item.ordered, start: item.start, items: [] }
          stack.push({ indent: item.indent, list: parent.children })
          top = stack[stack.length - 1]
        }
        top.list.items.push({ text: item.text, children: undefined })
      }
      return root
    }

    const INLINE_RULES = [
      ['code', /`([^`]+)`/],
      ['embed', /!\[\[([^\]]+)\]\]/],
      ['image', /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/],
      ['wikilink', /\[\[([^\]]+)\]\]/],
      ['link', /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/],
      ['autolink', /<?(https?:\/\/[^\s<>)\]]+)>?/],
      ['bold', /\*\*(?=\S)(.+?)\*\*|__(?=\S)(.+?)__/],
      ['strike', /~~(?=\S)(.+?)~~/],
      ['highlight', /==(?=\S)(.+?)==/],
      ['italic', /\*(?=\S)([^*]+?)\*|(?<![\w])_(?=\S)([^_]+?)_(?![\w])/],
      ['tag', /(?<![\w#&])#([A-Za-z_][\w/-]*)/],
    ]

    function inlineNodes(text, env, key) {
      const out = []
      let rest = text
      let index = 0
      while (rest.length > 0) {
        let best
        for (const [type, pattern] of INLINE_RULES) {
          const match = pattern.exec(rest)
          if (match && (best === undefined || match.index < best.match.index)) best = { type, match }
        }
        if (best === undefined) {
          out.push(rest)
          break
        }
        if (best.match.index > 0) out.push(rest.slice(0, best.match.index))
        out.push(inlineNode(best.type, best.match, env, `${key}.${index++}`))
        rest = rest.slice(best.match.index + best.match[0].length)
      }
      return out
    }

    function inlineNode(type, match, env, key) {
      switch (type) {
        case 'code': return h('code', { key }, match[1])
        case 'bold': return h('strong', { key }, inlineNodes(match[1] ?? match[2], env, key))
        case 'italic': return h('em', { key }, inlineNodes(match[1] ?? match[2], env, key))
        case 'strike': return h('del', { key }, inlineNodes(match[1], env, key))
        case 'highlight': return h('mark', { key }, inlineNodes(match[1], env, key))
        case 'tag': return h('span', { key, className: 'oc-tag' }, `#${match[1]}`)
        case 'wikilink': {
          const [target, alias] = match[1].split('|')
          return h('span', { key, className: 'oc-internal-link', title: target }, alias ?? target.replace('#', ' > '))
        }
        case 'embed': {
          const [target, size] = match[1].split('|')
          const url = env.fileUrl?.(target)
          if (url && IMAGE_EXTENSIONS.has(extensionOf(target))) {
            const width = /^\d+/.exec(size ?? '')?.[0]
            return h('img', { key, src: url, alt: target, draggable: false, style: width ? { width: `${width}px` } : undefined })
          }
          return h('span', { key, className: 'oc-internal-link', title: target }, target)
        }
        case 'image': {
          const external = safeUrl(match[2])
          let local
          if (external === undefined) {
            try {
              local = env.fileUrl?.(decodeURIComponent(match[2]))
            } catch (_error) {
              // Malformed escapes do not name a vault file.
              local = undefined
            }
          }
          const src = external ?? local
          return src ? h('img', { key, src, alt: match[1], draggable: false }) : h('span', { key }, match[0])
        }
        case 'link': {
          const href = safeUrl(match[2])
          const children = inlineNodes(match[1], env, key)
          return href ? h('a', { key, href, target: '_blank', rel: 'noopener noreferrer' }, children) : h('span', { key, className: 'oc-internal-link' }, children)
        }
        case 'autolink': {
          const href = safeUrl(match[1])
          return href ? h('a', { key, href, target: '_blank', rel: 'noopener noreferrer' }, match[1]) : match[0]
        }
        default: return match[0]
      }
    }

    function inlineLines(text, env, key) {
      const parts = []
      text.split('\n').forEach((line, index) => {
        if (index > 0) parts.push(h('br', { key: `${key}.br${index}` }))
        parts.push(...inlineNodes(line, env, `${key}.${index}`))
      })
      return parts
    }

    function listElement(list, env, key) {
      const items = list.items.map((item, index) => {
        const task = /^\[( |x|X)\]\s+([\s\S]*)$/.exec(item.text)
        const body = task
          ? [h('input', { key: 'box', type: 'checkbox', checked: task[1] !== ' ', readOnly: true, tabIndex: -1, className: 'oc-task' }), ...inlineLines(task[2], env, `${key}.${index}`)]
          : inlineLines(item.text, env, `${key}.${index}`)
        return h('li', { key: index, className: task ? 'oc-task-item' : undefined, 'data-checked': task && task[1] !== ' ' ? '' : undefined },
          ...body, item.children ? listElement(item.children, env, `${key}.${index}.sub`) : null)
      })
      return list.ordered ? h('ol', { key, start: list.start }, items) : h('ul', { key }, items)
    }

    function blockElements(blocks, env, key) {
      return blocks.map((block, index) => {
        const k = `${key}.${index}`
        switch (block.type) {
          case 'heading': return h(`h${block.level}`, { key: k }, inlineNodes(block.text, env, k))
          case 'hr': return h('hr', { key: k })
          case 'code': return h('pre', { key: k }, h('code', { 'data-lang': block.lang || undefined }, block.text))
          case 'quote': return h('blockquote', { key: k }, blockElements(block.children, env, k))
          case 'callout': return h('div', { key: k, className: 'oc-callout', 'data-callout': block.kind },
            h('div', { className: 'oc-callout-title' }, block.title ? inlineNodes(block.title, env, k) : block.kind.charAt(0).toUpperCase() + block.kind.slice(1)),
            blockElements(block.children, env, k))
          case 'table': return h('table', { key: k },
            h('thead', null, h('tr', null, block.head.map((cell, c) => h('th', { key: c, style: { textAlign: block.align[c] } }, inlineNodes(cell, env, `${k}.h${c}`))))),
            h('tbody', null, block.rows.map((row, r) => h('tr', { key: r }, row.map((cell, c) => h('td', { key: c, style: { textAlign: block.align[c] } }, inlineNodes(cell, env, `${k}.${r}.${c}`)))))))
          case 'list': return listElement(block.list, env, k)
          default: return h('p', { key: k }, inlineLines(block.text, env, k))
        }
      })
    }

    const Markdown = memo(function Markdown({ text, env }) {
      const blocks = useMemo(() => parseBlocks(text.split(/\r?\n/)), [text])
      return h('div', { className: 'oc-markdown' }, blockElements(blocks, env, 'md'))
    })

    // ---------------------------------------------------------------- icons

    const ICONS = {
      trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
      palette: ['M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z', 'M7.5 11.5h.01', 'M10 7.5h.01', 'M14.5 7.5h.01'],
      plus: ['M12 5v14', 'M5 12h14'],
      minus: ['M5 12h14'],
      fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
      reset: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
      undo: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
      redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
      gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.9 4.9L7 7', 'M17 17l2.1 2.1', 'M4.9 19.1L7 17', 'M17 7l2.1-2.1'],
      help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
      card: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M8 9h8', 'M8 13h5'],
      note: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
      media: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M9 10a1.5 1.5 0 1 0 0-.01', 'M20 15l-4.5-4.5L6 20'],
      globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9', 'M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9'],
      group: ['M4 8V5a1 1 0 0 1 1-1h3', 'M12 4h0', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 12v0', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M12 20h0', 'M8 20H5a1 1 0 0 1-1-1v-3', 'M4 12v0'],
      pencil: ['M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
      focus: ['M4 8V4h4', 'M16 4h4v4', 'M20 16v4h-4', 'M8 20H4v-4', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
      arrow: ['M4 12h16', 'M15 7l5 5-5 5'],
      external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
      file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
    }

    function Icon({ name, size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      }, ICONS[name].map((d, index) => h('path', { key: index, d })))
    }

    function IconButton({ icon, label, onClick, active, disabled, onPointerDown, className }) {
      return h('button', {
        type: 'button', className: `oc-icon-button${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`,
        'aria-label': label, title: label, onClick, onPointerDown, disabled, 'aria-pressed': active === undefined ? undefined : active,
      }, h(Icon, { name: icon }))
    }

    // ---------------------------------------------------------------- styles

    const CSS = `
.oc-root { position: relative; height: 100%; min-height: 240px; overflow: hidden; outline: none; user-select: none;
  background-color: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font, sans-serif);
  font-size: 14px; touch-action: none; --oc-accent: var(--dsw-alias-brand-primary); --oc-neutral: color-mix(in srgb, var(--dsw-alias-label-secondary) 55%, transparent); }
.oc-root.is-panning, .oc-root.is-panning * { cursor: grabbing !important; }
.oc-root.space-ready { cursor: grab; }
.oc-grid { position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(circle, color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent) 1px, transparent 1.2px); }
.oc-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.oc-node { position: absolute; box-sizing: border-box; --oc-color: var(--oc-neutral); }
.oc-node-container { position: absolute; inset: 0; box-sizing: border-box; border: 2px solid var(--oc-color); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.oc-node.has-color .oc-node-container { background: color-mix(in srgb, var(--oc-color) 9%, var(--dsw-alias-bg-layer-1)); }
.oc-node.is-selected .oc-node-container { outline: calc(2px * var(--oc-inv)) solid var(--oc-accent); outline-offset: calc(2px * var(--oc-inv)); }
.oc-node.is-drop-target .oc-node-container { outline: calc(2px * var(--oc-inv)) dashed var(--oc-accent); outline-offset: calc(2px * var(--oc-inv)); }
.oc-node-content { position: absolute; inset: 0; overflow: hidden; padding: 12px 18px; box-sizing: border-box; overflow-wrap: anywhere; }
.oc-node.is-active .oc-node-content, .oc-node.is-selected .oc-node-content { overflow: auto; }
.oc-node[data-type="file"] .oc-node-content.is-media, .oc-node[data-type="link"] .oc-node-content { padding: 0; }
.oc-node-label { position: absolute; left: 0; bottom: 100%; max-width: 100%; padding-bottom: calc(4px * var(--oc-inv)); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); font-size: calc(13px * min(var(--oc-inv), 3)); line-height: 1.3; }
.oc-node[data-type="group"] { pointer-events: none; }
.oc-node[data-type="group"] .oc-node-container { background: color-mix(in srgb, var(--oc-color) 7%, transparent); }
.oc-group-hit { position: absolute; pointer-events: auto; }
.oc-group-hit[data-edge="top"] { left: 0; right: 0; top: calc(-5px * var(--oc-inv)); height: calc(12px * var(--oc-inv)); }
.oc-group-hit[data-edge="bottom"] { left: 0; right: 0; bottom: calc(-5px * var(--oc-inv)); height: calc(12px * var(--oc-inv)); }
.oc-group-hit[data-edge="left"] { top: 0; bottom: 0; left: calc(-5px * var(--oc-inv)); width: calc(12px * var(--oc-inv)); }
.oc-group-hit[data-edge="right"] { top: 0; bottom: 0; right: calc(-5px * var(--oc-inv)); width: calc(12px * var(--oc-inv)); }
.oc-node[data-type="group"].has-background .oc-node-container { background-size: cover; background-position: center; }
.oc-group-label { position: absolute; left: 0; bottom: 100%; margin-bottom: calc(6px * var(--oc-inv)); max-width: 100%; pointer-events: auto;
  padding: calc(2px * var(--oc-inv)) calc(10px * var(--oc-inv)); border-radius: calc(6px * var(--oc-inv)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-size: calc(18px * min(var(--oc-inv), 3)); line-height: 1.3; color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--oc-color) 22%, var(--dsw-alias-bg-layer-1)); }
.oc-anchor { position: absolute; width: calc(12px * var(--oc-inv)); height: calc(12px * var(--oc-inv)); margin: calc(-6px * var(--oc-inv));
  border-radius: 50%; background: var(--dsw-alias-bg-layer-1); border: calc(2px * var(--oc-inv)) solid var(--oc-accent); box-sizing: border-box;
  opacity: 0; cursor: crosshair; z-index: 2; pointer-events: auto; transition: opacity 80ms; }
.oc-anchor[data-side="top"] { left: 50%; top: calc(-10px * var(--oc-inv)); }
.oc-anchor[data-side="bottom"] { left: 50%; top: calc(100% + 10px * var(--oc-inv)); }
.oc-anchor[data-side="left"] { top: 50%; left: calc(-10px * var(--oc-inv)); }
.oc-anchor[data-side="right"] { top: 50%; left: calc(100% + 10px * var(--oc-inv)); }
.oc-root:not(.is-busy):not(.is-readonly) .oc-node:hover > .oc-anchor, .oc-root.is-connecting .oc-node:hover > .oc-anchor { opacity: 1; }
.oc-handle { position: absolute; z-index: 3; pointer-events: auto; }
.oc-handle[data-handle="n"], .oc-handle[data-handle="s"] { left: 8px; right: 8px; height: calc(10px * var(--oc-inv)); cursor: ns-resize; }
.oc-handle[data-handle="e"], .oc-handle[data-handle="w"] { top: 8px; bottom: 8px; width: calc(10px * var(--oc-inv)); cursor: ew-resize; }
.oc-handle[data-handle="n"] { top: calc(-5px * var(--oc-inv)); } .oc-handle[data-handle="s"] { bottom: calc(-5px * var(--oc-inv)); }
.oc-handle[data-handle="w"] { left: calc(-5px * var(--oc-inv)); } .oc-handle[data-handle="e"] { right: calc(-5px * var(--oc-inv)); }
.oc-handle[data-handle="nw"], .oc-handle[data-handle="ne"], .oc-handle[data-handle="sw"], .oc-handle[data-handle="se"] { width: calc(14px * var(--oc-inv)); height: calc(14px * var(--oc-inv)); }
.oc-handle[data-handle="nw"] { left: calc(-7px * var(--oc-inv)); top: calc(-7px * var(--oc-inv)); cursor: nwse-resize; }
.oc-handle[data-handle="se"] { right: calc(-7px * var(--oc-inv)); bottom: calc(-7px * var(--oc-inv)); cursor: nwse-resize; }
.oc-handle[data-handle="ne"] { right: calc(-7px * var(--oc-inv)); top: calc(-7px * var(--oc-inv)); cursor: nesw-resize; }
.oc-handle[data-handle="sw"] { left: calc(-7px * var(--oc-inv)); bottom: calc(-7px * var(--oc-inv)); cursor: nesw-resize; }
.oc-edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.oc-edge { --oc-color: var(--oc-neutral); }
.oc-edge-line { fill: none; stroke: var(--oc-color); stroke-width: max(3px, calc(1.5px * var(--oc-inv))); stroke-linecap: round; }
.oc-edge-arrow { fill: var(--oc-color); stroke: var(--oc-color); stroke-width: 1px; stroke-linejoin: round; }
.oc-edge-hit { fill: none; stroke: transparent; stroke-width: calc(18px * var(--oc-inv)); pointer-events: stroke; cursor: pointer; }
.oc-edge.is-selected .oc-edge-line { stroke: var(--oc-accent); }
.oc-edge.is-selected .oc-edge-arrow { fill: var(--oc-accent); stroke: var(--oc-accent); }
.oc-edge-temp .oc-edge-line { stroke: var(--oc-accent); stroke-dasharray: 6 6; }
.oc-edge-temp .oc-edge-arrow { fill: var(--oc-accent); stroke: var(--oc-accent); }
.oc-edge-end { fill: var(--dsw-alias-bg-layer-1); stroke: var(--oc-accent); stroke-width: calc(2px * var(--oc-inv)); pointer-events: all; cursor: grab; }
.oc-edge-label { position: absolute; transform: translate(-50%, -50%); padding: calc(2px * var(--oc-inv)) calc(8px * var(--oc-inv)); border-radius: calc(4px * var(--oc-inv));
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: calc(14px * min(var(--oc-inv), 3)); white-space: pre; cursor: pointer; max-width: 400px;
  overflow: hidden; text-overflow: ellipsis; }
.oc-edge-label.is-selected { outline: calc(1.5px * var(--oc-inv)) solid var(--oc-accent); }
.oc-marquee { position: absolute; border: 1px solid var(--oc-accent); background: color-mix(in srgb, var(--oc-accent) 10%, transparent); pointer-events: none; }
.oc-editor { position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box; padding: 12px 18px; margin: 0; border: none; outline: none; resize: none;
  background: transparent; color: inherit; font: inherit; line-height: 1.5; user-select: text; }
.oc-inline-input { position: absolute; z-index: 5; transform: translate(-50%, -50%); min-width: 120px; padding: 4px 8px; border-radius: 6px; font: inherit;
  border: 1px solid var(--oc-accent); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); outline: none; user-select: text; }
.oc-markdown { line-height: 1.5; }
.oc-markdown > :first-child { margin-top: 0; } .oc-markdown > :last-child { margin-bottom: 0; }
.oc-markdown p, .oc-markdown ul, .oc-markdown ol, .oc-markdown blockquote, .oc-markdown pre, .oc-markdown table, .oc-markdown .oc-callout { margin: 0 0 0.6em; }
.oc-markdown h1, .oc-markdown h2, .oc-markdown h3, .oc-markdown h4, .oc-markdown h5, .oc-markdown h6 { margin: 0.6em 0 0.35em; line-height: 1.25; font-weight: 650; }
.oc-markdown h1 { font-size: 1.8em; } .oc-markdown h2 { font-size: 1.5em; } .oc-markdown h3 { font-size: 1.3em; } .oc-markdown h4 { font-size: 1.15em; }
.oc-markdown ul, .oc-markdown ol { padding-left: 1.5em; } .oc-markdown li > ul, .oc-markdown li > ol { margin: 0.1em 0; }
.oc-markdown li.oc-task-item { list-style: none; margin-left: -1.3em; } .oc-markdown li.oc-task-item[data-checked] { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }
.oc-task { margin: 0 0.45em 0 0; vertical-align: middle; pointer-events: none; }
.oc-markdown code { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 0.88em; padding: 0.1em 0.3em; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); }
.oc-markdown pre { padding: 8px 10px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); overflow: auto; white-space: pre; }
.oc-markdown pre code { padding: 0; background: none; }
.oc-markdown blockquote { padding-left: 0.9em; border-left: 3px solid var(--oc-accent); color: var(--dsw-alias-label-secondary); }
.oc-markdown hr { border: none; border-top: 1px solid var(--dsw-alias-border-l2); margin: 1em 0; }
.oc-markdown a { color: var(--oc-accent); text-decoration: underline; }
.oc-markdown mark { background: color-mix(in srgb, #e0de71 45%, transparent); color: inherit; }
.oc-markdown img { max-width: 100%; border-radius: 4px; }
.oc-markdown table { border-collapse: collapse; } .oc-markdown th, .oc-markdown td { border: 1px solid var(--dsw-alias-border-l2); padding: 3px 8px; }
.oc-internal-link { color: var(--oc-accent); text-decoration: underline; text-decoration-style: dotted; }
.oc-tag { padding: 0 0.45em; border-radius: 1em; background: color-mix(in srgb, var(--oc-accent) 15%, transparent); color: var(--oc-accent); font-size: 0.9em; }
.oc-callout { padding: 8px 12px; border-radius: 6px; border-left: 3px solid #086ddd; background: color-mix(in srgb, #086ddd 10%, transparent); }
.oc-callout[data-callout="warning"], .oc-callout[data-callout="caution"] { border-color: #ec7500; background: color-mix(in srgb, #ec7500 10%, transparent); }
.oc-callout[data-callout="danger"], .oc-callout[data-callout="error"], .oc-callout[data-callout="bug"] { border-color: #e93147; background: color-mix(in srgb, #e93147 10%, transparent); }
.oc-callout[data-callout="tip"], .oc-callout[data-callout="success"], .oc-callout[data-callout="check"] { border-color: #08b94e; background: color-mix(in srgb, #08b94e 10%, transparent); }
.oc-callout-title { font-weight: 650; margin-bottom: 0.3em; }
.oc-media { display: block; width: 100%; height: 100%; object-fit: contain; border: none; }
.oc-frame { display: block; width: 100%; height: 100%; border: none; background: #fff; }
.oc-frame-shield { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px; box-sizing: border-box; }
.oc-frame-shield > span { padding: 3px 10px; border-radius: 999px; font-size: 12px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l1); opacity: 0; transition: opacity 120ms; }
.oc-node:hover .oc-frame-shield > span { opacity: 1; }
.oc-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 100%; padding: 12px; box-sizing: border-box;
  color: var(--dsw-alias-label-secondary); text-align: center; }
.oc-panel { position: absolute; z-index: 10; display: flex; gap: 2px; padding: 3px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay); }
.oc-controls { top: 10px; right: 10px; flex-direction: column; gap: 6px; padding: 0; border: none; background: none; }
.oc-controls > .oc-panel-group { display: flex; flex-direction: column; gap: 2px; padding: 3px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay); }
.oc-add-bar { left: 50%; bottom: 12px; transform: translateX(-50%); }
.oc-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.oc-icon-button:hover:not(:disabled), .oc-icon-button.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.oc-icon-button:disabled { opacity: 0.4; cursor: default; }
.oc-icon-button:focus-visible { outline: 2px solid var(--oc-accent); outline-offset: 1px; }
.oc-add-bar .oc-icon-button { width: 34px; height: 34px; cursor: grab; }
.oc-selection-bar { transform: translate(-50%, -100%); }
.oc-zoom-label { font-size: 11px; text-align: center; color: var(--dsw-alias-label-secondary); padding: 2px 0; font-variant-numeric: tabular-nums; }
.oc-popover { position: absolute; z-index: 20; min-width: 160px; padding: 4px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); }
.oc-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; border: none; border-radius: 5px; background: none; color: inherit;
  font: inherit; text-align: left; cursor: pointer; white-space: nowrap; }
.oc-menu-item:hover, .oc-menu-item:focus-visible { background: var(--dsw-alias-bg-layer-2); outline: none; }
.oc-menu-item[aria-checked="true"]::after { content: ''; margin-left: auto; width: 6px; height: 6px; border-radius: 50%; background: var(--oc-accent); }
.oc-menu-separator { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l1); }
.oc-swatches { display: flex; gap: 6px; padding: 6px; align-items: center; }
.oc-swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.oc-swatch.is-active { border-color: var(--dsw-alias-label-primary); }
.oc-swatch-none { background: var(--dsw-alias-bg-layer-2); position: relative; overflow: hidden; }
.oc-swatch-none::after { content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: var(--dsw-alias-state-error-primary); transform: rotate(45deg); }
.oc-swatch-custom { position: relative; overflow: hidden; background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); }
.oc-swatch-custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.oc-help { padding: 8px 12px; font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); max-width: 320px; white-space: normal; }
.oc-help-title { color: var(--dsw-alias-label-primary); font-weight: 600; margin-bottom: 2px; }
.oc-modal-shade { position: absolute; inset: 0; z-index: 30; display: flex; align-items: flex-start; justify-content: center; padding-top: 12%;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 40%, transparent); }
.oc-modal { width: min(520px, calc(100% - 32px)); max-height: 70%; display: flex; flex-direction: column; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); user-select: none; }
.oc-modal input[type="text"], .oc-modal input[type="url"] { margin: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; outline: none; user-select: text; }
.oc-modal input:focus { border-color: var(--oc-accent); }
.oc-modal-list { overflow: auto; padding: 0 4px 6px; }
.oc-modal-item { display: block; width: 100%; padding: 6px 10px; border: none; border-radius: 5px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.oc-modal-item.is-active { background: var(--dsw-alias-bg-layer-2); }
.oc-modal-item small { display: block; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.oc-modal-note { padding: 8px 14px 12px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.oc-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 10px 10px; }
.oc-text-button { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: inherit;
  font: inherit; cursor: pointer; }
.oc-text-button.is-primary { background: var(--oc-accent); border-color: var(--oc-accent); color: #fff; }
.oc-status { position: absolute; left: 10px; bottom: 12px; z-index: 10; display: flex; align-items: center; gap: 8px; max-width: calc(100% - 20px); padding: 4px 10px;
  border-radius: 999px; font-size: 12px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.oc-status.is-error { color: var(--dsw-alias-state-error-primary); }
.oc-status button { padding: 0; border: none; background: none; color: var(--oc-accent); font: inherit; cursor: pointer; }
.oc-banner { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 15; display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  max-width: calc(100% - 100px); border-radius: 8px; border: 1px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-overlay); font-size: 13px; }
.oc-empty-hint { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); color: var(--dsw-alias-label-secondary); pointer-events: none; text-align: center; }
.oc-message { padding: 24px; color: var(--dsw-alias-label-secondary); white-space: normal; }
.oc-message strong { display: block; margin-bottom: 6px; color: var(--dsw-alias-state-error-primary); font-weight: 600; }
`

    // ---------------------------------------------------------------- file data

    const textCache = new Map()

    function useFileText(url, epoch) {
      const key = `${url}\n${epoch}`
      const [state, setState] = useState(() => textCache.get(key) ?? { status: 'loading' })
      useEffect(() => {
        if (url === undefined) return undefined
        const cached = textCache.get(key)
        if (cached !== undefined) {
          setState(cached)
          return undefined
        }
        const controller = new AbortController()
        fetch(url, { signal: controller.signal, credentials: 'same-origin' })
          .then(async response => {
            if (response.status === 404) return { status: 'missing' }
            if (!response.ok) return { status: 'failed', message: await failureMessage(response) }
            return { status: 'ready', text: await response.text() }
          })
          .then(result => {
            textCache.set(key, result)
            if (textCache.size > 200) textCache.delete(textCache.keys().next().value)
            setState(result)
          }, error => {
            if (!controller.signal.aborted) setState({ status: 'failed', message: error.message })
          })
        return () => controller.abort()
      }, [key, url])
      return state
    }

    async function failureMessage(response) {
      try {
        const body = await response.json()
        if (typeof body?.message === 'string') return body.message
      } catch (_error) {
        // A non-JSON failure body has no message beyond its status.
      }
      return `HTTP ${response.status}`
    }

    function imageSize(url) {
      return new Promise(resolve => {
        const image = new Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => resolve(undefined)
        image.src = url
      })
    }

    // ---------------------------------------------------------------- node views

    function TextContent({ node, env }) {
      return h(Markdown, { text: node.text ?? '', env })
    }

    function FileContent({ node, env, active, t }) {
      const file = typeof node.file === 'string' ? node.file : ''
      const extension = extensionOf(file)
      const url = env.fileUrl(file)
      if (url === undefined) return h('div', { className: 'oc-placeholder' }, h(Icon, { name: 'file', size: 28 }), baseName(file))
      if (IMAGE_EXTENSIONS.has(extension)) return h('img', { className: 'oc-media', src: url, alt: baseName(file), draggable: false })
      if (VIDEO_EXTENSIONS.has(extension)) return h('video', { className: 'oc-media', src: url, controls: true, preload: 'metadata' })
      if (AUDIO_EXTENSIONS.has(extension)) return h('div', { className: 'oc-placeholder' }, h('audio', { src: url, controls: true, preload: 'metadata' }))
      if (extension === 'pdf') {
        return h(Fragment, null, h('iframe', { className: 'oc-frame', src: url, title: baseName(file), style: { pointerEvents: active ? 'auto' : 'none' } }),
          active ? null : h('div', { className: 'oc-frame-shield' }, h('span', null, t('interact'))))
      }
      if (TEXT_EXTENSIONS.has(extension) || extension === '') return h(MarkdownFile, { url, file, subpath: node.subpath, env, t })
      return h('div', { className: 'oc-placeholder' }, h(Icon, { name: 'file', size: 28 }), h('div', null, baseName(file)), h('small', null, t('unsupportedFile')))
    }

    function MarkdownFile({ url, file, subpath, env, t }) {
      const state = useFileText(url, env.epoch)
      if (state.status === 'loading') return h('div', { className: 'oc-placeholder' }, t('loading'))
      if (state.status === 'missing') return h('div', { className: 'oc-placeholder' }, t('fileMissing', { file }))
      if (state.status === 'failed') return h('div', { className: 'oc-placeholder' }, t('fileFailed', { file, message: state.message }))
      const text = selectSubpath(stripFrontmatter(state.text), subpath)
      if (extensionOf(file) === 'txt') return h('div', { style: { whiteSpace: 'pre-wrap' } }, text)
      return h(Markdown, { text, env })
    }

    function LinkContent({ node, active, t }) {
      const url = safeUrl(node.url ?? '')
      if (url === undefined) return h('div', { className: 'oc-placeholder' }, h(Icon, { name: 'globe', size: 28 }), String(node.url ?? ''))
      return h(Fragment, null,
        h('iframe', {
          className: 'oc-frame', src: url, title: url, referrerPolicy: 'no-referrer', loading: 'lazy',
          sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation',
          style: { pointerEvents: active ? 'auto' : 'none' },
        }),
        active ? null : h('div', { className: 'oc-frame-shield' }, h('span', null, t('interact'))))
    }

    const HANDLES = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']

    const NodeView = memo(function NodeView({ node, selected, single, editing, active, dropTarget, readOnly, env, api, t }) {
      const color = colorValue(node.color)
      const isGroup = node.type === 'group'
      const background = isGroup && typeof node.background === 'string' ? env.fileUrl(node.background) : undefined
      const style = { left: node.x, top: node.y, width: node.width, height: node.height }
      if (color) style['--oc-color'] = color
      const className = ['oc-node', color ? 'has-color' : '', selected ? 'is-selected' : '', active ? 'is-active' : '',
        dropTarget ? 'is-drop-target' : '', background ? 'has-background' : ''].filter(Boolean).join(' ')
      let label = null
      if (node.type === 'file') label = h('div', { className: 'oc-node-label', title: node.file }, baseName(node.file ?? '', true) + (node.subpath ?? ''))
      else if (node.type === 'link') label = h('div', { className: 'oc-node-label', title: node.url }, node.url)
      else if (isGroup && editing !== 'label' && typeof node.label === 'string' && node.label !== '') {
        label = h('div', {
          className: 'oc-group-label', title: node.label,
          onPointerDown: event => api.nodePointerDown(event, node.id),
          onDoubleClick: event => api.nodeDoubleClick(event, node.id, 'label'),
        }, node.label)
      }
      let content = null
      if (editing === 'text') content = h(TextEditor, { node, api })
      else if (node.type === 'text') content = h('div', { className: 'oc-node-content' }, h(TextContent, { node, env }))
      else if (node.type === 'file') {
        const media = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, 'pdf'].includes(extensionOf(node.file ?? ''))
        content = h('div', { className: `oc-node-content${media ? ' is-media' : ''}` }, h(FileContent, { node, env, active, t }))
      } else if (node.type === 'link') content = h('div', { className: 'oc-node-content' }, h(LinkContent, { node, active, t }))
      const containerStyle = background
        ? { backgroundImage: `url("${background}")`, backgroundSize: node.backgroundStyle === 'repeat' ? 'auto' : node.backgroundStyle === 'ratio' ? 'contain' : 'cover',
          backgroundRepeat: node.backgroundStyle === 'repeat' ? 'repeat' : 'no-repeat' }
        : undefined
      const grab = {
        onPointerDown: event => api.nodePointerDown(event, node.id),
        onDoubleClick: event => api.nodeDoubleClick(event, node.id, isGroup ? 'label' : 'content'),
      }
      return h('div', { className, style, 'data-node-id': node.id, 'data-type': node.type },
        label,
        h('div', { className: 'oc-node-container', style: containerStyle, ...(isGroup ? {} : grab) }, content),
        isGroup ? SIDES.map(side => h('div', { key: side, className: 'oc-group-hit', 'data-edge': side, ...grab })) : null,
        readOnly || editing ? null : SIDES.map(side => h('div', {
          key: side, className: 'oc-anchor', 'data-side': side,
          onPointerDown: event => api.anchorPointerDown(event, node.id, side),
        })),
        !readOnly && selected && single && !editing ? HANDLES.map(handle => h('div', {
          key: handle, className: 'oc-handle', 'data-handle': handle,
          onPointerDown: event => api.resizePointerDown(event, node.id, handle),
        })) : null)
    })

    function TextEditor({ node, api }) {
      const [value, setValue] = useState(node.text ?? '')
      const ref = useRef(null)
      const latest = useRef(value)
      latest.current = value
      useEffect(() => {
        const element = ref.current
        element?.focus({ preventScroll: true })
        element?.setSelectionRange(element.value.length, element.value.length)
        return () => api.finishTextEdit(node.id, latest.current)
      }, [])
      return h('textarea', {
        ref, className: 'oc-editor', value, spellCheck: true,
        onChange: event => setValue(event.target.value),
        onPointerDown: event => event.stopPropagation(),
        onDoubleClick: event => event.stopPropagation(),
        onKeyDown: event => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            api.stopEditing()
          }
        },
        onBlur: () => api.stopEditing(),
      })
    }

    function InlineInput({ x, y, initial, placeholder, onDone }) {
      const [value, setValue] = useState(initial)
      const done = useRef(false)
      const finish = commit => {
        if (done.current) return
        done.current = true
        onDone(commit ? value : undefined)
      }
      return h('input', {
        className: 'oc-inline-input', style: { left: x, top: y }, value, placeholder, autoFocus: true, type: 'text',
        onChange: event => setValue(event.target.value),
        onPointerDown: event => event.stopPropagation(),
        onKeyDown: event => {
          event.stopPropagation()
          if (event.key === 'Enter') finish(true)
          if (event.key === 'Escape') finish(false)
        },
        onBlur: () => finish(true),
      })
    }

    const EdgeView = memo(function EdgeView({ edge, from, to, selected, readOnly, inv, api }) {
      const geometry = edgeGeometry(edge, from, to)
      const color = colorValue(edge.color)
      return h('g', { className: `oc-edge${selected ? ' is-selected' : ''}`, 'data-edge-id': edge.id, style: color ? { '--oc-color': color } : undefined },
        h('path', { className: 'oc-edge-hit', d: geometry.path, onPointerDown: event => api.edgePointerDown(event, edge.id), onDoubleClick: event => api.edgeDoubleClick(event, edge.id) }),
        h('path', { className: 'oc-edge-line', d: geometry.path }),
        geometry.arrows.map((points, index) => h('polygon', { key: index, className: 'oc-edge-arrow', points })),
        selected && !readOnly ? [['from', geometry.start], ['to', geometry.end]].map(([end, point]) => h('circle', {
          key: end, className: 'oc-edge-end', cx: point.x, cy: point.y, r: 6 * (inv ?? 1),
          onPointerDown: event => api.edgeEndPointerDown(event, edge.id, end),
        })) : null)
    })

    // ---------------------------------------------------------------- popovers

    function useDismiss(ref, onClose) {
      useEffect(() => {
        const down = event => { if (ref.current && !ref.current.contains(event.target)) onClose() }
        const key = event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
        window.addEventListener('pointerdown', down, true)
        window.addEventListener('keydown', key, true)
        return () => {
          window.removeEventListener('pointerdown', down, true)
          window.removeEventListener('keydown', key, true)
        }
      }, [ref, onClose])
    }

    function Popover({ x, y, onClose, children, align }) {
      const ref = useRef(null)
      const [position, setPosition] = useState({ left: x, top: y })
      useDismiss(ref, onClose)
      useLayoutEffect(() => {
        const element = ref.current
        const parent = element?.offsetParent
        if (!element || !parent) return
        let left = align === 'right' ? x - element.offsetWidth : x
        let top = y
        left = Math.max(6, Math.min(left, parent.clientWidth - element.offsetWidth - 6))
        if (top + element.offsetHeight > parent.clientHeight - 6) top = Math.max(6, parent.clientHeight - element.offsetHeight - 6)
        setPosition({ left, top })
      }, [x, y, align])
      return h('div', { ref, className: 'oc-popover', style: position, onPointerDown: event => event.stopPropagation(), onContextMenu: event => event.preventDefault() }, children)
    }

    function Menu({ x, y, items, onClose }) {
      return h(Popover, { x, y, onClose }, items.map((item, index) => item === '-'
        ? h('div', { key: index, className: 'oc-menu-separator' })
        : h('button', {
          key: index, type: 'button', className: 'oc-menu-item', role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox', 'aria-checked': item.checked,
          onClick: () => { onClose(); item.run() },
        }, item.icon ? h(Icon, { name: item.icon }) : null, item.label)))
    }

    function ColorPicker({ x, y, current, onPick, onClose, t }) {
      const custom = /^#[0-9a-f]{6}$/i.test(current ?? '') ? current : '#888888'
      return h(Popover, { x, y, onClose },
        h('div', { className: 'oc-swatches', role: 'group', 'aria-label': t('color') },
          h('button', { type: 'button', className: `oc-swatch oc-swatch-none${current === undefined ? ' is-active' : ''}`, title: t('noColor'), 'aria-label': t('noColor'), onClick: () => onPick(undefined) }),
          COLOR_KEYS.map(key => h('button', {
            key, type: 'button', className: `oc-swatch${current === key ? ' is-active' : ''}`, style: { background: PRESET_COLORS[key] },
            title: t(COLOR_NAMES[key]), 'aria-label': t(COLOR_NAMES[key]), onClick: () => onPick(key),
          })),
          h('label', { className: `oc-swatch oc-swatch-custom${current !== undefined && !COLOR_KEYS.includes(current) ? ' is-active' : ''}`, title: t('customColor') },
            h('input', { type: 'color', value: custom, 'aria-label': t('customColor'), onChange: event => onPick(event.target.value) }))))
    }

    function VaultPicker({ mode, canvasPath, onPick, onClose, t }) {
      const [listing, setListing] = useState({ status: 'loading' })
      const [query, setQuery] = useState('')
      const [active, setActive] = useState(0)
      const listRef = useRef(null)
      useEffect(() => {
        const controller = new AbortController()
        fetch(`${VAULT_ROUTE}?canvas=${encodeURIComponent(canvasPath)}`, { signal: controller.signal, credentials: 'same-origin' })
          .then(async response => {
            if (!response.ok) throw new Error(await failureMessage(response))
            return response.json()
          })
          .then(body => setListing({ status: 'ready', ...body }), error => {
            if (!controller.signal.aborted) setListing({ status: 'failed', message: error.message })
          })
        return () => controller.abort()
      }, [canvasPath])
      const matches = useMemo(() => {
        if (listing.status !== 'ready') return []
        const media = file => { const extension = extensionOf(file); return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension) || extension === 'pdf' }
        const files = listing.files.filter(file => file !== listing.canvas && (mode === 'media' ? media(file) : !media(file)))
        const needle = query.trim().toLowerCase()
        if (needle === '') return files.slice(0, 100)
        const scored = []
        for (const file of files) {
          const lower = file.toLowerCase()
          const name = baseName(lower)
          let score
          if (name.startsWith(needle)) score = 0
          else if (name.includes(needle)) score = 1
          else if (lower.includes(needle)) score = 2
          else {
            let at = 0
            for (const char of needle) { at = lower.indexOf(char, at); if (at === -1) break; at++ }
            if (at === -1) continue
            score = 3
          }
          scored.push({ file, score })
        }
        return scored.sort((a, b) => a.score - b.score || a.file.length - b.file.length).slice(0, 100).map(entry => entry.file)
      }, [listing, query, mode])
      useEffect(() => setActive(0), [query])
      useEffect(() => { listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' }) }, [active])
      const ref = useRef(null)
      useDismiss(ref, onClose)
      return h('div', { className: 'oc-modal-shade' },
        h('div', { ref, className: 'oc-modal', role: 'dialog', 'aria-label': mode === 'media' ? t('searchMedia') : t('searchVault'), onPointerDown: event => event.stopPropagation() },
          h('input', {
            type: 'text', autoFocus: true, value: query, placeholder: mode === 'media' ? t('searchMedia') : t('searchVault'),
            onChange: event => setQuery(event.target.value),
            onKeyDown: event => {
              event.stopPropagation()
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, matches.length - 1)) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)) }
              if (event.key === 'Enter' && matches[active] !== undefined) onPick(matches[active])
              if (event.key === 'Escape') onClose()
            },
          }),
          listing.status === 'loading' ? h('div', { className: 'oc-modal-note' }, t('vaultLoading')) : null,
          listing.status === 'failed' ? h('div', { className: 'oc-modal-note' }, t('vaultFailed', { message: listing.message })) : null,
          listing.status === 'ready' && matches.length === 0 ? h('div', { className: 'oc-modal-note' }, t('noMatches')) : null,
          h('div', { ref: listRef, className: 'oc-modal-list', role: 'listbox' }, matches.map((file, index) => h('button', {
            key: file, type: 'button', role: 'option', 'aria-selected': index === active, className: `oc-modal-item${index === active ? ' is-active' : ''}`,
            onMouseEnter: () => setActive(index), onClick: () => onPick(file),
          }, baseName(file, true), h('small', null, file)))),
          listing.status === 'ready' && listing.truncated ? h('div', { className: 'oc-modal-note' }, t('vaultTruncated', { count: listing.files.length })) : null))
    }

    function TextPrompt({ label, initial, type, validate, onSubmit, onClose, t }) {
      const [value, setValue] = useState(initial ?? '')
      const [error, setError] = useState()
      const ref = useRef(null)
      useDismiss(ref, onClose)
      const submit = () => {
        const problem = validate?.(value)
        if (problem) setError(problem)
        else onSubmit(value)
      }
      return h('div', { className: 'oc-modal-shade' },
        h('div', { ref, className: 'oc-modal', role: 'dialog', 'aria-label': label, onPointerDown: event => event.stopPropagation() },
          h('input', {
            type, autoFocus: true, value, placeholder: label, 'aria-label': label,
            onChange: event => { setValue(event.target.value); setError(undefined) },
            onKeyDown: event => {
              event.stopPropagation()
              if (event.key === 'Enter') submit()
              if (event.key === 'Escape') onClose()
            },
          }),
          error ? h('div', { className: 'oc-modal-note', role: 'alert' }, error) : null,
          h('div', { className: 'oc-modal-actions' },
            h('button', { type: 'button', className: 'oc-text-button', onClick: onClose }, t('cancel')),
            h('button', { type: 'button', className: 'oc-text-button is-primary', onClick: submit }, t('add')))))
    }

    function HelpPanel({ t }) {
      return h('div', { className: 'oc-help' }, h('div', { className: 'oc-help-title' }, t('help')),
        ['keyPan', 'keyZoom', 'keyCard', 'keyEdit', 'keySelect', 'keyConnect', 'keyDuplicate', 'keyDelete', 'keyUndo', 'keyFit'].map(key => h('div', { key }, t(key))))
    }

    // ---------------------------------------------------------------- editor

    function CanvasEditor({ text, absolutePath, pathKnown, resourceAddress, t }) {
      const rootRef = useRef(null)
      const [doc, setDocState] = useState(() => parseCanvas(text))
      const [view, setViewState] = useState(() => savedViews.get(resourceAddress))
      const [selection, setSelectionState] = useState(() => new Set())
      const [editing, setEditing] = useState(null)
      const [activeId, setActiveId] = useState(null)
      const [overlay, setOverlay] = useState(null)
      const [popup, setPopup] = useState(null)
      const [snapToGrid, setSnapToGrid] = useState(() => localStorage.getItem('oc-snap') !== 'false')
      const [save, setSave] = useState({ status: 'idle' })
      const [conflict, setConflict] = useState(null)
      const [busy, setBusy] = useState(null)
      const [epoch, setEpoch] = useState(0)
      const [size, setSize] = useState({ width: 0, height: 0 })
      const [, setHistoryVersion] = useState(0)
      const readOnly = absolutePath === undefined

      const docRef = useRef(doc)
      const viewRef = useRef(view)
      const selectionRef = useRef(selection)
      const snapRef = useRef(snapToGrid)
      const history = useRef({ undo: [], redo: [] })
      const diskText = useRef(text)
      const pendingText = useRef(undefined)
      const dirty = useRef(false)
      const saveTimer = useRef(undefined)
      const saving = useRef(false)
      const opRef = useRef(null)
      const spaceDown = useRef(false)
      const pointer = useRef({ x: 0, y: 0 })
      docRef.current = doc
      viewRef.current = view
      selectionRef.current = selection
      snapRef.current = snapToGrid

      const setDoc = next => { docRef.current = next; setDocState(next) }
      const setView = next => { viewRef.current = next; savedViews.set(resourceAddress, next); setViewState(next) }
      const setSelection = next => { selectionRef.current = next; setSelectionState(next) }

      // ---- persistence

      const flushSave = useCallback(async () => {
        clearTimeout(saveTimer.current)
        saveTimer.current = undefined
        if (readOnly || saving.current) return
        const body = serializeCanvas(docRef.current)
        if (body === diskText.current) {
          dirty.current = false
          setSave({ status: 'idle' })
          return
        }
        saving.current = true
        pendingText.current = body
        setSave({ status: 'saving' })
        try {
          const response = await fetch(SAVE_ROUTE, {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: absolutePath, text: body }),
          })
          if (!response.ok) throw new Error(await failureMessage(response))
          diskText.current = body
          if (serializeCanvas(docRef.current) === body) {
            dirty.current = false
            setSave({ status: 'idle' })
          }
        } catch (error) {
          setSave({ status: 'failed', message: error.message })
        } finally {
          saving.current = false
          pendingText.current = undefined
        }
        if (dirty.current && serializeCanvas(docRef.current) !== diskText.current) saveTimer.current = setTimeout(() => flushSave(), SAVE_DELAY_MS)
      }, [absolutePath, readOnly])

      const scheduleSave = useCallback(() => {
        if (readOnly) return
        dirty.current = true
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => flushSave(), SAVE_DELAY_MS)
      }, [flushSave, readOnly])

      useEffect(() => () => {
        if (saveTimer.current !== undefined) flushSave()
      }, [flushSave])

      useEffect(() => {
        if (text === diskText.current || text === pendingText.current) {
          diskText.current = text
          return
        }
        if (dirty.current) {
          setConflict(text)
          return
        }
        let next
        try {
          next = parseCanvas(text)
        } catch (error) {
          setSave({ status: 'failed', message: error.message })
          return
        }
        diskText.current = text
        setDoc(next)
        setEpoch(value => value + 1)
        const ids = new Set([...next.nodes.map(node => node.id), ...next.edges.map(edge => edge.id)])
        setSelection(new Set([...selectionRef.current].filter(id => ids.has(id))))
      }, [text])

      // ---- history

      const pushHistory = snapshot => {
        const stacks = history.current
        stacks.undo.push(snapshot)
        if (stacks.undo.length > HISTORY_LIMIT) stacks.undo.shift()
        stacks.redo = []
        setHistoryVersion(value => value + 1)
      }

      const commit = (next, previous = docRef.current) => {
        if (readOnly || next === previous) return
        pushHistory(previous)
        setDoc(next)
        scheduleSave()
      }

      const undo = () => {
        const stacks = history.current
        const previous = stacks.undo.pop()
        if (previous === undefined) return
        stacks.redo.push(docRef.current)
        setDoc(previous)
        setHistoryVersion(value => value + 1)
        scheduleSave()
      }

      const redo = () => {
        const stacks = history.current
        const next = stacks.redo.pop()
        if (next === undefined) return
        stacks.undo.push(docRef.current)
        setDoc(next)
        setHistoryVersion(value => value + 1)
        scheduleSave()
      }

      // ---- view

      const screenToWorld = (clientX, clientY) => {
        const rect = rootRef.current.getBoundingClientRect()
        const current = viewRef.current
        return { x: (clientX - rect.left - current.x) / current.zoom, y: (clientY - rect.top - current.y) / current.zoom }
      }

      const fitRect = (rect, maxZoom = 1) => {
        const element = rootRef.current
        if (!element) return
        const width = element.clientWidth
        const height = element.clientHeight
        if (rect === undefined) {
          setView({ x: width / 2, y: height / 2, zoom: 1 })
          return
        }
        const padding = 60
        const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, (width - padding * 2) / Math.max(rect.width, 1), (height - padding * 2) / Math.max(rect.height, 1)))
        setView({ x: width / 2 - (rect.x + rect.width / 2) * zoom, y: height / 2 - (rect.y + rect.height / 2) * zoom, zoom })
      }

      const zoomToFit = () => fitRect(boundsOf(docRef.current.nodes.map(rectOf)))
      const zoomToSelection = () => {
        const rects = docRef.current.nodes.filter(node => selectionRef.current.has(node.id)).map(rectOf)
        if (rects.length > 0) fitRect(boundsOf(rects), 2)
        else zoomToFit()
      }

      const zoomAt = (factor, clientX, clientY) => {
        const element = rootRef.current
        const current = viewRef.current
        if (!element || !current) return
        const rect = element.getBoundingClientRect()
        const px = clientX === undefined ? element.clientWidth / 2 : clientX - rect.left
        const py = clientY === undefined ? element.clientHeight / 2 : clientY - rect.top
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * factor))
        setView({ x: px - (px - current.x) * (zoom / current.zoom), y: py - (py - current.y) * (zoom / current.zoom), zoom })
      }

      useLayoutEffect(() => {
        const element = rootRef.current
        if (!element) return undefined
        const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }))
        observer.observe(element)
        setSize({ width: element.clientWidth, height: element.clientHeight })
        return () => observer.disconnect()
      }, [])

      useLayoutEffect(() => {
        if (viewRef.current === undefined && size.width > 0 && size.height > 0) zoomToFit()
      }, [size])

      useEffect(() => {
        const element = rootRef.current
        const wheel = event => {
          if (viewRef.current === undefined) return
          const scroller = event.target.closest?.('.oc-node.is-selected .oc-node-content, .oc-node.is-active .oc-node-content, .oc-editor, .oc-popover, .oc-modal')
          if (scroller && !event.ctrlKey && !event.metaKey && scroller.scrollHeight > scroller.clientHeight) {
            const atTop = scroller.scrollTop <= 0 && event.deltaY < 0
            const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && event.deltaY > 0
            if (!atTop && !atBottom) return
          }
          if (event.target.closest?.('.oc-popover, .oc-modal')) return
          event.preventDefault()
          if (event.ctrlKey || event.metaKey) {
            const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
            zoomAt(Math.exp(-delta * 0.01), event.clientX, event.clientY)
          } else {
            const scale = event.deltaMode === 1 ? 16 : 1
            const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * scale
            const dy = (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * scale
            const current = viewRef.current
            setView({ ...current, x: current.x - dx, y: current.y - dy })
          }
        }
        element.addEventListener('wheel', wheel, { passive: false })
        return () => element.removeEventListener('wheel', wheel)
      }, [])

      // ---- operations on the document

      const updateNodes = (doc0, ids, update) => ({ ...doc0, nodes: doc0.nodes.map(node => (ids.has(node.id) ? update(node) : node)) })

      const groupMembers = (doc0, ids) => {
        const result = new Set(ids)
        const groups = doc0.nodes.filter(node => node.type === 'group' && ids.has(node.id))
        for (const group of groups) for (const node of doc0.nodes) if (node.id !== group.id && contains(rectOf(group), rectOf(node))) result.add(node.id)
        return result
      }

      const addNode = (node, { edit } = {}) => {
        const current = docRef.current
        const next = node.type === 'group' ? { ...current, nodes: [node, ...current.nodes] } : { ...current, nodes: [...current.nodes, node] }
        commit(next, current)
        setSelection(new Set([node.id]))
        if (edit) setEditing({ id: node.id, part: node.type === 'group' ? 'label' : 'text' })
        return node
      }

      const placeAt = (point, width, height) => ({
        x: snap(point.x - width / 2, snapRef.current), y: snap(point.y - height / 2, snapRef.current), width, height,
      })

      const viewCenter = () => {
        const element = rootRef.current
        const rect = element.getBoundingClientRect()
        return screenToWorld(rect.left + element.clientWidth / 2, rect.top + element.clientHeight / 2)
      }

      const createCard = (point, edit = true) => addNode({ id: randomId(), type: 'text', text: '', ...placeAt(point, 260, 60) }, { edit })

      const createGroupAround = ids => {
        const current = docRef.current
        const members = current.nodes.filter(node => ids.has(node.id))
        const bounds = boundsOf(members.map(rectOf))
        const padding = 20
        const group = bounds
          ? { id: randomId(), type: 'group', label: '', x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 }
          : { id: randomId(), type: 'group', label: '', ...placeAt(viewCenter(), 400, 400) }
        addNode(group, { edit: true })
      }

      const createFileNode = async (file, point) => {
        let width = 400
        let height = 400
        const extension = extensionOf(file)
        if (IMAGE_EXTENSIONS.has(extension)) {
          const natural = await imageSize(fileUrl(file))
          if (natural && natural.width > 0) {
            width = Math.min(natural.width, 600)
            height = Math.round(width * natural.height / natural.width)
          }
        } else if (AUDIO_EXTENSIONS.has(extension)) {
          height = 120
        } else if (extension === 'pdf') {
          height = 520
        }
        addNode({ id: randomId(), type: 'file', file, ...placeAt(point, width, height) })
      }

      const createLinkNode = (url, point) => addNode({ id: randomId(), type: 'link', url, ...placeAt(point, 400, 400) })

      const removeSelection = () => {
        const ids = selectionRef.current
        if (ids.size === 0) return
        const current = docRef.current
        const nodes = current.nodes.filter(node => !ids.has(node.id))
        const live = new Set(nodes.map(node => node.id))
        const edges = current.edges.filter(edge => !ids.has(edge.id) && live.has(edge.fromNode) && live.has(edge.toNode))
        commit({ ...current, nodes, edges }, current)
        setSelection(new Set())
      }

      const setColor = color => {
        const ids = selectionRef.current
        const current = docRef.current
        const apply = item => {
          const { color: _old, ...rest } = item
          return color === undefined ? rest : { ...rest, color }
        }
        commit({
          ...current,
          nodes: current.nodes.map(node => (ids.has(node.id) ? apply(node) : node)),
          edges: current.edges.map(edge => (ids.has(edge.id) ? apply(edge) : edge)),
        }, current)
      }

      const setEdgeDirection = mode => {
        const ids = selectionRef.current
        const current = docRef.current
        commit({
          ...current,
          edges: current.edges.map(edge => {
            if (!ids.has(edge.id)) return edge
            const { fromEnd: _from, toEnd: _to, ...rest } = edge
            if (mode === 'none') return { ...rest, toEnd: 'none' }
            if (mode === 'both') return { ...rest, fromEnd: 'arrow' }
            return rest
          }),
        }, current)
      }

      const reorder = front => {
        const ids = selectionRef.current
        const current = docRef.current
        const chosen = current.nodes.filter(node => ids.has(node.id))
        const others = current.nodes.filter(node => !ids.has(node.id))
        commit({ ...current, nodes: front ? [...others, ...chosen] : [...chosen, ...others] }, current)
      }

      const fragmentOf = ids => {
        const current = docRef.current
        const nodes = current.nodes.filter(node => ids.has(node.id))
        const live = new Set(nodes.map(node => node.id))
        return { nodes, edges: current.edges.filter(edge => live.has(edge.fromNode) && live.has(edge.toNode)) }
      }

      const insertFragment = (fragment, offset) => {
        const map = new Map()
        const nodes = fragment.nodes.filter(validNode).map(node => {
          const id = randomId()
          map.set(node.id, id)
          return { ...node, id, x: node.x + offset.x, y: node.y + offset.y }
        })
        const edges = (fragment.edges ?? []).filter(edge => map.has(edge.fromNode) && map.has(edge.toNode))
          .map(edge => ({ ...edge, id: randomId(), fromNode: map.get(edge.fromNode), toNode: map.get(edge.toNode) }))
        const current = docRef.current
        const groups = nodes.filter(node => node.type === 'group')
        const rest = nodes.filter(node => node.type !== 'group')
        commit({ ...current, nodes: [...groups, ...current.nodes, ...rest], edges: [...current.edges, ...edges] }, current)
        setSelection(new Set([...nodes.map(node => node.id), ...edges.map(edge => edge.id)]))
        return map
      }

      const duplicateSelection = () => {
        const fragment = fragmentOf(selectionRef.current)
        if (fragment.nodes.length > 0) insertFragment(fragment, { x: GRID * 2, y: GRID * 2 })
      }

      const pasteFragment = fragment => {
        const bounds = boundsOf(fragment.nodes.filter(validNode).map(rectOf))
        if (!bounds) return
        const target = viewRef.current && rootRef.current ? screenToWorld(pointer.current.x, pointer.current.y) : { x: 0, y: 0 }
        insertFragment(fragment, { x: snap(target.x - bounds.x - bounds.width / 2, snapRef.current), y: snap(target.y - bounds.y - bounds.height / 2, snapRef.current) })
      }

      const fileUrl = useCallback(file => {
        if (absolutePath === undefined || typeof file !== 'string' || file === '') return undefined
        return `${FILE_ROUTE}?canvas=${encodeURIComponent(absolutePath)}&file=${encodeURIComponent(file.split('#')[0])}`
      }, [absolutePath])

      const env = useMemo(() => ({ fileUrl, epoch }), [fileUrl, epoch])

      // ---- pointer operations

      const startOperation = (event, operation) => {
        const element = rootRef.current
        element.focus({ preventScroll: true })
        operation.startX = event.clientX
        operation.startY = event.clientY
        operation.moved = false
        opRef.current = operation
        const move = moveEvent => {
          pointer.current = { x: moveEvent.clientX, y: moveEvent.clientY }
          const op = opRef.current
          if (!op) return
          if (!op.moved && Math.hypot(moveEvent.clientX - op.startX, moveEvent.clientY - op.startY) < DRAG_THRESHOLD) return
          if (!op.moved) {
            op.moved = true
            setBusy(op.type)
            op.begin?.(moveEvent)
          }
          op.move?.(moveEvent)
        }
        const up = upEvent => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          const op = opRef.current
          opRef.current = null
          setBusy(null)
          setOverlay(null)
          if (!op) return
          if (op.moved) op.end?.(upEvent)
          else op.click?.(upEvent)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }

      const startPan = event => {
        const origin = viewRef.current
        startOperation(event, {
          type: 'pan',
          move: moveEvent => setView({ ...origin, x: origin.x + moveEvent.clientX - event.clientX, y: origin.y + moveEvent.clientY - event.clientY }),
        })
        setBusy('pan')
      }

      const hitNode = (point, exclude) => {
        const nodes = docRef.current.nodes
        for (let i = nodes.length - 1; i >= 0; i--) {
          const node = nodes[i]
          if (node.type !== 'group' && !exclude?.has(node.id) && contains(rectOf(node), { ...point, width: 0, height: 0 })) return node
        }
        for (let i = nodes.length - 1; i >= 0; i--) {
          const node = nodes[i]
          if (node.type === 'group' && !exclude?.has(node.id) && contains(rectOf(node), { ...point, width: 0, height: 0 })) return node
        }
        return undefined
      }

      const backgroundPointerDown = event => {
        pointer.current = { x: event.clientX, y: event.clientY }
        if (viewRef.current === undefined) return
        if (event.button === 1 || (event.button === 0 && spaceDown.current)) {
          event.preventDefault()
          startPan(event)
          return
        }
        if (event.button !== 0) return
        setActiveId(null)
        const additive = event.shiftKey || event.metaKey || event.ctrlKey
        const base = additive ? new Set(selectionRef.current) : new Set()
        if (!additive) setSelection(new Set())
        const start = screenToWorld(event.clientX, event.clientY)
        startOperation(event, {
          type: 'marquee',
          move: moveEvent => {
            const point = screenToWorld(moveEvent.clientX, moveEvent.clientY)
            const rect = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) }
            setOverlay({ marquee: rect })
            const next = new Set(base)
            for (const node of docRef.current.nodes) {
              if (node.type === 'group' ? contains(rect, rectOf(node)) : intersects(rect, rectOf(node))) next.add(node.id)
            }
            setSelection(next)
          },
        })
      }

      const nodePointerDown = (event, id) => {
        pointer.current = { x: event.clientX, y: event.clientY }
        if (event.button === 1 || (event.button === 0 && spaceDown.current)) {
          event.preventDefault()
          event.stopPropagation()
          startPan(event)
          return
        }
        if (event.button !== 0) return
        event.stopPropagation()
        rootRef.current.focus({ preventScroll: true })
        if (activeId !== id) setActiveId(null)
        const additive = event.shiftKey || event.metaKey || event.ctrlKey
        const wasSelected = selectionRef.current.has(id)
        let next = selectionRef.current
        if (additive) {
          next = new Set(next)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          setSelection(next)
        } else if (!next.has(id)) {
          next = new Set([id])
          setSelection(next)
        }
        if (readOnly) return
        const startWorld = screenToWorld(event.clientX, event.clientY)
        let snapshot
        let moving
        let origins
        startOperation(event, {
          type: 'move',
          begin: moveEvent => {
            snapshot = docRef.current
            let base = snapshot
            let ids = new Set([...selectionRef.current].filter(selected => nodeById(base, selected)))
            if (moveEvent.altKey) {
              const fragment = fragmentOf(ids)
              const map = new Map()
              const clones = fragment.nodes.map(node => { const clone = { ...node, id: randomId() }; map.set(node.id, clone.id); return clone })
              const edges = fragment.edges.map(edge => ({ ...edge, id: randomId(), fromNode: map.get(edge.fromNode), toNode: map.get(edge.toNode) }))
              base = { ...base, nodes: [...base.nodes, ...clones], edges: [...base.edges, ...edges] }
              ids = new Set(clones.map(clone => clone.id))
              setDoc(base)
              setSelection(new Set(ids))
            }
            moving = groupMembers(base, ids)
            origins = new Map(base.nodes.filter(node => moving.has(node.id)).map(node => [node.id, { x: node.x, y: node.y }]))
          },
          move: moveEvent => {
            const point = screenToWorld(moveEvent.clientX, moveEvent.clientY)
            let dx = point.x - startWorld.x
            let dy = point.y - startWorld.y
            const lead = origins.get(id) ?? origins.values().next().value
            if (snapRef.current && lead) {
              dx = snap(lead.x + dx, true) - lead.x
              dy = snap(lead.y + dy, true) - lead.y
            }
            setDoc(updateNodes(docRef.current, moving, node => {
              const origin = origins.get(node.id)
              return { ...node, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) }
            }))
          },
          end: () => {
            pushHistory(snapshot)
            scheduleSave()
          },
          click: () => {
            if (!additive && wasSelected && selectionRef.current.size > 1) setSelection(new Set([id]))
          },
        })
      }

      const resizePointerDown = (event, id, handle) => {
        if (event.button !== 0) return
        event.stopPropagation()
        const snapshot = docRef.current
        const origin = nodeById(snapshot, id)
        const startWorld = screenToWorld(event.clientX, event.clientY)
        startOperation(event, {
          type: 'resize',
          move: moveEvent => {
            const point = screenToWorld(moveEvent.clientX, moveEvent.clientY)
            const dx = point.x - startWorld.x
            const dy = point.y - startWorld.y
            let left = origin.x
            let top = origin.y
            let right = origin.x + origin.width
            let bottom = origin.y + origin.height
            if (handle.includes('w')) left = Math.min(snap(origin.x + dx, snapRef.current), right - MIN_NODE)
            if (handle.includes('e')) right = Math.max(snap(right + dx, snapRef.current), left + MIN_NODE)
            if (handle.includes('n')) top = Math.min(snap(origin.y + dy, snapRef.current), bottom - MIN_NODE)
            if (handle.includes('s')) bottom = Math.max(snap(bottom + dy, snapRef.current), top + MIN_NODE)
            setDoc(updateNodes(docRef.current, new Set([id]), node => ({ ...node, x: left, y: top, width: right - left, height: bottom - top })))
          },
          end: () => {
            pushHistory(snapshot)
            scheduleSave()
          },
        })
      }

      /** Drag a connection from a node side, or an existing edge end, to a target node. */
      const startConnect = (event, { fromId, fromSide, edgeId, end }) => {
        const snapshot = docRef.current
        const edge = edgeId ? snapshot.edges.find(candidate => candidate.id === edgeId) : undefined
        const fixedId = edge ? (end === 'to' ? edge.fromNode : edge.toNode) : fromId
        const fixedNode = nodeById(snapshot, fixedId)
        const fixedSide = edge ? (end === 'to' ? edge.fromSide : edge.toSide) ?? edgeGeometry(edge, nodeById(snapshot, edge.fromNode), nodeById(snapshot, edge.toNode))[end === 'to' ? 'fromSide' : 'toSide'] : fromSide
        const target = moveEvent => {
          const point = screenToWorld(moveEvent.clientX, moveEvent.clientY)
          const node = hitNode(point, new Set([fixedId]))
          return { point, node, side: node ? nearestSide(rectOf(node), point) : undefined }
        }
        startOperation(event, {
          type: 'connect',
          move: moveEvent => {
            const { point, node, side } = target(moveEvent)
            const fixedPoint = sidePoint(rectOf(fixedNode), fixedSide)
            const freePoint = node ? sidePoint(rectOf(node), side) : point
            const forward = !edge || end === 'to'
            const arrowEnd = edge ? (forward ? (edge.toEnd ?? 'arrow') === 'arrow' : edge.fromEnd === 'arrow') : true
            const arrowStart = edge ? (forward ? edge.fromEnd === 'arrow' : (edge.toEnd ?? 'arrow') === 'arrow') : false
            const curve = forward
              ? edgeCurve(fixedPoint, fixedSide, freePoint, side, arrowStart, arrowEnd)
              : edgeCurve(freePoint, side, fixedPoint, fixedSide, arrowEnd, arrowStart)
            setOverlay({ connect: curve, target: node?.id })
          },
          end: upEvent => {
            const { point, node, side } = target(upEvent)
            const current = docRef.current
            if (edge) {
              if (!node) return
              const update = end === 'to' ? { toNode: node.id, toSide: side } : { fromNode: node.id, fromSide: side }
              commit({ ...current, edges: current.edges.map(candidate => (candidate.id === edge.id ? { ...candidate, ...update } : candidate)) }, current)
              return
            }
            if (node) {
              const created = { id: randomId(), fromNode: fixedId, fromSide: fixedSide, toNode: node.id, toSide: side }
              commit({ ...current, edges: [...current.edges, created] }, current)
              setSelection(new Set([created.id]))
              return
            }
            const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[fixedSide]
            const width = 260
            const height = 60
            const offset = { top: [-width / 2, 0], bottom: [-width / 2, -height], left: [0, -height / 2], right: [-width, -height / 2] }[opposite]
            const card = { id: randomId(), type: 'text', text: '', x: snap(point.x + offset[0], snapRef.current), y: snap(point.y + offset[1], snapRef.current), width, height }
            const created = { id: randomId(), fromNode: fixedId, fromSide: fixedSide, toNode: card.id, toSide: opposite }
            commit({ ...current, nodes: [...current.nodes, card], edges: [...current.edges, created] }, current)
            setSelection(new Set([card.id]))
            setEditing({ id: card.id, part: 'text' })
          },
        })
      }

      const edgePointerDown = (event, id) => {
        if (event.button !== 0) return
        event.stopPropagation()
        rootRef.current.focus({ preventScroll: true })
        const additive = event.shiftKey || event.metaKey || event.ctrlKey
        if (additive) {
          const next = new Set(selectionRef.current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          setSelection(next)
        } else setSelection(new Set([id]))
      }

      const startAddDrag = (event, kind) => {
        if (event.button !== 0 || readOnly) return
        event.preventDefault()
        const create = point => {
          if (kind === 'card') createCard(point)
          else if (kind === 'group') {
            if ([...selectionRef.current].some(id => nodeById(docRef.current, id))) createGroupAround(selectionRef.current)
            else addNode({ id: randomId(), type: 'group', label: '', ...placeAt(point, 400, 400) }, { edit: true })
          } else if (kind === 'note' || kind === 'media') setPopup({ type: 'vault', mode: kind, point })
          else if (kind === 'link') setPopup({ type: 'link', point })
        }
        startOperation(event, {
          type: 'add',
          move: moveEvent => setOverlay({ ghost: { x: moveEvent.clientX, y: moveEvent.clientY, kind } }),
          end: upEvent => {
            const rect = rootRef.current.getBoundingClientRect()
            if (upEvent.clientX < rect.left || upEvent.clientX > rect.right || upEvent.clientY < rect.top || upEvent.clientY > rect.bottom) return
            if (upEvent.target.closest?.('.oc-add-bar')) return
            create(screenToWorld(upEvent.clientX, upEvent.clientY))
          },
          click: () => create(viewCenter()),
        })
      }

      // ---- double clicks and editing

      const nodeDoubleClick = (event, id, part) => {
        event.stopPropagation()
        const node = nodeById(docRef.current, id)
        if (!node) return
        if (node.type === 'text' && !readOnly) setEditing({ id, part: 'text' })
        else if (node.type === 'group' && part === 'label' && !readOnly) setEditing({ id, part: 'label' })
        else if (node.type === 'link' || node.type === 'file') setActiveId(id)
      }

      const edgeDoubleClick = (event, id) => {
        event.stopPropagation()
        if (!readOnly) setEditing({ id, part: 'edge' })
      }

      const backgroundDoubleClick = event => {
        if (readOnly || event.target.closest?.('.oc-panel, .oc-popover, .oc-modal, .oc-status, .oc-banner')) return
        createCard(screenToWorld(event.clientX, event.clientY))
      }

      const stopEditing = () => {
        setEditing(null)
        rootRef.current?.focus({ preventScroll: true })
      }

      const finishTextEdit = (id, value) => {
        const current = docRef.current
        const node = nodeById(current, id)
        if (!node || node.text === value) return
        commit(updateNodes(current, new Set([id]), item => ({ ...item, text: value })), current)
      }

      const finishLabel = (id, kind, value) => {
        setEditing(null)
        rootRef.current?.focus({ preventScroll: true })
        if (value === undefined) return
        const current = docRef.current
        if (kind === 'edge') {
          commit({
            ...current,
            edges: current.edges.map(edge => {
              if (edge.id !== id) return edge
              const { label: _label, ...rest } = edge
              return value.trim() === '' ? rest : { ...rest, label: value }
            }),
          }, current)
        } else {
          commit(updateNodes(current, new Set([id]), node => ({ ...node, label: value })), current)
        }
      }

      // ---- keyboard and clipboard

      const selectAll = () => setSelection(new Set([...docRef.current.nodes.map(node => node.id), ...docRef.current.edges.map(edge => edge.id)]))

      const onKeyDown = event => {
        if (event.target !== rootRef.current) return
        const mod = event.metaKey || event.ctrlKey
        if (event.key === ' ') {
          spaceDown.current = true
          rootRef.current.classList.add('space-ready')
          event.preventDefault()
          return
        }
        if (mod && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
        } else if (mod && event.key.toLowerCase() === 'y') {
          event.preventDefault()
          redo()
        } else if (mod && event.key.toLowerCase() === 'a') {
          event.preventDefault()
          selectAll()
        } else if (mod && event.key.toLowerCase() === 'd') {
          event.preventDefault()
          if (!readOnly) duplicateSelection()
        } else if (mod && (event.key === '=' || event.key === '+')) {
          event.preventDefault()
          zoomAt(1.25)
        } else if (mod && event.key === '-') {
          event.preventDefault()
          zoomAt(0.8)
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
          event.preventDefault()
          removeSelection()
        } else if (event.key === 'Escape') {
          setSelection(new Set())
          setActiveId(null)
        } else if (event.key === 'Enter' && !readOnly) {
          const [only] = selectionRef.current
          const node = selectionRef.current.size === 1 ? nodeById(docRef.current, only) : undefined
          if (node?.type === 'text') {
            event.preventDefault()
            setEditing({ id: node.id, part: 'text' })
          } else if (node?.type === 'group') {
            event.preventDefault()
            setEditing({ id: node.id, part: 'label' })
          }
        } else if (event.shiftKey && (event.code === 'Digit1' || event.key === '!')) {
          event.preventDefault()
          zoomToFit()
        } else if (event.shiftKey && (event.code === 'Digit2' || event.key === '@')) {
          event.preventDefault()
          zoomToSelection()
        } else if (event.shiftKey && (event.code === 'Digit0' || event.key === ')')) {
          event.preventDefault()
          zoomAt(1 / viewRef.current.zoom)
        } else if (event.key.startsWith('Arrow') && !readOnly && selectionRef.current.size > 0) {
          event.preventDefault()
          const step = event.shiftKey ? GRID : 1
          const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
          const current = docRef.current
          commit(updateNodes(current, groupMembers(current, selectionRef.current), node => ({ ...node, x: node.x + dx, y: node.y + dy })), current)
        }
      }

      const onKeyUp = event => {
        if (event.key === ' ') {
          spaceDown.current = false
          rootRef.current.classList.remove('space-ready')
        }
      }

      const onCopy = event => {
        if (event.target !== rootRef.current) return
        const fragment = fragmentOf(selectionRef.current)
        if (fragment.nodes.length === 0) return
        event.preventDefault()
        clipboard = fragment
        event.clipboardData.setData('text/plain', JSON.stringify(fragment, null, '\t'))
      }

      const onCut = event => {
        if (event.target !== rootRef.current || readOnly) return
        onCopy(event)
        if (clipboard) removeSelection()
      }

      const onPaste = event => {
        if (event.target !== rootRef.current || readOnly) return
        const textData = event.clipboardData.getData('text/plain')
        event.preventDefault()
        try {
          const parsed = JSON.parse(textData)
          if (Array.isArray(parsed?.nodes)) {
            pasteFragment(parsed)
            return
          }
        } catch (_error) {
          // Text that is not a canvas fragment becomes a card or a web page below.
        }
        if (textData.trim() === '') {
          if (clipboard) pasteFragment(clipboard)
          return
        }
        const point = screenToWorld(pointer.current.x, pointer.current.y)
        const url = /^https?:\/\/\S+$/.test(textData.trim()) ? safeUrl(textData.trim()) : undefined
        if (url) createLinkNode(url, point)
        else addNode({ id: randomId(), type: 'text', text: textData, ...placeAt(point, 260, Math.min(400, 40 + 24 * textData.split('\n').length)) })
      }

      // ---- context menu

      const onContextMenu = event => {
        event.preventDefault()
        if (viewRef.current === undefined) return
        const rect = rootRef.current.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        const world = screenToWorld(event.clientX, event.clientY)
        const nodeElement = event.target.closest?.('[data-node-id]')
        const edgeHit = event.target.closest?.('.oc-edge, .oc-edge-label')
        let items
        if (nodeElement || edgeHit) {
          const id = nodeElement?.getAttribute('data-node-id') ?? edgeHit?.getAttribute('data-edge-id')
          if (id && !selectionRef.current.has(id)) setSelection(new Set([id]))
          const node = id ? nodeById(docRef.current, id) : undefined
          items = [
            ...(node?.type === 'text' && !readOnly ? [{ icon: 'pencil', label: t('edit'), run: () => setEditing({ id: node.id, part: 'text' }) }] : []),
            ...(node?.type === 'link' ? [{ icon: 'external', label: t('openLink'), run: () => window.open(safeUrl(node.url), '_blank', 'noopener,noreferrer') }] : []),
            { icon: 'focus', label: t('zoomSelection'), run: zoomToSelection },
            ...(readOnly ? [] : [
              { icon: 'palette', label: t('color'), run: () => setPopup({ type: 'color', x, y }) },
              ...(node ? [{ icon: 'group', label: t('createGroup'), run: () => createGroupAround(selectionRef.current) }, { label: t('duplicate'), run: duplicateSelection },
                '-', { label: t('bringFront'), run: () => reorder(true) }, { label: t('sendBack'), run: () => reorder(false) }] : []),
              '-', { icon: 'trash', label: t('remove'), run: removeSelection },
            ]),
          ]
        } else {
          items = [
            ...(readOnly ? [] : [
              { icon: 'card', label: t('addCard'), run: () => createCard(world) },
              { icon: 'note', label: t('addNote'), run: () => setPopup({ type: 'vault', mode: 'note', point: world }) },
              { icon: 'media', label: t('addMedia'), run: () => setPopup({ type: 'vault', mode: 'media', point: world }) },
              { icon: 'globe', label: t('addLink'), run: () => setPopup({ type: 'link', point: world }) },
              { icon: 'group', label: t('addGroup'), run: () => addNode({ id: randomId(), type: 'group', label: '', ...placeAt(world, 400, 400) }, { edit: true }) },
              ...(clipboard ? [{ label: t('paste'), run: () => pasteFragment(clipboard) }] : []),
              '-',
            ]),
            { label: t('selectAll'), run: selectAll },
            { icon: 'fit', label: t('zoomFit'), run: zoomToFit },
          ]
        }
        setPopup({ type: 'menu', x, y, items })
      }

      // Handlers read refs, so one stable object serves every memoized node.
      const apiRef = useRef({})
      Object.assign(apiRef.current, {
        nodePointerDown, nodeDoubleClick, resizePointerDown, edgePointerDown, edgeDoubleClick, stopEditing, finishTextEdit,
        anchorPointerDown: (event, id, side) => {
          if (event.button !== 0) return
          event.stopPropagation()
          startConnect(event, { fromId: id, fromSide: side })
        },
        edgeEndPointerDown: (event, id, end) => {
          if (event.button !== 0) return
          event.stopPropagation()
          startConnect(event, { edgeId: id, end })
        },
      })
      const api = apiRef.current

      // ---- render

      if (view === undefined) {
        return h('div', { ref: rootRef, className: 'oc-root' }, h('style', null, CSS))
      }

      const nodesById = new Map(doc.nodes.map(node => [node.id, node]))
      const groups = doc.nodes.filter(node => node.type === 'group')
      const cards = doc.nodes.filter(node => node.type !== 'group')
      const single = selection.size === 1
      const selectedNodes = doc.nodes.filter(node => selection.has(node.id))
      const selectedEdges = doc.edges.filter(edge => selection.has(edge.id))
      const inv = 1 / view.zoom

      const renderNode = node => h(NodeView, {
        key: node.id, node, env, api, t, readOnly,
        selected: selection.has(node.id),
        single: single && selection.has(node.id),
        editing: editing?.id === node.id ? editing.part : undefined,
        active: activeId === node.id,
        dropTarget: overlay?.target === node.id,
      })

      const edgeLabels = doc.edges.map(edge => {
        const from = nodesById.get(edge.fromNode)
        const to = nodesById.get(edge.toNode)
        if (!from || !to) return null
        const editingLabel = editing?.id === edge.id && editing.part === 'edge'
        if (!editingLabel && (typeof edge.label !== 'string' || edge.label === '')) return null
        const { middle } = edgeGeometry(edge, from, to)
        if (editingLabel) return null
        return h('div', {
          key: edge.id, className: `oc-edge-label${selection.has(edge.id) ? ' is-selected' : ''}`, 'data-edge-id': edge.id,
          style: { left: middle.x, top: middle.y },
          onPointerDown: event => edgePointerDown(event, edge.id),
          onDoubleClick: event => edgeDoubleClick(event, edge.id),
        }, edge.label)
      })

      // Screen-space overlays: inline inputs, selection toolbar.
      const toScreen = point => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y })
      let inlineInput = null
      if (editing?.part === 'edge') {
        const edge = doc.edges.find(candidate => candidate.id === editing.id)
        const from = edge && nodesById.get(edge.fromNode)
        const to = edge && nodesById.get(edge.toNode)
        if (from && to) {
          const at = toScreen(edgeGeometry(edge, from, to).middle)
          inlineInput = h(InlineInput, { key: `edge-${edge.id}`, x: at.x, y: at.y, initial: edge.label ?? '', placeholder: t('edgeLabel'), onDone: value => finishLabel(edge.id, 'edge', value) })
        }
      } else if (editing?.part === 'label') {
        const group = nodesById.get(editing.id)
        if (group) {
          const at = toScreen({ x: group.x, y: group.y })
          inlineInput = h(InlineInput, { key: `group-${group.id}`, x: at.x + 70, y: at.y - 18, initial: group.label ?? '', placeholder: t('groupPrompt'), onDone: value => finishLabel(group.id, 'group', value) })
        }
      }

      let selectionBar = null
      if (!busy && !editing && selection.size > 0 && !readOnly) {
        const rects = selectedNodes.map(rectOf)
        for (const edge of selectedEdges) {
          const from = nodesById.get(edge.fromNode)
          const to = nodesById.get(edge.toNode)
          if (from && to) { const { middle } = edgeGeometry(edge, from, to); rects.push({ x: middle.x, y: middle.y, width: 0, height: 0 }) }
        }
        const bounds = boundsOf(rects)
        if (bounds) {
          const top = toScreen({ x: bounds.x + bounds.width / 2, y: bounds.y })
          const below = toScreen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height })
          const placeAbove = top.y - 50 > 0
          const x = Math.max(110, Math.min(size.width - 110, top.x))
          const y = placeAbove ? top.y - 14 - (selectedNodes.some(node => node.type !== 'text') ? 22 : 0) : Math.min(size.height - 60, below.y + 56)
          const onlyEdge = selectedNodes.length === 0 && selectedEdges.length === 1 ? selectedEdges[0] : undefined
          const onlyText = selectedNodes.length === 1 && selectedEdges.length === 0 && selectedNodes[0].type === 'text' ? selectedNodes[0] : undefined
          const onlyLink = selectedNodes.length === 1 && selectedNodes[0].type === 'link' ? selectedNodes[0] : undefined
          const direction = onlyEdge ? (onlyEdge.fromEnd === 'arrow' ? 'both' : onlyEdge.toEnd === 'none' ? 'none' : 'end') : undefined
          selectionBar = h('div', { className: 'oc-panel oc-selection-bar', style: { left: x, top: y }, onPointerDown: event => event.stopPropagation() },
            h(IconButton, { icon: 'trash', label: t('remove'), onClick: removeSelection }),
            h(IconButton, { icon: 'palette', label: t('color'), onClick: event => { const rect = rootRef.current.getBoundingClientRect(); const b = event.currentTarget.getBoundingClientRect(); setPopup({ type: 'color', x: b.left - rect.left, y: b.bottom - rect.top + 6 }) } }),
            selectedNodes.length > 0 ? h(IconButton, { icon: 'focus', label: t('zoomSelection'), onClick: zoomToSelection }) : null,
            onlyText ? h(IconButton, { icon: 'pencil', label: t('edit'), onClick: () => setEditing({ id: onlyText.id, part: 'text' }) }) : null,
            onlyLink ? h(IconButton, { icon: 'external', label: t('openLink'), onClick: () => window.open(safeUrl(onlyLink.url), '_blank', 'noopener,noreferrer') }) : null,
            selectedNodes.length > 1 ? h(IconButton, { icon: 'group', label: t('createGroup'), onClick: () => createGroupAround(selection) }) : null,
            onlyEdge ? h(IconButton, { icon: 'pencil', label: t('editLabel'), onClick: () => setEditing({ id: onlyEdge.id, part: 'edge' }) }) : null,
            onlyEdge ? h(IconButton, { icon: 'arrow', label: `${t('direction')}: ${t(direction === 'none' ? 'directionNone' : direction === 'both' ? 'directionBoth' : 'directionEnd')}`, onClick: event => { const rect = rootRef.current.getBoundingClientRect(); const b = event.currentTarget.getBoundingClientRect(); setPopup({ type: 'menu', x: b.left - rect.left, y: b.bottom - rect.top + 6, items: [
              { label: t('directionNone'), checked: direction === 'none', run: () => setEdgeDirection('none') },
              { label: t('directionEnd'), checked: direction === 'end', run: () => setEdgeDirection('end') },
              { label: t('directionBoth'), checked: direction === 'both', run: () => setEdgeDirection('both') },
            ] }) } }) : null)
        }
      }

      const currentColor = (() => {
        const items = [...selectedNodes, ...selectedEdges]
        const colors = new Set(items.map(item => item.color))
        return colors.size === 1 ? [...colors][0] : null
      })()

      let popupElement = null
      if (popup?.type === 'menu') popupElement = h(Menu, { x: popup.x, y: popup.y, items: popup.items, onClose: () => setPopup(null) })
      else if (popup?.type === 'color') popupElement = h(ColorPicker, { x: popup.x, y: popup.y, current: currentColor ?? undefined, t, onClose: () => setPopup(null), onPick: color => { setColor(color); if (color === undefined || COLOR_KEYS.includes(color)) setPopup(null) } })
      else if (popup?.type === 'settings') popupElement = h(Menu, { x: popup.x, y: popup.y, onClose: () => setPopup(null), items: [{ label: t('snap'), checked: snapToGrid, run: () => { localStorage.setItem('oc-snap', String(!snapToGrid)); setSnapToGrid(!snapToGrid) } }] })
      else if (popup?.type === 'help') popupElement = h(Popover, { x: popup.x, y: popup.y, align: 'right', onClose: () => setPopup(null) }, h(HelpPanel, { t }))
      else if (popup?.type === 'vault') popupElement = h(VaultPicker, { mode: popup.mode, canvasPath: absolutePath, t, onClose: () => setPopup(null), onPick: file => { setPopup(null); createFileNode(file, popup.point) } })
      else if (popup?.type === 'link') popupElement = h(TextPrompt, {
        label: t('linkPrompt'), type: 'url', initial: 'https://', t, onClose: () => setPopup(null),
        validate: value => (/^https?:\/\//i.test(value.trim()) && safeUrl(value.trim()) ? undefined : t('invalidUrl')),
        onSubmit: value => { setPopup(null); createLinkNode(safeUrl(value.trim()), popup.point) },
      })

      const openPopupAtButton = (type, event) => {
        const rect = rootRef.current.getBoundingClientRect()
        const button = event.currentTarget.getBoundingClientRect()
        setPopup({ type, x: button.left - rect.left - 8, y: button.top - rect.top, align: 'right' })
      }

      const stacks = history.current
      const rootClass = ['oc-root', busy ? 'is-busy' : '', busy === 'pan' ? 'is-panning' : '', busy === 'connect' ? 'is-connecting' : '', readOnly ? 'is-readonly' : ''].filter(Boolean).join(' ')

      return h('div', {
        ref: rootRef, className: rootClass, tabIndex: 0, role: 'application', 'aria-label': t('title'),
        onPointerDown: backgroundPointerDown, onDoubleClick: backgroundDoubleClick, onContextMenu,
        onKeyDown, onKeyUp, onCopy, onCut, onPaste,
        onPointerMove: event => { pointer.current = { x: event.clientX, y: event.clientY } },
        onBlur: () => { spaceDown.current = false; rootRef.current?.classList.remove('space-ready') },
      },
      h('style', null, CSS),
      h('div', { className: 'oc-grid', style: { backgroundSize: `${GRID * view.zoom}px ${GRID * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px`, opacity: view.zoom < 0.3 ? view.zoom / 0.3 : 1 } }),
      h('div', { className: 'oc-world', style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, '--oc-inv': inv } },
        groups.map(renderNode),
        h('svg', { className: 'oc-edges' },
          doc.edges.map(edge => {
            const from = nodesById.get(edge.fromNode)
            const to = nodesById.get(edge.toNode)
            if (!from || !to) return null
            return h(EdgeView, { key: edge.id, edge, from, to, selected: selection.has(edge.id), inv: selection.has(edge.id) ? inv : undefined, readOnly, api })
          }),
          overlay?.connect ? h('g', { className: 'oc-edge oc-edge-temp' }, h('path', { className: 'oc-edge-line', d: overlay.connect.path }),
            overlay.connect.arrows.map((points, index) => h('polygon', { key: index, className: 'oc-edge-arrow', points }))) : null),
        cards.map(renderNode),
        edgeLabels,
        overlay?.marquee ? h('div', { className: 'oc-marquee', style: { left: overlay.marquee.x, top: overlay.marquee.y, width: overlay.marquee.width, height: overlay.marquee.height, borderWidth: inv } }) : null),
      doc.nodes.length === 0 && !readOnly ? h('div', { className: 'oc-empty-hint' }, t('emptyHint')) : null,
      inlineInput,
      selectionBar,
      h('div', { className: 'oc-panel oc-controls', onPointerDown: event => event.stopPropagation(), onDoubleClick: event => event.stopPropagation() },
        h('div', { className: 'oc-panel-group' },
          h(IconButton, { icon: 'gear', label: t('settings'), onClick: event => openPopupAtButton('settings', event) })),
        h('div', { className: 'oc-panel-group' },
          h(IconButton, { icon: 'plus', label: t('zoomIn'), onClick: () => zoomAt(1.25) }),
          h('div', { className: 'oc-zoom-label', title: t('zoomReset'), onDoubleClick: () => zoomAt(1 / view.zoom) }, `${Math.round(view.zoom * 100)}%`),
          h(IconButton, { icon: 'minus', label: t('zoomOut'), onClick: () => zoomAt(0.8) }),
          h(IconButton, { icon: 'reset', label: t('zoomReset'), onClick: () => zoomAt(1 / view.zoom) }),
          h(IconButton, { icon: 'fit', label: t('zoomFit'), onClick: zoomToFit })),
        readOnly ? null : h('div', { className: 'oc-panel-group' },
          h(IconButton, { icon: 'undo', label: t('undo'), onClick: undo, disabled: stacks.undo.length === 0 }),
          h(IconButton, { icon: 'redo', label: t('redo'), onClick: redo, disabled: stacks.redo.length === 0 })),
        h('div', { className: 'oc-panel-group' },
          h(IconButton, { icon: 'help', label: t('help'), onClick: event => openPopupAtButton('help', event) }))),
      readOnly ? null : h('div', { className: 'oc-panel oc-add-bar', onDoubleClick: event => event.stopPropagation() },
        [['card', 'card', 'addCard'], ['note', 'note', 'addNote'], ['media', 'media', 'addMedia'], ['link', 'globe', 'addLink'], ['group', 'group', 'addGroup']].map(([kind, icon, label]) => h(IconButton, {
          key: kind, icon, label: t('dragHint', { action: t(label) }),
          onPointerDown: event => { event.stopPropagation(); startAddDrag(event, kind) },
        }))),
      overlay?.ghost ? h('div', { className: 'oc-panel', style: { left: overlay.ghost.x - rootRef.current.getBoundingClientRect().left - 17, top: overlay.ghost.y - rootRef.current.getBoundingClientRect().top - 17, pointerEvents: 'none', opacity: 0.8 } },
        h('span', { className: 'oc-icon-button' }, h(Icon, { name: { card: 'card', note: 'note', media: 'media', link: 'globe', group: 'group' }[overlay.ghost.kind] }))) : null,
      readOnly ? (pathKnown ? h('div', { className: 'oc-status' }, t('readOnly')) : null)
        : save.status === 'saving' ? h('div', { className: 'oc-status', role: 'status' }, t('saving'))
          : save.status === 'failed' ? h('div', { className: 'oc-status is-error', role: 'alert' }, t('saveFailed', { message: save.message }),
            h('button', { type: 'button', onClick: () => flushSave() }, t('retry')))
            : null,
      conflict !== null ? h('div', { className: 'oc-banner', role: 'alert' }, t('conflict'),
        h('button', { type: 'button', className: 'oc-text-button', onClick: () => {
          let next
          try { next = parseCanvas(conflict) } catch (error) { setSave({ status: 'failed', message: error.message }); setConflict(null); return }
          pushHistory(docRef.current)
          diskText.current = conflict
          dirty.current = false
          clearTimeout(saveTimer.current)
          setDoc(next)
          setEpoch(value => value + 1)
          setConflict(null)
        } }, t('loadDisk')),
        h('button', { type: 'button', className: 'oc-text-button', onClick: () => { diskText.current = conflict; setConflict(null); scheduleSave() } }, t('keepMine'))) : null,
      popupElement)
    }

    // ---------------------------------------------------------------- body

    function CanvasBody(props) {
      const { content, resourceAddress, t } = props
      const resource = props.useResource(resourceAddress)
      const absolutePath = resource?.value?.absolutePath
      const bytes = content?.kind === 'bytes' ? content.data : undefined
      const text = useMemo(() => (bytes === undefined ? undefined : decodeText(bytes)), [bytes])
      const failure = useMemo(() => {
        if (text === undefined) return undefined
        try {
          parseCanvas(text)
          return undefined
        } catch (error) {
          return error.message
        }
      }, [text])
      if (text === undefined) return h('div', { className: 'oc-message', role: 'status' }, h('style', null, CSS), t('loading'))
      if (failure !== undefined) {
        return h('div', { className: 'oc-message', role: 'alert' }, h('style', null, CSS),
          h('strong', null, t('invalid', { message: failure })), t('invalidHint'))
      }
      const pathKnown = resource?.failure != null || resource?.value != null
      return h(CanvasEditor, { key: resourceAddress, text, absolutePath, pathKnown, resourceAddress, t })
    }

    return {
      inject: ['slots', 'documentPreviews', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'obsidian-canvas: en')
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'obsidian-canvas: zh')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.documentPreviews.register({
          id: BODY_ID,
          extensions: ['canvas'],
          priority: 'extension',
          title: () => t('title'),
          loading: 'bytes-complete',
          wrap: false,
        }), 'obsidian-canvas: metadata')
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
          name: 'sidebar.right.tab.document', key: BODY_ID, locale: NS,
        }, CanvasBody)), 'obsidian-canvas: body')
      },
    }
  },
})
