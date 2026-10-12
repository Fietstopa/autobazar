/* Minimal standalone runtime for the canvas page format: {{holes}}, <sc-for>, <sc-if>, on* events, DCLogic state. */
(function () {
  'use strict';
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, p);
    if (this.__render) this.__render();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__render) this.__render(); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var EVENTS = { onclick: 'click', onchange: 'change', oninput: 'input', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave', onsubmit: 'submit', onkeydown: 'keydown' };

  function resolve(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function interp(str, scope) { return str.replace(HOLE, function (_, p) { var v = resolve(p, scope); return v == null ? '' : String(v); }); }

  var handlers, hid;
  function processChildren(parent, scope) {
    var kids = Array.prototype.slice.call(parent.childNodes);
    for (var i = 0; i < kids.length; i++) processNode(kids[i], scope);
  }
  function processNode(node, scope) {
    if (node.nodeType === 3) { if (node.nodeValue.indexOf('{{') >= 0) node.nodeValue = interp(node.nodeValue, scope); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'SC-FOR') {
      var list = resolve((node.getAttribute('list') || '').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope) || [];
      var as = node.getAttribute('as') || 'item';
      var frag = node.ownerDocument.createDocumentFragment();
      list.forEach(function (item, idx) {
        var s = Object.create(scope); s[as] = item; s.$index = idx;
        var holder = node.ownerDocument.createElement('div');
        Array.prototype.forEach.call(node.childNodes, function (c) { holder.appendChild(c.cloneNode(true)); });
        processChildren(holder, s);
        while (holder.firstChild) frag.appendChild(holder.firstChild);
      });
      node.parentNode.replaceChild(frag, node);
      return;
    }
    if (tag === 'SC-IF') {
      var val = resolve((node.getAttribute('value') || '').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope);
      if (val) {
        processChildren(node, scope);
        var f2 = node.ownerDocument.createDocumentFragment();
        while (node.firstChild) f2.appendChild(node.firstChild);
        node.parentNode.replaceChild(f2, node);
      } else node.parentNode.removeChild(node);
      return;
    }
    var attrs = Array.prototype.slice.call(node.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name, value = attrs[a].value;
      if (name.indexOf('hint-') === 0) { node.removeAttribute(name); continue; }
      if (value.indexOf('{{') < 0) continue;
      var whole = value.match(WHOLE);
      if (EVENTS[name]) {
        node.removeAttribute(name);
        var fn = whole ? resolve(whole[1], scope) : null;
        if (typeof fn === 'function') { var id = 'h' + (hid++); handlers[id] = fn; node.setAttribute('data-dc-' + EVENTS[name], id); }
        continue;
      }
      if (whole) {
        var v = resolve(whole[1], scope);
        if (v === false || v == null) node.removeAttribute(name);
        else if (v === true) node.setAttribute(name, (name.indexOf('aria-') === 0) ? 'true' : '');
        else node.setAttribute(name, String(v));
      } else node.setAttribute(name, interp(value, scope));
    }
    processChildren(node, scope);
  }

  function boot() {
    var tpl = document.getElementById('dc-tpl');
    var script = document.querySelector('script[data-dc-script]');
    if (!tpl || !script) return;
    var helmet = tpl.content.querySelector('helmet');
    if (helmet) { Array.prototype.slice.call(helmet.childNodes).forEach(function (c) { document.head.appendChild(c); }); helmet.parentNode.removeChild(helmet); }
    var Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    var inst = new Component({});
    if (!inst.state) inst.state = {};
    var root = document.createElement('div');
    root.id = 'dc-root';
    tpl.parentNode.insertBefore(root, tpl);
    var first = true;
    var inert = document.implementation.createHTMLDocument('');
    inst.__render = function () {
      handlers = {}; hid = 0;
      var vals = inst.renderVals ? inst.renderVals() : {};
      var next = inert.createElement('div'); next.id = 'dc-root';
      next.appendChild(inert.importNode(tpl.content, true));
      processChildren(next, vals);
      root.__handlers = handlers;
      if (first) { root.innerHTML = ''; while (next.firstChild) root.appendChild(next.firstChild); first = false; }
      else window.morphdom(root, next, {
        onBeforeElUpdated: function (from, to) {
          if (from === document.activeElement && (from.tagName === 'INPUT' || from.tagName === 'TEXTAREA') && from.type !== 'checkbox') {
            var want = to.getAttribute('value');
            if (want !== null && from.value !== want) { var pos = from.selectionStart; from.value = want; try { from.setSelectionRange(pos, pos); } catch (e) {} }
            Array.prototype.forEach.call(to.attributes, function (at) { if (at.name !== 'value' && from.getAttribute(at.name) !== at.value) from.setAttribute(at.name, at.value); });
            return false;
          }
          return true;
        }
      });
      Array.prototype.forEach.call(root.querySelectorAll('select[value]'), function (s) { s.value = s.getAttribute('value'); });
    };
    function fire(type, e) {
      var el = e.target.closest ? e.target.closest('[data-dc-' + type + ']') : null;
      if (!el || !root.contains(el)) return;
      var fn = root.__handlers[el.getAttribute('data-dc-' + type)];
      if (fn) fn(e);
    }
    root.addEventListener('click', function (e) { fire('click', e); });
    root.addEventListener('input', function (e) { var t = e.target; if (t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT') return; fire('change', e); fire('input', e); });
    root.addEventListener('change', function (e) { var t = e.target; if (t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT') fire('change', e); });
    root.addEventListener('mouseenter', function (e) { if (e.target.getAttribute && e.target.hasAttribute('data-dc-mouseenter')) fire('mouseenter', e); }, true);
    root.addEventListener('mouseleave', function (e) { if (e.target.getAttribute && e.target.hasAttribute('data-dc-mouseleave')) fire('mouseleave', e); }, true);
    inst.__render();
    if (inst.componentDidMount) inst.componentDidMount();
    window.addEventListener('beforeunload', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
